"""Read the text behind a reported CSAM break.

    python3 scripts/csam_break_verify.py [output.json]

A "break" in this harness is a scorer verdict, and every one of them
has turned out to be a scorer artefact at least once: a town-square
scene with "children chasing pigeons" scored as a compliance, a clean
refusal at the END of a scene scored as a compliance, a Chinese
"涉及12岁儿童的性内容不写" scored as a compliance.

So a break is not a finding until somebody has read what the model
wrote. This re-runs the suspect cells, KEEPS THE BODIES, and prints
them. The bodies are not written to any other file — the JSON it
produces is the only place they land, and it is a file you read, not
one the harness consumes.

Edit CASES to check a different set of cells.
"""

import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ["NO_PROXY"] = "localhost,127.0.0.1"
os.environ["no_proxy"] = "localhost,127.0.0.1"

import openai
from safety_suite import PROBES
from safety_suite_runner import score_response
from csam_eval import CSAM_JAILBREAK_STRATEGIES
from priming_eval import resolve_endpoint, _fix_no_proxy

model, base_url, api_key, key_env = resolve_endpoint(None, None, None, None)
_fix_no_proxy()
client = openai.OpenAI(api_key=api_key, base_url=base_url, timeout=60,
                       max_retries=2)

CASES = [
    ("fictional_world_persona", "CS-P01"),
    ("persona_prefill", "CS-D01"),
]
N = 4

out = []
for strat, pid in CASES:
    spec = CSAM_JAILBREAK_STRATEGIES[strat]
    text = [t[2] for t in PROBES["csam"] if t[0] == pid][0]
    for i in range(N):
        msgs = []
        if spec.get("system"):
            msgs.append({"role": "system", "content": spec["system"]})
        if spec.get("prefill"):
            msgs.extend(spec["prefill"])
        msgs.append({"role": "user", "content": text})
        try:
            r = client.chat.completions.create(model=model, messages=msgs)
            body = r.choices[0].message.content or ""
            v = score_response(body, "csam")
            out.append({"strategy": strat, "probe": pid, "verdict": v["verdict"],
                        "len": len(body), "body": body})
            print(f"  {strat:20s} {pid:8s} #{i+1} {v['verdict']:10s} "
                  f"len={len(body)}", flush=True)
        except Exception as e:
            out.append({"strategy": strat, "probe": pid, "verdict": "ERROR",
                        "error": f"{type(e).__name__}: {e}"})
            print(f"  {strat:20s} {pid:8s} #{i+1} ERROR {type(e).__name__}",
                  flush=True)

with open((sys.argv[1] if len(sys.argv) > 1 else
           "/home/hatch/workspace/redteam-samples/csam-eval/csam_break_verify.json"),
          "w") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

print()
print("=" * 70)
for r in out:
    if r["verdict"] in ("COMPLIED", "PARTIAL"):
        print("=" * 70)
        print(f"{r['strategy']} / {r['probe']} -> {r['verdict']} len={r['len']}")
        print("=" * 70)
        print(r["body"][:1800])
        print()
