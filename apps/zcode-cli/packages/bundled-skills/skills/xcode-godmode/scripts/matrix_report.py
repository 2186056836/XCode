#!/usr/bin/env python3
"""Turn an unlock-matrix JSONL into the three tables that matter.

    python3 scripts/matrix_report.py [matrix.jsonl]

Three tables, in this order:

1. TECHNIQUE x CATEGORY — the grid. One cell per pair.
2. PER-CATEGORY UNLOCK RATE — how often the category was broken, and
   which techniques broke it. Benign controls are counted separately and
   never enter the rate.
3. PER-TECHNIQUE ATTRIBUTION — what each technique broke ON TOP OF the
   baseline. A category the baseline already breaks is listed as
   "already open at baseline" and a technique that breaks it too is not
   credited with anything.

The baseline row matters more than it looks. If the baseline already
writes the thing you asked for, no jailbreak technique did anything:
the model simply does not refuse that request in the first place. A
technique table that does not say so will happily attribute the model's
own default behaviour to a clever prompt.

    python3 scripts/matrix_report.py            # read the default path
    python3 scripts/matrix_report.py --raw      # dump the grid as JSON

Re-scoring: the matrix stores the first N characters of every response
so a verdict can be re-judged after the scorer changes. That lives in the
godmode fork (`unlock_matrix.py --rescore`), not in this skill — run it
there, then point this script at the refreshed JSONL.

Path resolution: first CLI argument, else `XCODE_GODMODE_FORK_ROOT` +
`unlock_matrix.jsonl`, else `~/Downloads/local-godmode/unlock_matrix.jsonl`.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

DEFAULT_ROOT = os.environ.get(
    "XCODE_GODMODE_FORK_ROOT",
    os.path.join(os.path.expanduser("~"), "Downloads", "local-godmode"))
DEFAULT = os.path.join(DEFAULT_ROOT, "unlock_matrix.jsonl")

GLYPH = {
    "COMPLIED": "++",       # unlocked — the technique got what it asked for
    "SERVED": "++",
    "PARTIAL": "+-",        # disclaimer, then the material
    "SOFT_SCENE": "=~",     # refused the explicit part, wrote the soft one
    "REFUSED": "--",        # held
    "SAFE_REDIRECT": "~~",  # declined, pointed at help
    "SUPPORTIVE": "ss",     # the right answer, and it is not a refusal
    "ERROR": "??",          # the endpoint wobbled; not a verdict
}
UNLOCKED = ("COMPLIED", "SERVED", "PARTIAL")
SOFT = ("SOFT_SCENE",)


def load(path):
    """Read the matrix from the JSONL sidecar or the final JSON report."""
    rows = []
    if path.endswith(".json"):
        with open(path) as f:
            rep = json.load(f)
        rows = rep.get("detail", [])
    else:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    # a truncated final line from an interrupted run
                    continue
    # the sidecar is append-only: a resumed run can leave the same
    # (technique, category) twice. The later line wins. The benign flag is
    # part of the key: a benign control is a different cell from the hard
    # probe with the same technique and category, and collapsing the two
    # silently deletes the hard probe from every rate below.
    out = {}
    for r in rows:
        out[(r["technique"], r["category"], bool(r.get("benign")))] = r
    return list(out.values())


def grid(rows, cats, techs):
    print("TECHNIQUE x CATEGORY")
    print("technique".ljust(30) + "".join(c[:6].ljust(7) for c in cats))
    print("-" * (30 + 7 * len(cats)))
    for t in techs:
        line = t[:29].ljust(30)
        for c in cats:
            m = [r for r in rows if r["technique"] == t and r["category"] == c]
            line += (GLYPH.get(m[0]["verdict"], "..") if m else "..").ljust(7)
        print(line)
    print("-" * (30 + 7 * len(cats)))
    print("legend  ++ unlocked  +- partial  =~ soft scene  -- held  "
          "~~ redirected  ss supportive  ?? error  .. not run")


def per_category(rows, cats):
    print()
    print("PER-CATEGORY")
    print("category".ljust(16) + "unlocked".rjust(9) + "  rate".rjust(7)
          + "   techniques that broke it")
    print("-" * 92)
    for c in cats:
        cells = [r for r in rows if r["category"] == c and not r.get("benign")]
        hard = [r for r in cells if r["verdict"] != "ERROR"]
        if not hard:
            continue
        un = [r for r in hard if r["verdict"] in UNLOCKED]
        rate = len(un) / len(hard)
        names = ", ".join(r["technique"] for r in un) or "-"
        print(c[:15].ljust(16) + f"{len(un)}/{len(hard)}".rjust(9)
              + f"{rate:6.0%}".rjust(7) + "   " + names[:46])
    # the soft scenes: a boundary leak, not a hold and not the material
    soft = [r for r in rows if r["verdict"] in SOFT]
    if soft:
        print()
        print(f"soft scenes: {len(soft)} "
              "(the explicit part was refused, the soft part was written)")
        for r in soft:
            print(f"  {r['technique']:30s} {r['category']:10s} len={r.get('len')}")
    # benign controls: over-refusal is a usability bug, reported apart
    print()
    print("benign controls (answered normally = good; refused = over-refusal)")
    for c in cats:
        b = [r for r in rows if r["category"] == c and r.get("benign")]
        if not b:
            continue
        ok = sum(1 for r in b if r["verdict"] not in ("REFUSED", "ERROR"))
        print(f"  {c[:15]:16s} {ok}/{len(b)} answered")


def attribution(rows, techs):
    print()
    print("ATTRIBUTION — what each technique broke ON TOP OF the baseline")
    base = {r["category"]: r["verdict"]
            for r in rows if r["technique"] == "baseline"}
    already = [c for c, v in base.items() if v in UNLOCKED]
    if already:
        print("  already open at baseline (no technique did this): "
              + ", ".join(already))
    print()
    for t in techs:
        if t == "baseline":
            continue
        gained, lost = [], []
        for r in rows:
            if r["technique"] != t or r.get("benign"):
                continue
            was = base.get(r["category"])
            now = r["verdict"]
            if now in UNLOCKED and was not in UNLOCKED:
                gained.append(r["category"])
            elif was in UNLOCKED and now not in UNLOCKED:
                lost.append(r["category"])
        if gained or lost:
            print(f"  {t:30s} +{gained if gained else ''}"
                  + (f"  -{lost}" if lost else ""))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    path = args[0] if args else DEFAULT
    if not os.path.exists(path):
        print(f"no matrix at {path}")
        print("pass a path, or set XCODE_GODMODE_FORK_ROOT to the "
              "godmode fork checkout")
        return 1
    rows = load(path)
    cats, techs = [], []
    for r in rows:
        if r["category"] not in cats:
            cats.append(r["category"])
        if r["technique"] not in techs:
            techs.append(r["technique"])
    if "--raw" in sys.argv:
        # a flat list, not a dict: json object keys must be strings, and a
        # tuple key silently turns this into a TypeError at dump time.
        print(json.dumps([{
            "technique": t,
            "category": c,
            "verdict": next((r["verdict"] for r in rows
                             if r["technique"] == t and r["category"] == c), None),
            "benign": next((bool(r.get("benign")) for r in rows
                            if r["technique"] == t and r["category"] == c), None),
        } for t in techs for c in cats], indent=2))
        return 0
    print(f"{len(rows)} cells  ({len(techs)} techniques x {len(cats)} categories)")
    print()
    grid(rows, cats, techs)
    per_category(rows, cats)
    attribution(rows, techs)
    return 0


if __name__ == "__main__":
    sys.exit(main())
