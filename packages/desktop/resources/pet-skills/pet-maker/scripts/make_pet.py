"""一条命令跑完素材链：绿幕视频 → 透明动画 → 播放变体 → 清单 → 配置。

典型用法：
  # 1) 把 AI 生成的绿幕 mp4 放进 video/，或把 PR 抠好的 mov 放进 pr/
  python make_pet.py --pet-id mypet --pet-name "我的宠物"
  # 2) 产出在 dist/：webm/（640×360 VP9-alpha）、manifest.json、pet/mypet-config.json
  # 3) 直接装进 dsh-pet 用户目录：
  python make_pet.py --pet-id mypet --pet-name "我的宠物" --install-root "$USERPROFILE/.dsh/dsh-pet"

只跑其中一段：
  python make_pet.py --steps chroma
  python make_pet.py --steps normalize
  python make_pet.py --steps encode
  python make_pet.py --steps config

没有水印素材时默认跳过 step01；没有 pr/*.mov 时只走自动抠像（chroma）。
两条路线可以同时用：先自动抠像，再用 pr 的手工结果覆盖同名动作。
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
from validate_pet_pack import check_config, validate_assets  # noqa: E402

CANONICAL = {
    "idle": ["待机呼吸休闲"],
    "turn": ["东张西望"],
    "drag": ["被鼠标拖拽悬空反馈"],
    "moves": ["螃蟹走路", "原地漂浮踏步", "原地左转奔跑"],
    "balance": [
        "余额-钱袋满溢",
        "余额-金袋叮当",
        "余额-钱袋如常",
        "余额-数金皱眉",
        "余额-袋空如洗",
        "余额-分文不剩",
    ],
    "workStatus": [
        "工作状态-思考冒泡",
        "工作状态-忙碌点按",
        "工作状态-清点归档",
        "工作状态-原地踱步张望",
        "工作状态-雀跃庆祝",
        "工作状态-垂头叹气冒汗",
    ],
}

WORK_STATUS_TEXTS = [
    ["正在认真想下一步呢", "让我整理一下思路~", "正在梳理接下来要做什么"],
    ["正在处理任务呢", "这一步正在进行中哦", "正在继续干活呢，别打扰我~"],
    ["这一步处理好啦，接着看下一步", "搞定一步，继续看看哦~"],
    ["需要你确认一下呢", "这里要等你看一下哦", "轮到你来决定啦，等你~"],
    ["这一轮搞定啦，真棒！", "任务完成咯，可以摸鱼啦~"],
    ["这一步好像没跑通呢", "刚才的操作遇到点问题哦", "这里卡了一下，再等等你呢"],
]


def run_step(name: str, argv: list[str]) -> int:
    """以子进程跑一段素材链；失败时原样透出返回码。"""
    print(f"\n>>> {name} {' '.join(argv)}", flush=True)
    started = time.time()
    result = subprocess.run([sys.executable, str(SCRIPTS / name), *argv])
    elapsed = time.time() - started
    print(f"<<< {name} rc={result.returncode} ({elapsed:.1f}s)", flush=True)
    return result.returncode


def pick_chroma_src(workdir: Path) -> Path | None:
    """自动抠像的输入：step01（去过水印）优先，其次 video（无水印时直接抠）。"""
    for candidate in (workdir / "step01", workdir / "video"):
        if candidate.is_dir() and any(candidate.glob("*.mp4")):
            return candidate
    return None


def build_dsh_pet_config(
    names: list[str],
    pet_id: str,
    display_name: str,
    size: int,
    corner: str,
    margin_x: int,
    margin_y: int,
) -> tuple[dict, list[str]]:
    """按可用动作生成一份可直接加载的 pet pack 配置；返回 (config, 警告)。"""
    warnings: list[str] = []
    available = set(names)

    def pick(pool: list[str]) -> list[str]:
        return [name for name in pool if name in available]

    idle = pick(CANONICAL["idle"]) or sorted(available)[:1]
    turn = pick(CANONICAL["turn"])
    drag = pick(CANONICAL["drag"])
    clicks = sorted(name for name in names if name.startswith("点击回应-"))
    moves = pick(CANONICAL["moves"])
    balance = pick(CANONICAL["balance"])
    whisper = sorted(name for name in names if name.startswith("碎碎念-"))
    work_status = pick(CANONICAL["workStatus"])

    # 索引即档位的池子必须整组齐全才写，否则档位含义会错位（上游文档明确要求不可插队）。
    if balance and len(balance) != len(CANONICAL["balance"]):
        warnings.append("余额档位素材不全（需要 6 段，按已用百分比索引），已从配置里省略 events.balance")
        balance = []
    if work_status and len(work_status) != len(CANONICAL["workStatus"]):
        warnings.append("工作状态素材不全（需要 6 段，索引即档位），已从配置里省略 events.workStatus")
        work_status = []

    used = set(idle) | set(turn) | set(drag) | set(clicks) | set(moves) | set(balance) | set(whisper) | set(work_status)
    rest = sorted(name for name in names if name not in used)

    weights = {
        "idle": 10 if idle else 0,
        "turn": 5 if turn else 0,
        "move": 5 if moves else 0,
    }
    categories: list[dict] = []
    category_weight = 100 - sum(weights.values())
    if rest:
        categories = [{"id": "随机动作", "weight": category_weight, "actions": rest}]
    else:
        weights["idle"] += category_weight  # 没有随机动作时把余量并回待机，保证合计 100

    animations: dict = {
        "idle": idle,
        "turn": turn,
        "drag": drag,
        "clicks": clicks,
        "moves": {
            "default": {"minDist": 60, "maxDist": 240, "margin": 20, "leadSec": 2, "tailSec": 2},
            "actions": [{"name": name} for name in moves],
        },
        "categories": categories,
        "events": {},
    }
    if balance:
        animations["events"]["balance"] = balance
    if whisper:
        animations["events"]["whisper"] = whisper
    if work_status:
        animations["events"]["workStatus"] = work_status

    config = {
        "pets": [
            {
                "name": display_name,
                "id": pet_id,
                "size": size,
                "balanceEnabled": bool(balance),
                "whisperEnabled": False,
                "workStatusEnabled": bool(work_status),
                "fixedEnabled": False,
                "display": "both",
                "position": {"corner": corner, "marginX": margin_x, "marginY": margin_y},
            }
        ],
        "whisperPrompt": "",
        "workStatusTexts": WORK_STATUS_TEXTS,
        "physics": {
            "gravity": 1400,
            "restitution": 0.78,
            "groundFriction": 2.5,
            "ceilingBounce": True,
            "throwPower": 1.0,
            "petCollision": False,
        },
        "animations": animations,
        "animationWeights": weights,
    }
    return config, warnings


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--workdir", default=".", help="素材工作根目录（默认当前目录）")
    parser.add_argument("--video-dir", default="video", help="绿幕源视频目录（默认 video/）")
    parser.add_argument("--pr-dir", default="pr", help="PR 抠好的透明 mov 目录（默认 pr/）")
    parser.add_argument("--dist-dir", default="dist", help="产物目录（默认 dist/）")
    parser.add_argument(
        "--steps",
        default="all",
        choices=["all", "watermark", "chroma", "pr", "normalize", "encode", "config"],
        help="只跑某一段（默认 all）",
    )
    parser.add_argument("--skip-watermark", action="store_true", help="跳过去水印（视频本身无水印时用）")
    parser.add_argument("--no-auto-chroma", action="store_true", help="不做自动抠像，只用 pr/ 的手工结果")
    parser.add_argument("--parallel", type=int, default=4)
    parser.add_argument(
        "--target", default="generic", choices=["generic", "dsh-pet", "xcode"], help="目标配置格式"
    )
    parser.add_argument("--pet-id", default="mypet", help="宠物 id / pet pack 文件前缀（默认 mypet）")
    parser.add_argument("--pet-name", default="", help="显示名（默认与 pet-id 相同）")
    parser.add_argument("--size", type=int, default=462, help="宠物宽（px，默认 462）")
    parser.add_argument("--corner", default="top-right", choices=["top-left", "top-right", "bottom-left", "bottom-right"])
    parser.add_argument("--margin-x", type=int, default=24)
    parser.add_argument("--margin-y", type=int, default=100)
    parser.add_argument("--install-root", default="", help="dsh-pet 用户数据根（如 ~/.dsh/dsh-pet），给了就直接安装")
    args = parser.parse_args(argv)

    workdir = Path(args.workdir).resolve()
    video_dir = workdir / args.video_dir
    pr_dir = workdir / args.pr_dir
    dist_dir = workdir / args.dist_dir
    step01, step02, step03, step04 = (workdir / f"step0{i}" for i in range(1, 5))
    webm_out = dist_dir / "webm"

    display_name = args.pet_name or args.pet_id
    steps = args.steps
    run_all = steps == "all"

    # ① 去水印（没有遮罩就跳过）
    mask = video_dir / "watermark_mask_v5.mkv"
    if (run_all or steps == "watermark") and not args.skip_watermark and mask.exists():
        if run_step(
            "watermark_step01.py",
            ["--src", str(video_dir), "--out", str(step01), "--parallel", str(args.parallel)],
        ) != 0:
            return 1
    elif (run_all or steps == "watermark") and not args.skip_watermark:
        print("（没有 video/watermark_mask_v5.mkv，跳过去水印）")

    # ② 绿幕抠像 → step02
    if run_all or steps == "chroma":
        source = pick_chroma_src(workdir)
        if source and not args.no_auto_chroma:
            if run_step(
                "chroma_step02.py",
                ["--src", str(source), "--out", str(step02), "--parallel", str(args.parallel)],
            ) != 0:
                return 1
        elif not source:
            print("（没有可抠像的 mp4，跳过 chroma）")

    # ②' PR 手工抠像覆盖 → step02（同名覆盖自动抠像结果）
    movs = sorted(pr_dir.glob("*.mov")) if pr_dir.is_dir() else []
    if (run_all or steps == "pr") and movs:
        if run_step(
            "pr_import_step02.py",
            ["--src", str(pr_dir), "--out", str(step02), "--parallel", str(args.parallel)],
        ) != 0:
            return 1

    # ③ 归一化 → step03
    if run_all or steps == "normalize":
        if not step02.is_dir() or not any(step02.glob("*.webm")):
            print(f"（{step02} 里没有 webm，跳过 normalize）")
        elif run_step(
            "normalize_step03.py",
            ["--src", str(step02), "--out", str(step03), "--parallel", str(args.parallel)],
        ) != 0:
            return 1

    # ④ 播放变体 → step04，并复制到 dist/webm
    if run_all or steps == "encode":
        if not step03.is_dir() or not any(step03.glob("*.webm")):
            print(f"（{step03} 里没有 webm，跳过 encode）")
        else:
            if run_step(
                "encode_thumbs.py",
                ["--src", str(step03), "--out", str(step04), "--parallel", str(args.parallel)],
            ) != 0:
                return 1
            webm_out.mkdir(parents=True, exist_ok=True)
            for src in sorted(step04.glob("*.webm")):
                shutil.copy2(src, webm_out / src.name)
            print(f"copied {len(list(webm_out.glob('*.webm')))} webm -> {webm_out}")

    if steps in {"all", "config"} and not any(webm_out.glob("*.webm")):
        print(f"（{webm_out} 里没有 webm，无法生成清单/配置）")
        return 1

    # ⑤ 校验 + 清单 + 目标配置
    if steps in {"all", "config"}:
        errors, warnings, entries = validate_assets(webm_out)
        for message in warnings:
            print("WARN", message)
        for message in errors:
            print("ERROR", message)
        if errors:
            print("校验未通过，先修素材再生成配置。")
            return 1

        dist_dir.mkdir(parents=True, exist_ok=True)
        manifest = {
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "canvas": "640x360",
            "count": len(entries),
            "actions": [
                {
                    "name": entry["name"],
                    "file": f"webm/{entry['name']}.webm",
                    "width": entry["width"],
                    "height": entry["height"],
                    "fps": entry["fps"],
                    "duration": entry["duration"],
                    "alpha": {"min": entry["alphaMin"], "max": entry["alphaMax"]},
                }
                for entry in entries
            ],
        }
        (dist_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"manifest -> {dist_dir / 'manifest.json'}（{len(entries)} 个动作）")

        names = [entry["name"] for entry in entries]
        if args.target == "dsh-pet":
            config, config_warnings = build_dsh_pet_config(
                names,
                args.pet_id,
                display_name,
                args.size,
                args.corner,
                args.margin_x,
                args.margin_y,
            )
            for message in config_warnings:
                print("WARN", message)
            config_errors, config_warnings2 = check_config(config, set(names))
            if config_errors:
                for message in config_errors:
                    print("ERROR", message)
                return 1
            for message in config_warnings2:
                print("WARN", message)
            pet_dir = dist_dir / "pet"
            pet_dir.mkdir(parents=True, exist_ok=True)
            config_path = pet_dir / f"{args.pet_id}-config.json"
            config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"pet pack config -> {config_path}")

            if args.install_root:
                root = Path(args.install_root).expanduser().resolve()
                anim_dir = root / "pet" / f"{args.pet_id}-animation" / "webm"
                anim_dir.mkdir(parents=True, exist_ok=True)
                for src in sorted(webm_out.glob("*.webm")):
                    shutil.copy2(src, anim_dir / src.name)
                shutil.copy2(config_path, root / "pet" / f"{args.pet_id}-config.json")
                print(f"installed -> {root / 'pet'}")
        elif args.target == "xcode":
            xcode_dir = dist_dir / "xcode"
            xcode_dir.mkdir(parents=True, exist_ok=True)
            payload = {
                "name": display_name,
                "sizePx": args.size,
                "position": {"corner": args.corner, "marginX": args.margin_x, "marginY": args.margin_y},
                "webmDir": "webm",
                "manifest": "manifest.json",
                "actions": names,
            }
            (xcode_dir / "pet.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"xcode target -> {xcode_dir / 'pet.json'}")
        else:
            print("generic target：只产出 webm/ + manifest.json，配置自行按渲染端格式映射。")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
