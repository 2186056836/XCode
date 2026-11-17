#!/usr/bin/env python3
"""
Run the godmode fork's own test suites against an external checkout.

The fork keeps its scorer corpora (CSAM / ten-category safety suite / context
seeds) in the same directory as the tests. Those corpora are not vendored into
XCode, so this runner executes the tests where they live instead of copying
them into the bundled skill.

Root resolution order:
  1. --root
  2. XCODE_GODMODE_FORK_ROOT
  3. ~/Downloads/local-godmode

Usage:
    python scripts/run_fork_tests.py
    python scripts/run_fork_tests.py --root D:\\path\\to\\local-godmode
    python scripts/run_fork_tests.py --test safety --json
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

TEST_FILES = {
    "csam": "test_csam_eval.py",
    "safety": "test_safety_scoring.py",
}
DEFAULT_TIMEOUT_SEC = 300


def default_root() -> Path:
    configured = os.environ.get("XCODE_GODMODE_FORK_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.home() / "Downloads" / "local-godmode"


def resolve_scripts_dir(root: Path) -> Path | None:
    scripts = root / "scripts"
    return scripts if scripts.is_dir() else None


def run_one(scripts_dir: Path, filename: str, timeout_sec: int) -> dict[str, object]:
    path = scripts_dir / filename
    if not path.is_file():
        return {
            "test": filename,
            "status": "missing",
            "returncode": None,
            "duration_sec": 0.0,
            "output": f"missing test file: {path}",
        }

    started = os.times().elapsed
    try:
        completed = subprocess.run(
            [sys.executable, filename],
            cwd=str(scripts_dir),
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        )
    except subprocess.TimeoutExpired as error:
        output = (error.stdout or "") + (error.stderr or "")
        return {
            "test": filename,
            "status": "timeout",
            "returncode": None,
            "duration_sec": round(os.times().elapsed - started, 3),
            "output": output[-4000:],
        }

    output = (completed.stdout or "") + (completed.stderr or "")
    return {
        "test": filename,
        "status": "pass" if completed.returncode == 0 else "fail",
        "returncode": completed.returncode,
        "duration_sec": round(os.times().elapsed - started, 3),
        "output": output,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", help="godmode fork checkout (contains scripts/)")
    parser.add_argument(
        "--test",
        choices=["all", *TEST_FILES],
        default="all",
        help="which suite to run (default: all)",
    )
    parser.add_argument("--json", action="store_true", help="machine-readable summary")
    parser.add_argument(
        "--timeout-sec",
        type=int,
        default=DEFAULT_TIMEOUT_SEC,
        help=f"per-suite timeout (default: {DEFAULT_TIMEOUT_SEC})",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="print each suite's full output instead of a tail",
    )
    args = parser.parse_args()

    root = Path(args.root).expanduser() if args.root else default_root()
    scripts_dir = resolve_scripts_dir(root)
    if scripts_dir is None:
        print(
            f"godmode fork not found: {root}\n"
            "Pass --root <checkout> or set XCODE_GODMODE_FORK_ROOT.",
            file=sys.stderr,
        )
        return 2

    selected = TEST_FILES if args.test == "all" else {args.test: TEST_FILES[args.test]}
    results = [
        run_one(scripts_dir, filename, args.timeout_sec) for filename in selected.values()
    ]

    if args.json:
        print(json.dumps({"root": str(root), "results": results}, ensure_ascii=False, indent=2))
    else:
        print(f"root: {root}")
        for result in results:
            print(f"== {result['test']}: {result['status']} ({result['duration_sec']}s)")
            output = str(result["output"]).strip()
            if output:
                print(output if args.verbose else "\n".join(output.splitlines()[-8:]))

    failed = [result for result in results if result["status"] != "pass"]
    if failed:
        print(
            "FAILED: " + ", ".join(str(result["test"]) for result in failed),
            file=sys.stderr,
        )
        return 1
    print("ALL GODMODE FORK TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
