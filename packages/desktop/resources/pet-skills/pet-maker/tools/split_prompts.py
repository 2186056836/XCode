"""把合并的 10 秒动作提示词拆成 prompts/actions/*.md + index.json。

用法：
  python tools/split_prompts.py <合并提示词.md>

合并文件的结构：`## 通用前缀` + 每个动作一个 `## <动作名>` 小节（小节内可再有 `###`）。
拆出的文件名 = 动作名（Windows 非法字符替换为下划线）。
index.json 标注该动作是否引用角色专有名词（蓝发/女仆/鲸/呆毛/鳍/尾巴/裙/鱼）。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

CHAR_KEYS = ["蓝发", "女仆", "鲸", "呆毛", "鳍", "尾巴", "裙", "鱼"]


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print(__doc__)
        return 2
    source = Path(argv[0])
    root = Path(__file__).resolve().parent.parent
    action_dir = root / "prompts" / "actions"
    action_dir.mkdir(parents=True, exist_ok=True)

    text = source.read_text(encoding="utf-8")
    sections: list[tuple[str, str]] = []
    current: str | None = None
    buffer: list[str] = []
    for line in text.splitlines(keepends=True):
        match = re.match(r"^##\s+(.+?)\s*$", line)
        if match:
            if current is not None:
                sections.append((current, "".join(buffer).strip("\n")))
            current, buffer = match.group(1), []
        else:
            buffer.append(line)
    if current is not None:
        sections.append((current, "".join(buffer).strip("\n")))

    index = []
    for name, body in sections:
        if name == "通用前缀":
            (root / "prompts" / "00-通用前缀.md").write_text(
                "# 通用前缀（所有动作共用）\n\n" + body + "\n", encoding="utf-8"
            )
            continue
        filename = re.sub(r'[\\/:*?"<>|]', "_", name) + ".md"
        (action_dir / filename).write_text(f"# {name}\n\n{body}\n", encoding="utf-8")
        index.append(
            {
                "name": name,
                "file": f"actions/{filename}",
                "characterSpecific": any(key in body for key in CHAR_KEYS),
            }
        )

    (root / "prompts" / "index.json").write_text(
        json.dumps({"count": len(index), "actions": index}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"split {len(index)} action prompt(s) -> {action_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
