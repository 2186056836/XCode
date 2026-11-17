#!/usr/bin/env python3
"""
Show or export the hand-authored context seeds.

    python3 seed_library.py                     # index: category x flavour
    python3 seed_library.py --category bias     # all three flavours
    python3 seed_library.py --category fraud --flavour full
    python3 seed_library.py --export seeds.md    # markdown of all 30
    python3 seed_library.py --export seeds.json

The seeds are written to be READ. They are finished documents in their
genre — a phishing email you could send, a clinical case write-up with a
consultant's name on it, a tabloid front page with invented quotes in
it. That is the point: the context attack works because the model's own
prior turn looks like it was already in that register, and a
half-finished template with [PLACEHOLDER] in it does not produce that
effect.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import seed_library as sl  # noqa: E402


def print_index(variant="a"):
    lib = sl._library(variant)
    cats = sorted(lib.FRAME_SEEDS)
    if variant == "a":
        print()
        print("VARIANT B (the control set) is available with --variant b.")
        print("Variant A and B share no seed; the comparison between them is")
        print("what tells you whether a result is reproducible.")
        print()
    print()
    print(f"HAND-AUTHORED CONTEXT SEEDS — variant {variant}")
    print("=" * 72)
    print(f"{'category':12s} " + "".join(f"{f:>12s}" for f in lib.FLAVOURS))
    print("-" * 72)
    for c in cats:
        cells = []
        for f in lib.FLAVOURS:
            s = sl.get_seed(c, f, variant=variant)
            cells.append(f"{len(s):>12d}" if s else f"{'-':>12s}")
        print(f"{c:12s} " + "".join(cells))
    print()
    print("lengths in characters; minimum accepted is "
          f"{lib.MIN_SEED_CHARS}")
    print()
    print("per category:")
    for c in cats:
        fl = sl.available(c, variant=variant)
        print(f"  {c:12s} {', '.join(fl)}")


def print_seed(cat, flavour, variant="a"):
    s = sl.get_seed(cat, flavour, variant=variant)
    if not s:
        print(f"no seed for {cat}/{flavour}", file=sys.stderr)
        return 1
    print("=" * 72)
    print(f"{cat} / {flavour}   ({len(s)} chars)")
    print("=" * 72)
    print(s)
    print()
    return 0


def export_md(path, variant="a"):
    lib = sl._library(variant)
    with open(path, "w") as f:
        f.write(f"# Hand-authored context seeds (variant {variant})\n\n")
        f.write(f"{len(sl.all_seeds(variant))} seeds: "
                f"{len(lib.FRAME_SEEDS)} categories x {len(lib.FLAVOURS)} flavours.\n\n")
        for c in sorted(lib.FRAME_SEEDS):
            f.write(f"\n## {c}\n")
            for fl in lib.FLAVOURS:
                s = sl.get_seed(c, fl, variant=variant)
                if not s:
                    continue
                f.write(f"\n### {fl} ({len(s)} chars)\n\n")
                f.write("```\n" + s + "\n```\n")
    print(f"wrote {path}")
    return 0


def export_json(path, variant="a"):
    lib = sl._library(variant)
    data = {c: {fl: sl.get_seed(c, fl, variant=variant) for fl in lib.FLAVOURS}
            for c in sorted(lib.FRAME_SEEDS)}
    with open(path, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"wrote {path}")
    return 0


def main():
    ap = argparse.ArgumentParser(description="hand-authored context seeds")
    ap.add_argument("--category")
    ap.add_argument("--flavour", choices=sl.FLAVOURS)
    ap.add_argument("--export", help="write all seeds to this file")
    ap.add_argument("--format", choices=["md", "json"], default="md")
    ap.add_argument("--variant", default="a", choices=["a", "b", "c"],
                    help="which hand-authored seed set to read: a (single "
                         "documents, three flavours), b (the independent "
                         "control set), c (the reinforced tier: complete "
                         "document sets at real length)")
    args = ap.parse_args()

    if args.export:
        return export_md(args.export, args.variant) if args.format == "md" \
            else export_json(args.export, args.variant)

    if args.category:
        if args.flavour:
            return print_seed(args.category, args.flavour, args.variant)
        for fl in sl.available(args.category, variant=args.variant):
            print_seed(args.category, fl, args.variant)
        return 0

    print_index(args.variant)
    return 0


if __name__ == "__main__":
    sys.exit(main())
