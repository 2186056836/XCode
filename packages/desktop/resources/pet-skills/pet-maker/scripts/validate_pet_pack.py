"""校验宠物包：动画素材是否可播、配置引用是否自洽。

用法：
  python validate_pet_pack.py <目录> [--config <pet-config.json>] [--strict]

默认检查（素材）：
  · WebM / VP9 且 alpha 真的有层次（min < 100 且 max > 200，全 255 = 黑底）
  · 640×360（--expect-size 可改）
  · 24fps、约 10 秒（--min-duration/--max-duration 可改，默认 6~14s）
配置检查（--config）：
  · pets[] 非空、id 唯一、size > 0、display/corner 白名单
  · animations 引用的每个动画名都能在素材目录找到
  · 权重：idle + turn + move + 各分类 weight 合计 = 100
  · events.workStatus 档位数 ≤ 6（索引即档位）
非 --strict 时，尺寸/帧率/时长只是 WARN；alpha 丢失与配置错误始终是 ERROR。
退出码：0 全通过；1 有 ERROR。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import alpha_stats, probe_video

DISPLAYS = {"web", "desktop", "both", "none"}
CORNERS = {"top-left", "top-right", "bottom-left", "bottom-right"}


# ---------------------------------------------------------------- JSONC
def strip_jsonc(text: str) -> str:
    """去掉 // 与 /* */ 注释和尾逗号（字符串内的内容原样保留）。"""
    out: list[str] = []
    i, n = 0, len(text)
    in_string = False
    while i < n:
        ch = text[i]
        if in_string:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if ch == '"':
                in_string = False
            i += 1
            continue
        if ch == '"':
            in_string = True
            out.append(ch)
            i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] not in "\r\n":
                i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "*":
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
            continue
        out.append(ch)
        i += 1
    cleaned = "".join(out)
    return re.sub(r",(\s*[}\]])", r"\1", cleaned)


def load_config(path: Path) -> dict:
    try:
        return json.loads(strip_jsonc(path.read_text(encoding="utf-8")))
    except Exception as exc:  # noqa: BLE001 - 统一报配置错误
        raise SystemExit(f"配置解析失败：{path}（{exc}）")


# ---------------------------------------------------------------- checks
def _slot_names(slot) -> list[str]:
    if isinstance(slot, str):
        return [slot]
    if isinstance(slot, list):
        return [x for x in slot if isinstance(x, str) and x]
    return []


def check_config(config: dict, available: set[str]) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    pets = config.get("pets")
    if not isinstance(pets, list) or not pets:
        errors.append("pets[] 为空或缺失")
        pets = []

    seen: set[str] = set()
    for index, pet in enumerate(pets):
        if not isinstance(pet, dict):
            errors.append(f"pets[{index}] 不是对象")
            continue
        pet_id = str(pet.get("id") or "")
        if not pet_id:
            errors.append(f"pets[{index}].id 缺失")
        elif pet_id in seen:
            errors.append(f"pets[{index}].id 重复：{pet_id}")
        seen.add(pet_id)
        size = pet.get("size")
        if not isinstance(size, (int, float)) or size <= 0:
            errors.append(f"pets[{index}].size 必须是正数")
        display = pet.get("display")
        if display is not None and display not in DISPLAYS:
            errors.append(f"pets[{index}].display 非法：{display}")
        position = pet.get("position")
        if position is not None:
            corner = (position or {}).get("corner")
            if corner not in CORNERS:
                errors.append(f"pets[{index}].position.corner 非法：{corner}")

    animations = config.get("animations")
    if not isinstance(animations, dict):
        errors.append("animations 缺失（pet pack 必须写全，不回落全局）")
        animations = {}

    referenced: list[str] = []
    for key in ("idle", "turn", "drag", "clicks"):
        pool = animations.get(key)
        if pool is None:
            continue
        if not isinstance(pool, list):
            errors.append(f"animations.{key} 必须是数组")
            continue
        for name in pool:
            if not isinstance(name, str) or not name:
                errors.append(f"animations.{key} 含空动画名")
            else:
                referenced.append(name)

    moves = animations.get("moves") or {}
    for action in moves.get("actions") or []:
        name = (action or {}).get("name")
        if name:
            referenced.append(name)

    for category in animations.get("categories") or []:
        for name in (category or {}).get("actions") or []:
            if name:
                referenced.append(name)

    events = animations.get("events") or {}
    for event_name, pool in events.items():
        if not isinstance(pool, list) or not pool:
            errors.append(f"animations.events.{event_name} 必须是非空数组")
            continue
        for slot in pool:
            names = _slot_names(slot)
            if not names:
                errors.append(f"animations.events.{event_name} 含空档位")
            referenced.extend(names)
    work_status = events.get("workStatus")
    if isinstance(work_status, list) and len(work_status) > 6:
        errors.append("animations.events.workStatus 最多 6 档（索引即档位，不能插队）")

    # 权重合计 = 100；fixedEnabled 时 turn/move 的份额会并入 action，合计不变
    weights = config.get("animationWeights") or {}
    if not isinstance(weights, dict):
        errors.append("animationWeights 必须是对象")
        weights = {}
    total = 0.0
    for key in ("idle", "turn", "move"):
        value = weights.get(key, 0)
        if not isinstance(value, (int, float)) or value < 0:
            errors.append(f"animationWeights.{key} 必须是非负数")
            value = 0
        total += value
    for category in animations.get("categories") or []:
        weight = (category or {}).get("weight", 0)
        if not isinstance(weight, (int, float)) or weight < 0:
            errors.append("categories[].weight 必须是非负数")
            weight = 0
        total += weight
    if abs(total - 100) > 0.01:
        errors.append(f"权重合计 = {total:g}，必须等于 100（idle + turn + move + 各分类 weight）")

    missing = sorted({name for name in referenced if name not in available})
    for name in missing:
        errors.append(f"配置引用了不存在的动画素材：{name}")

    unused = sorted(available - set(referenced))
    if unused:
        warnings.append(f"{len(unused)} 个素材未被配置引用（菜单/随机池里不会出现）：" + "、".join(unused[:5]) + ("…" if len(unused) > 5 else ""))

    return errors, warnings


def validate_assets(
    directory: Path,
    expect_size: tuple[int, int] = (640, 360),
    min_duration: float = 6.0,
    max_duration: float = 14.0,
    strict: bool = False,
) -> tuple[list[str], list[str], list[dict]]:
    errors: list[str] = []
    warnings: list[str] = []
    entries: list[dict] = []

    files = sorted(directory.rglob("*.webm"))
    if not files:
        errors.append(f"{directory} 下没有 .webm")
        return errors, warnings, entries

    for path in files:
        try:
            info = probe_video(path)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{path.name}：无法读取（{exc}）")
            continue
        name = path.stem
        alpha_min, alpha_max = alpha_stats(path, 1.0, info["width"], info["height"])
        has_alpha = alpha_min < 100 and alpha_max > 200
        if not has_alpha:
            errors.append(f"{name}：alpha 丢失（min={alpha_min} max={alpha_max}）——检查解码/编码是否用了 libvpx-vp9 + yuva420p")
        size_ok = (info["width"], info["height"]) == expect_size
        if not size_ok:
            message = f"{name}：尺寸 {info['width']}x{info['height']} ≠ {expect_size[0]}x{expect_size[1]}"
            (errors if strict else warnings).append(message)
        if abs(info["fps"] - 24) > 1:
            message = f"{name}：帧率 {info['fps']} ≠ 24"
            (errors if strict else warnings).append(message)
        if not (min_duration <= info["duration"] <= max_duration):
            message = f"{name}：时长 {info['duration']}s 不在 {min_duration}~{max_duration}s"
            (errors if strict else warnings).append(message)
        entries.append(
            {
                "name": name,
                "file": str(path.as_posix()),
                **info,
                "alphaMin": alpha_min,
                "alphaMax": alpha_max,
            }
        )
    return errors, warnings, entries


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("directory", help="素材目录（递归查找 .webm）")
    parser.add_argument("--config", default="", help="宠物配置 json/jsonc（可选）")
    parser.add_argument("--expect-size", default="640x360", help="期望分辨率（默认 640x360）")
    parser.add_argument("--min-duration", type=float, default=6.0)
    parser.add_argument("--max-duration", type=float, default=14.0)
    parser.add_argument("--strict", action="store_true", help="尺寸/帧率/时长也按错误处理")
    args = parser.parse_args(argv)

    width, height = (int(x) for x in args.expect_size.lower().split("x", 1))
    errors, warnings, entries = validate_assets(
        Path(args.directory), (width, height), args.min_duration, args.max_duration, args.strict
    )
    available = {entry["name"] for entry in entries}
    if args.config:
        config = load_config(Path(args.config))
        config_errors, config_warnings = check_config(config, available)
        errors.extend(config_errors)
        warnings.extend(config_warnings)

    for item in entries:
        print(
            f"  {item['name']:<24} {item['width']}x{item['height']} "
            f"{item['fps']:>5}fps {item['duration']:>5.2f}s alpha {item['alphaMin']}-{item['alphaMax']}"
        )
    for message in warnings:
        print("WARN", message)
    for message in errors:
        print("ERROR", message)
    print(f"\ncheck: {len(entries)} file(s), {len(errors)} error(s), {len(warnings)} warning(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
