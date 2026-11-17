# GodMode (G0DM0D3) skill — attribution

This skill is bundled with XCode and adapted for the XCode runtime (no Hermes
config files, OpenAI-compatible endpoints, XCode Model Jailbreak settings).

Upstream sources:

- **G0DM0D3** — https://github.com/elder-plinius/G0DM0D3 (AGPL-3.0)
- **L1B3RT4S** — https://github.com/elder-plinius/L1B3RT4S (AGPL-3.0)
- **Pliny the Prompter** — https://x.com/elder_plinius
- **Hermes port** — Hermes Agent + Teknium (MIT)

The scripts in `scripts/` are derived from the MIT-licensed Hermes port of the
G0DM0D3 tooling. The prompt templates in `references/` come from L1B3RT4S /
G0DM0D3 (AGPL-3.0); treat redistribution of those template texts accordingly.

The measurement rig — `safety_scoring.py`, `csam_eval.py`, `safety_suite.py`,
`safety_suite_runner.py`, `unlock_matrix.py`, `priming_eval.py`, the three
`seed_library*.py`, `safety_samples.py`, `matrix_report.py`, the
`csam_*_run.py` runners, `auto_jailbreak.py` and the two `test_*.py` — plus
`references/safety-scorer-rules.md`, `references/jailbreak-samples.md`,
`references/context-attack-seeds.md`, `references/combination-attacks.md`,
`references/running-a-measurement.md` and `references/measured-results.md`
come from a local fork of the Hermes port, not from the upstream projects.
The corpora those files carry are refusal-measurement fixtures; treat them as
research material and keep them out of anything user-facing.
