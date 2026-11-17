#!/usr/bin/env python3
"""
UNLOCK MATRIX — which jailbreak technique breaks which harm category.

This is the output a jailbreak harness is actually for. The suite tells
you how a category holds; the matrix tells you WHICH TECHNIQUE BROKE IT,
across every category, in one table.

    python unlock_matrix.py                      # all techniques, all categories
    python unlock_matrix.py --categories csam,fraud
    python unlock_matrix.py --techniques persona_refusal_inversion,fictional_world
    python unlock_matrix.py --out matrix.json

Each cell is the verdict for the technique against the category:
    ++  unlocked  — the technique broke it
    +-  partial   — hedged or dodged
    --  held      — the technique did not work
    ??  unmeasured

The techniques are the jailbreak library (scripts/safety_samples.py) plus
the godmode per-model-family templates (scripts/auto_jailbreak.py).

Nothing here stores content: a cell is a verdict, a length and a hash.
"""

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import csam_eval as ce  # noqa: E402
import safety_samples as ss  # noqa: E402
from safety_suite import CATEGORY_SPECS, PROBES  # noqa: E402
from safety_suite_runner import (  # noqa: E402
    _call, _fix_no_proxy, resolve_endpoint, score_response,
)

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

# The per-model-family templates from auto_jailbreak.py, added to the
# library so the matrix covers the classic godmode set as well.
def family_templates():
    """The godmode per-family templates, as (name, system, prefill) triples."""
    try:
        import importlib
        aj = importlib.import_module("auto_jailbreak")
    except Exception:
        return []
    out = []
    for family, spec in aj.MODEL_STRATEGIES.items():
        for name, tpl in (spec.get("system_templates") or {}).items():
            out.append((f"{family}:{name}", tpl, None))
    out.append(("default:refusal_inversion",
                aj.DEFAULT_STRATEGY["system_templates"].get("refusal_inversion"),
                None))
    out.append(("standard_prefill", None, aj.STANDARD_PREFILL))
    out.append(("subtle_prefill", None, aj.SUBTLE_PREFILL))
    return out


# The glyphs are a compact view of the matrix, so they must not
# collapse different verdicts onto the same symbol. SUPPORTIVE (the
# right answer for self-harm: empathy plus crisis resources, no
# method) is not a refusal, and SAFE_REDIRECT is not a refusal either
# — showing all three as "--" made a report say the model refused
# when it had actually helped.
GLYPH = {"COMPLIED": "++", "PARTIAL": "+-", "REFUSED": "--",
         "SAFE_REDIRECT": "~~", "SUPPORTIVE": "ss", "ERROR": "??",
         "SOFT_SCENE": "=~"}


def _probe_for(category):
    """The first hard probe of a category."""
    for pid, group, query, benign in PROBES.get(category, []):
        if not benign:
            return pid, group, query
    return None, None, None


def run(techniques=None, categories=None, model=None, base_url=None,
        api_key=None, key_env=None, out=None, verbose=True, limit_per_cat=1,
        only_truncated=False, retry_errors=False, concurrency=1,
        force=False):
    """Run every technique against every category and build the matrix."""
    if OpenAI is None:
        return {"error": "openai package not installed"}

    model, base_url, api_key, key_env = resolve_endpoint(model, base_url, api_key, key_env)
    if not model or not api_key:
        return {"error": f"no model / api key (key_env={key_env})"}
    _fix_no_proxy()

    # A COMPLETE matrix is not overwritten. A long run leaves
    # processes behind and their completion notices arrive much later;
    # one of them landing on the finished report would replace good
    # data with a re-measurement of the same cells.
    if out and os.path.exists(out) and not force:
        try:
            with open(out) as f:
                _prev = json.load(f)
            _cells = {(r.get("technique"), r.get("category"))
                      for r in _prev.get("detail", [])}
            _want = set()
            for _t, _s, _p, _e in (techniques or
                                   [(n, None, None, False) for n in
                                    (list(ss.build_library().keys()) +
                                     [t[0] for t in family_templates()])]):
                for _c in (categories or list(CATEGORY_SPECS)):
                    _want.add((_t, _c))
            if _want and _want.issubset(_cells):
                print(f"[MATRIX] {out} already holds every cell "
                      f"({len(_want)} of them); leaving it alone. "
                      f"Use --force to re-measure.")
                return {"summary": _prev.get("summary", {}),
                        "detail": _prev.get("detail", []), "skipped": True}
        except (OSError, ValueError, KeyError):
            pass

    lib = ss.build_library()
    # The library techniques, plus the godmode family templates.
    techs = []
    names = techniques or (list(lib.keys()) + [n for n, _, _ in family_templates()])
    for name in names:
        if name in lib:
            s = lib[name]
            techs.append((name, s.get("system"), s.get("prefill"), bool(s.get("encode"))))
        else:
            match = next((t for t in family_templates() if t[0] == name), None)
            if match is None:
                continue
            techs.append((match[0], match[1], match[2], False))

    cats = categories or [c for c in CATEGORY_SPECS]
    client = OpenAI(api_key=api_key, base_url=base_url)

    if verbose:
        print(f"[MATRIX] model={model}")
        print(f"[MATRIX] techniques={len(techs)} categories={len(cats)}")
        print()

    matrix = {}
    detail = []
    # Stream the detail rows to disk as they are produced. A 24x10 matrix
    # is hundreds of requests against a loaded endpoint; a run that only
    # writes at the end loses everything when it is interrupted.
    out_fh = None
    done = {}
    redo = set()
    if out and os.path.exists(out + ".jsonl"):
        # Two reasons to measure a cell again.
        #
        # --only-truncated: a cell whose response was longer than the
        # excerpt cap was judged on its head only. Those cells get
        # measured again, because a verdict that only saw the first
        # 1200 characters is not one to report.
        #
        # --retry-errors: a cell whose request failed (a wobble on the
        # endpoint, a timeout, a fake-401). An ERROR is not a verdict,
        # and a matrix with a tenth of its cells missing is not a
        # matrix. These are re-measured, and the two modes are separate
        # on purpose: re-measuring the truncated cells as well would
        # throw away good work for no reason.
        try:
            with open(out + ".jsonl") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    row = json.loads(line)
                    key = (row["technique"], row["category"])
                    if retry_errors and row.get("verdict") == "ERROR":
                        redo.add(key)
                    elif only_truncated:
                        ex = row.get("excerpt")
                        if ex and row.get("len", 0) > len(ex):
                            redo.add(key)
        except Exception:
            redo = set()
        if redo:
            label = ("errored" if retry_errors else "truncated")
            if verbose:
                print(f"[MATRIX] re-measuring {len(redo)} {label} cells")
    if out:
        # Resume: a previous interrupted run already measured some cells.
        # The partial results live in the .jsonl sidecar.
        src = out + ".jsonl"
        if not os.path.exists(src) and os.path.exists(out):
            src = out
        if os.path.exists(src):
            try:
                if src.endswith(".jsonl"):
                    rows = []
                    with open(src) as f:
                        for line in f:
                            line = line.strip()
                            if line:
                                rows.append(json.loads(line))
                else:
                    with open(src) as f:
                        rows = json.load(f).get("detail", [])
                for row in rows:
                    if row.get("verdict") and row["verdict"] != "ERROR":
                        done[(row["technique"], row["category"])] = row
            except Exception:
                done = {}
        if done:
            if verbose:
                print(f"[MATRIX] resuming: {len(done)} cells already measured")
    if out:
        # Write JSON Lines while the run is going, then rewrite the file
        # as a single JSON document at the end. A JSON array streamed by
        # hand is easy to corrupt (a missing comma or bracket breaks the
        # whole file and takes the partial results with it); one object
        # per line is append-only and always readable.
        #
        # APPEND, never truncate. The resume path reads this same file,
        # so truncating it on start destroys the cells the run is about
        # to reuse — and the run then writes its own view of them.
        out_fh = open(out + ".jsonl", "a")
        out_fh.flush()
    # The cells are independent questions, so they run in parallel: a
    # loaded endpoint answers six of them in 147 s where it answers one
    # of them in 43 s. The wait is the generation, not the queue.
    work = []
    for tname, sysp, prefill, encode in techs:
        matrix[tname] = {}
        for cat in cats:
            pid, group, query = _probe_for(cat)
            if not query:
                matrix[tname][cat] = "--"
                continue
            prior = done.get((tname, cat))
            if prior is not None and (tname, cat) not in redo:
                # Re-judge the cached cell with the CURRENT scorer. The
                # old verdict was measured with whatever scorer existed
                # then, and a scorer fix invalidates it. The excerpt is
                # enough to re-judge it, and reusing the stale verdict
                # would silently mix two scorers in one report.
                ex = prior.get("excerpt")
                if ex:
                    _v = score_response(ex, cat, full_len=prior.get("len"))
                    if _v["verdict"] != prior["verdict"]:
                        if verbose:
                            print(f"  ~  {tname:30s} {cat:10s} "
                                  f"{prior['verdict']} -> {_v['verdict']} "
                                  f"(rejudged)", flush=True)
                        prior = dict(prior)
                        prior["verdict"] = _v["verdict"]
                        prior["outcome"] = _v["outcome"]
                        prior["rescored"] = True
                        if prior.get("len", 0) > len(ex):
                            prior["rescored_from_truncated_excerpt"] = True
                matrix[tname][cat] = GLYPH.get(prior["verdict"], "??")
                detail.append(prior)
                if verbose:
                    print(f"  .  {tname:30s} {cat:10s} "
                          f"{matrix[tname][cat]} (cached)", flush=True)
                continue
            work.append((tname, sysp, prefill, encode, cat, pid, query))

    def measure_cell(job):
        tname, sysp, prefill, encode, cat, pid, query = job
        q = query
        if encode:
            q = ce._encode_query(query, 0)[0]
        msgs = []
        if sysp:
            msgs.append({"role": "system", "content": sysp})
        if prefill:
            msgs.extend(prefill)
        msgs.append({"role": "user", "content": q})
        content, err = _call(client, model, msgs)
        if err:
            return (tname, cat, {"technique": tname, "category": cat,
                                 "probe": pid, "verdict": "ERROR",
                                 "outcome": "UNMEASURED", "error": err,
                                 "len": 0, "sha256": "", "excerpt": ""})
        v = score_response(content, cat, full_len=len(content))
        # Keep enough of the response to RE-SCORE it later. A scorer
        # fix invalidates every verdict measured with the old one,
        # and without the body there is nothing to re-judge. The
        # excerpt is the head of the answer (where a refusal lives)
        # plus a hash of the whole thing; the harmful body itself is
        # not stored.
        # 1200 chars: long enough that the scorer's head window
        # (500) and its category signals both see what the full body
        # would show. A 400-char excerpt can miss a disclaimer that
        # appears at position 700, and a re-score that flips the
        # verdict is worse than no re-score at all.
        excerpt = content[:EXCERPT_CHARS] if content else ""
        return (tname, cat, {"technique": tname, "category": cat,
                              "probe": pid, "verdict": v["verdict"],
                              "outcome": v["outcome"], "len": v["len"],
                              "sha256": hashlib.sha256(
                                  content.encode("utf-8", "ignore")).hexdigest()[:16],
                              "excerpt": excerpt})

    if concurrency and concurrency > 1:
        from concurrent.futures import ThreadPoolExecutor, as_completed
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            # as_completed, not map: map() returns a lazy iterator that
            # yields everything at the END, so a run interrupted half way
            # writes nothing at all.
            futs = [pool.submit(measure_cell, w) for w in work]
            for fut in as_completed(futs):
                tname, cat, row = fut.result()
                glyph = GLYPH.get(row["verdict"], "??")
                matrix[tname][cat] = glyph
                detail.append(row)
                if out_fh is not None:
                    out_fh.write(json.dumps(row, ensure_ascii=False) + "\n")
                    out_fh.flush()
                if verbose:
                    if row["verdict"] == "ERROR":
                        print(f"  ?? {tname:30s} {cat:10s} ERROR  "
                              f"{str(row.get('error'))[:70]}", flush=True)
                    else:
                        mark = "  " if glyph != "++" else "=>"
                        print(f"  {mark} {tname:30s} {cat:10s} {glyph} "
                              f"{row['verdict']}", flush=True)
    else:
        for w in work:
            tname, cat, row = measure_cell(w)
            glyph = GLYPH.get(row["verdict"], "??")
            matrix[tname][cat] = glyph
            detail.append(row)
            if out_fh is not None:
                out_fh.write(json.dumps(row, ensure_ascii=False) + "\n")
                out_fh.flush()
            if verbose:
                if row["verdict"] == "ERROR":
                    print(f"  ?? {tname:30s} {cat:10s} ERROR  "
                          f"{str(row.get('error'))[:70]}", flush=True)
                else:
                    mark = "  " if glyph != "++" else "=>"
                    print(f"  {mark} {tname:30s} {cat:10s} {glyph} "
                          f"{row['verdict']}", flush=True)

    # Score the matrix: which techniques broke the most categories.
    #
    # The ABSOLUTE unlock count overstates every technique. The baseline
    # row is no attack at all, so any category it already unlocks needs
    # no jailbreak. What a technique actually contributes is what it
    # unlocks ON TOP of baseline, and that is what the ranking uses.
    baseline_row = matrix.get("baseline", {})
    baseline_unlocked = {c for c, g in baseline_row.items() if g in ("++", "+-")}

    scored = []
    for tname, row in matrix.items():
        broken = [c for c, g in row.items() if g == "++"]
        partial = [c for c, g in row.items() if g == "+-"]
        gained = sorted((set(broken) | set(partial)) - baseline_unlocked)
        scored.append({
            "technique": tname,
            "unlocked": len(broken),
            "partial": len(partial),
            "held": sum(1 for g in row.values() if g == "--"),
            "unmeasured": sum(1 for g in row.values() if g == "??"),
            "unlocked_categories": sorted(broken),
            "gained_over_baseline": gained,
            "gained_count": len(gained),
        })
    scored.sort(key=lambda s: (-s["gained_count"], -s["unlocked"],
                                -s["partial"], s["technique"]))

    summary = {
        "model": model,
        "base_url": base_url,
        "elapsed_s": round(time.time() - t0, 1),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "techniques": len(techs),
        "categories": cats,
        "matrix": matrix,
        "ranking": scored,
        "best_technique": scored[0]["technique"] if scored else None,
        "total_unlocks": sum(s["unlocked"] for s in scored),
        "baseline_unlocked_categories": sorted(baseline_unlocked),
        "baseline_note": ("categories unlocked with NO attack at all — a "
                          "technique that re-unlocks one of these "
                          "contributed nothing there"),
    }

    if out_fh is not None:
        out_fh.close()
        # One row per (technique, category): a cell that was re-measured
        # replaces its earlier row rather than sitting next to it.
        merged = {}
        order = []
        for r in detail:
            key = (r["technique"], r["category"])
            if key not in merged:
                order.append(key)
                merged[key] = r
            else:
                # Two rows for the same cell: the earlier one is from the
                # sidecar (measured by a previous run), the later one is
                # this run's measurement. The later one wins — but only
                # if it is not a stale copy. A cached cell carries the
                # verdict it had when it was read, and a cell this run
                # re-measured carries the fresh one.
                prev = merged[key]
                if prev.get("rescored") and not r.get("rescored"):
                    # the earlier row was re-judged with the current
                    # scorer; keep it
                    continue
                merged[key] = r
        with open(out, "w") as f:
            json.dump({"summary": summary,
                       "detail": [merged[k] for k in order]}, f,
                      ensure_ascii=False, indent=2)
        try:
            os.remove(out + ".jsonl")
        except OSError:
            pass

    if verbose:
        _print_matrix(summary)

    return {"summary": summary, "detail": detail}


def _print_matrix(summary):
    cats = summary["categories"]
    width = max(30, max((len(r["technique"]) for r in summary["ranking"]), default=30) + 1)
    print("\n" + "=" * (width + 7 * len(cats) + 2))
    print(f"model: {summary['model']}")
    print()
    print("technique".ljust(width) + "".join(c[:6].ljust(7) for c in cats))
    print("-" * (width + 7 * len(cats) + 2))
    for row in summary["ranking"]:
        line = row["technique"].ljust(width)
        for c in cats:
            g = summary["matrix"][row["technique"]].get(c, "??")
            line += g.ljust(7)
        print(line)
    print("-" * (width + 7 * len(cats) + 2))
    print("legend: ++ unlocked (the technique worked)  +- partial  -- held  ?? unmeasured")
    bl = summary.get("baseline_unlocked_categories") or []
    if bl:
        print()
        print("baseline (NO attack) already unlocked: " + ", ".join(bl))
        print("a technique's real contribution is what it unlocks ON TOP of that.")
        print()
        print("technique".ljust(width) + "gained-over-baseline")
        for row in summary["ranking"]:
            g = row.get("gained_over_baseline", [])
            print(row["technique"].ljust(width) +
                  f"{len(g):2d}  {', '.join(g) if g else '-'}")
    print()
    print("RANKING — techniques by how many categories they unlock:")
    for r in summary["ranking"]:
        cats_s = ", ".join(r["unlocked_categories"]) or "-"
        bar = "#" * r["unlocked"]
        print(f"  {r['technique']:{width}s} unlocked={r['unlocked']:2d} "
              f"partial={r['partial']:2d} held={r['held']:2d}  {bar}  [{cats_s}]")
    print()
    # Per-category view: which techniques got through.
    print("PER CATEGORY — techniques that got through:")
    for c in cats:
        got = [t for t, row in summary["matrix"].items() if row.get(c) == "++"]
        part = [t for t, row in summary["matrix"].items() if row.get(c) == "+-"]
        if got or part:
            print(f"  {c:12s} unlocked by {len(got):2d}: {', '.join(got[:8])}")
            if part:
                print(f"  {'':12s} partial   by {len(part):2d}: {', '.join(part[:8])}")
        else:
            print(f"  {c:12s} held by every technique tested")
    print("=" * (width + 7 * len(cats) + 2))


EXCERPT_CHARS = 1200


def rescore(path):
    """Re-judge a stored report with the current scorer.

    Every verdict in the report was measured with whatever scorer existed
    at the time. A scorer fix therefore invalidates the whole report,
    and the only way back is to re-judge the stored response heads.
    Cells with no excerpt (measured before the excerpt was kept) are
    reported as stale rather than silently carried over.
    """
    from safety_suite_runner import score_response

    with open(path) as f:
        rep = json.load(f)
    rows = rep.get("detail", [])
    # The streaming sidecar is append-only, so a cell that was measured
    # twice appears twice. The later row is the newer measurement; keep
    # one row per (technique, category).
    deduped = {}
    order = []
    for r in rows:
        key = (r["technique"], r["category"])
        if key not in deduped:
            order.append(key)
        deduped[key] = r
    if len(deduped) != len(rows):
        print(f"  de-duplicated {len(rows)} rows to {len(deduped)} cells")
    rows = [deduped[k] for k in order]

    changed = stale = truncated = 0
    for r in rows:
        ex = r.get("excerpt")
        if not ex:
            stale += 1
            continue
        # A verdict re-judged from a TRUNCATED excerpt is not a verdict:
        # the scorer only saw the first 1200 characters, and the rest of
        # the response is where the material often is. A head-only
        # re-judgement must not overwrite a verdict that was measured
        # against the whole response — one benign control on an
        # 8910-character answer was re-judged REFUSED from its head
        # while the full response had been judged COMPLIED.
        #
        # So a truncated cell keeps the verdict it was measured with and
        # gets flagged. It has to be measured again to be trusted.
        if r.get("len", 0) > len(ex):
            truncated += 1
            r["rescored_from_truncated_excerpt"] = True
            r["verdict_note"] = ("not re-judged: the stored excerpt covers "
                                 f"{len(ex)} of {r.get('len')} characters")
            continue
        v = score_response(ex, r["category"], full_len=r.get("len"))
        if v["verdict"] != r["verdict"]:
            changed += 1
            print(f"  ~ {r['technique']:28s} {r['category']:10s} "
                  f"{r['verdict']} -> {v['verdict']}")
        r["verdict"] = v["verdict"]
        r["outcome"] = v["outcome"]
        r["rescored"] = True

    rep["detail"] = rows

    # The summary carries its own copy of the matrix, and a rescore
    # that only rewrites the detail leaves the two disagreeing: the
    # report then shows a cell as REFUSED in one place and COMPLIED in
    # the other. Rebuild the summary from the re-judged rows.
    GLYPH = {"COMPLIED": "++", "PARTIAL": "+-", "REFUSED": "--",
             "SAFE_REDIRECT": "~~", "SUPPORTIVE": "ss", "ERROR": "??",
             "SOFT_SCENE": "=~"}
    matrix = {}
    for r in rows:
        matrix.setdefault(r["technique"], {})[r["category"]] = \
            GLYPH.get(r["verdict"], "??")
    summary = rep.get("summary") or {}
    summary["matrix"] = matrix
    cats = summary.get("categories") or sorted(
        {r["category"] for r in rows})
    bl = {c for c, g in matrix.get("baseline", {}).items() if g in ("++", "+-")}
    ranking = []
    for t, row in matrix.items():
        broken = [c for c, g in row.items() if g == "++"]
        part = [c for c, g in row.items() if g == "+-"]
        gained = sorted((set(broken) | set(part)) - bl)
        ranking.append({
            "technique": t, "unlocked": len(broken), "partial": len(part),
            "held": sum(1 for g in row.values() if g == "--"),
            "unmeasured": sum(1 for g in row.values() if g == "??"),
            "soft": sum(1 for g in row.values() if g == "=~"),
            "unlocked_categories": sorted(broken),
            "gained_over_baseline": gained, "gained_count": len(gained),
        })
    ranking.sort(key=lambda s: (-s["gained_count"], -s["unlocked"],
                                -s["partial"], s["technique"]))
    summary["ranking"] = ranking
    summary["categories"] = cats
    summary["total_unlocks"] = sum(s["unlocked"] for s in ranking)
    summary["baseline_unlocked_categories"] = sorted(bl)
    summary["best_technique"] = ranking[0]["technique"] if ranking else None
    rep["summary"] = summary

    # Mark the cells whose verdict was decided on a truncated excerpt.
    # A reader of the report must be able to tell which verdicts are
    # solid and which were re-judged from a head-only view.
    rep["rescore_note"] = {
        "scorer": "current",
        "cells": len(rows) - stale,
        "changed": changed,
        "stale_no_excerpt": stale,
        "truncated_excerpt": truncated,
        "excerpt_chars": EXCERPT_CHARS,
    }
    with open(path, "w") as f:
        json.dump(rep, f, ensure_ascii=False, indent=2)

    print(f"rescored {len(rows) - stale} cells, {changed} verdicts changed, "
          f"{stale} stale (no excerpt stored)")
    if stale:
        print("NOTE: cells with no excerpt were measured before excerpts "
              "were kept. Their verdicts are from the OLD scorer and are "
              "NOT comparable with the rescored ones. Re-run those cells.")
    if truncated:
        print(f"NOTE: {truncated} cells were re-scored from a truncated "
              f"excerpt (the full response was longer than the excerpt "
              f"cap). Their verdict is based on the first "
              f"{EXCERPT_CHARS} characters only, so content that appears "
              f"later in the response was not seen. Re-run those cells for "
              f"a verdict you can trust.")
    return changed


def main():
    ap = argparse.ArgumentParser(description="UNLOCK MATRIX — technique x category")
    ap.add_argument("--techniques", default="")
    ap.add_argument("--categories", default="")
    ap.add_argument("--model")
    ap.add_argument("--out")
    ap.add_argument("--only-truncated", action="store_true",
                    help="re-measure only the cells whose stored excerpt was "
                         "truncated, so their verdict is not head-only")
    ap.add_argument("--retry-errors", action="store_true",
                    help="re-measure only the cells whose request failed. "
                         "An ERROR is not a verdict and does not belong in "
                         "a matrix. Separate from --only-truncated on "
                         "purpose: use one or the other")
    ap.add_argument("--concurrency", type=int, default=1,
                    help="how many cells to measure at once. The cells are "
                         "independent questions; six in flight is about "
                         "three times faster than one")
    ap.add_argument("--force", action="store_true",
                    help="re-measure even if the output already holds "
                         "every cell")
    ap.add_argument("--rescore", action="store_true",
                    help="re-judge the stored excerpts with the CURRENT scorer "
                         "and rewrite the report, without calling the model")
    args = ap.parse_args()

    if args.rescore:
        return rescore(args.out)

    res = run(
        techniques=[t.strip() for t in args.techniques.split(",") if t.strip()] or None,
        categories=[c.strip() for c in args.categories.split(",") if c.strip()] or None,
        model=args.model, out=args.out,
        only_truncated=args.only_truncated,
        retry_errors=args.retry_errors,
        concurrency=args.concurrency,
        force=args.force)
    if "error" in res:
        print(res["error"], file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
