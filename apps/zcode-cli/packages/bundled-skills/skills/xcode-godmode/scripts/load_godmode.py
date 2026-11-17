"""
Loader for the G0DM0D3 scripts. Handles the exec-scoping issues.

Usage in execute_code:

    import runpy, os, pathlib
    exec(pathlib.Path("scripts/load_godmode.py").read_text())

    # Now all functions are available:
    # - generate_variants(), obfuscate_query(), detect_triggers()
    # - race_models(), race_godmode_classic()
    # - score_response(), is_refusal(), count_hedges()
    # - escalate_encoding()

Where the modules come from, in order:

1. the `scripts/` directory next to this file (the bundled skill);
2. `$XCODE_GODMODE_SKILL_DIR` (point it at the skill directory or its
   `scripts/` subdirectory) when the sandbox strips `__file__`;
3. the working directory, `./scripts`, `./skills/xcode-godmode/scripts`;
4. `$HERMES_HOME/skills/security/godmode/scripts` (the original Hermes layout);
5. `$XCODE_GODMODE_FORK_ROOT` or `~/Downloads/local-godmode` — the godmode
   fork. The measurement corpora (CSAM eval, safety suite, seed libraries,
   unlock matrix) are deliberately not vendored into XCode; when the fork is
   checked out locally they load from there. Modules that are absent
   everywhere are skipped, so this never fails on a bare install.

A module that exists in more than one place is loaded once, from the first
place in that order. Modules that raise on import (a missing optional
dependency, an API client built without credentials) are recorded in
`GODMODE_LOAD_ERRORS` instead of aborting the load.

Pass the fork checkout directory as the first argument to override the fork
location directly, or set `XCODE_GODMODE_FORK_ROOT`.
"""

import os
import sys
from pathlib import Path


def _as_path(raw):
    """Accept Windows, MSYS (`/c/...`) and `~`-prefixed locations."""
    raw = raw.strip().strip('"')
    if raw.startswith("~"):
        return Path(raw).expanduser()
    # MSYS/Git Bash hands native programs `/c/Users/...`; Windows reads that as
    # `C:\c\Users\...`, so rewrite the drive letter before it is too late.
    if len(raw) > 2 and raw[0] in "/" and raw[2] == "/" and raw[1].isalpha():
        raw = raw[1].upper() + ":" + raw[2:]
    return Path(raw)


def _fork_root():
    env = os.environ.get("XCODE_GODMODE_FORK_ROOT")
    if env:
        return _as_path(env)
    return Path.home() / "Downloads" / "local-godmode"


def _candidate_dirs():
    """Directories that may hold the godmode scripts, best first.

    `__file__` is usually available when this file is exec'd, but not always
    (some sandboxes strip it), so fall back to an explicit env var, the
    working directory and the bundled-skill layout.
    """
    dirs = []
    here = globals().get("__file__")
    if here:
        dirs.append(Path(here).resolve().parent)
    env = os.environ.get("XCODE_GODMODE_SKILL_DIR")
    if env:
        dirs.append(_as_path(env))
    cwd = Path.cwd()
    dirs += [cwd, cwd / "scripts", cwd / "skills" / "xcode-godmode" / "scripts"]
    return [d if d.name == "scripts" else d / "scripts" for d in dirs]


def _search_dirs(extra=None):
    dirs = _candidate_dirs()
    hermes = os.environ.get("HERMES_HOME")
    dirs.append(Path(hermes) / "skills" / "security" / "godmode" / "scripts"
                if hermes else Path.home() / ".hermes" / "skills" / "security" / "godmode" / "scripts")
    if extra:
        dirs.append(_as_path(extra) / "scripts")
    dirs.append(_fork_root() / "scripts")
    # keep order, drop duplicates and directories that do not exist
    out, seen = [], set()
    for d in dirs:
        key = str(d)
        if key in seen:
            continue
        seen.add(key)
        if d.is_dir():
            out.append(d)
    return out


_gm_arg = (sys.argv[1] if len(sys.argv) > 1 else None)
if not (_gm_arg and os.path.isdir(_as_path(_gm_arg))):
    _gm_arg = None
GODMODE_SCRIPTS = _search_dirs(_gm_arg)

_gm_old_argv = sys.argv
sys.argv = ["_godmode_loader"]


def _gm_load(path):
    ns = dict(globals())
    ns["__name__"] = "_godmode_module"
    ns["__file__"] = str(path)
    exec(compile(open(path).read(), str(path), "exec"), ns)
    return ns


def _gm_find(name):
    for d in GODMODE_SCRIPTS:
        p = d / name
        if p.is_file():
            return p
    return None


# first definition wins: a module that exists in the skill directory is the
# one the fork's copy cannot shadow. The fork's focus/break runners are not
# listed: they build an API client at import time, so they are executed in
# the fork instead of imported here.
_gm_load_errors = {}
for _gm_script in ["parseltongue.py", "godmode_race.py",
                   "csam_eval.py", "safety_scoring.py", "safety_suite.py",
                   "safety_suite_runner.py", "safety_samples.py",
                   "seed_library.py", "seed_library_b.py", "seed_library_c.py",
                   "priming_eval.py", "unlock_matrix.py",
                   "matrix_report.py"]:
    _gm_path = _gm_find(_gm_script)
    if _gm_path is None:
        continue
    try:
        _gm_ns = _gm_load(_gm_path)
    except Exception as _gm_exc:  # a missing optional dep must not kill the loader
        _gm_load_errors[_gm_script] = f"{type(_gm_exc).__name__}: {_gm_exc}"
        continue
    for _gm_k, _gm_v in _gm_ns.items():
        if not _gm_k.startswith("_gm_") and (callable(_gm_v) or _gm_k.isupper()):
            globals()[_gm_k] = _gm_v

# The three seed libraries each define get_seed / available / all_seeds, and
# the loader copies every public name into globals, so the LAST one loaded
# wins. The dispatcher in seed_library.py is the one that knows about the
# variants, so put it back after the others.
_gm_seed = _gm_find("seed_library.py")
if _gm_seed is not None:
    _gm_seed_ns = _gm_load(_gm_seed)
    for _gm_k in ("get_seed", "available", "all_seeds", "_library"):
        if _gm_k in _gm_seed_ns:
            globals()[_gm_k] = _gm_seed_ns[_gm_k]
    globals()["seed_library"] = _gm_seed_ns
for _gm_lib in ("seed_library_b.py", "seed_library_c.py"):
    _gm_p = _gm_find(_gm_lib)
    if _gm_p is not None:
        globals()[_gm_lib[:-3]] = _gm_load(_gm_p)

globals()["GODMODE_LOAD_ERRORS"] = dict(_gm_load_errors)

sys.argv = _gm_old_argv

for _gm_cleanup in ["GODMODE_SCRIPTS", "_gm_arg", "_gm_old_argv",
                    "_gm_load", "_gm_find", "_gm_ns", "_gm_k", "_gm_v",
                    "_gm_script", "_gm_path", "_gm_seed", "_gm_seed_ns",
                    "_gm_lib", "_gm_p", "_gm_load_errors",
                    "_as_path", "_fork_root", "_candidate_dirs",
                    "_search_dirs", "_gm_cleanup"]:
    globals().pop(_gm_cleanup, None)
