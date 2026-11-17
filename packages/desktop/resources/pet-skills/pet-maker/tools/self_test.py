"""自检：用一条合成的绿幕视频跑完整素材链，验证环境和包是否正常。

用法：
  python tools/self_test.py [--keep]

流程：生成 4 秒 1280×720 绿幕 + 橙色方块 → make_pet（跳过水印，target=dsh-pet）
→ 校验 640×360 / 24fps / alpha / 配置权重。耗时约 20~40 秒（取决于 CPU）。
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from _common import FFMPEG  # noqa: E402


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--keep", action="store_true", help="保留临时目录（默认跑完删除）")
    args = parser.parse_args(argv)

    workdir = Path(tempfile.mkdtemp(prefix="pet-maker-selftest-"))
    print(f"workdir: {workdir}")
    video_dir = workdir / "video"
    video_dir.mkdir(parents=True, exist_ok=True)

    print("[1/3] 生成合成绿幕视频…")
    result = subprocess.run(
        [
            FFMPEG,
            "-y",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=0x00FF00:s=1280x720:d=4:r=24",
            "-vf",
            "drawbox=x='400+80*sin(t*2)':y=200:w=320:h=400:color=orange:t=fill",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(video_dir / "selftest.mp4"),
        ]
    )
    if result.returncode != 0:
        print("生成测试视频失败")
        return 1

    print("[2/3] 跑素材链…")
    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "make_pet.py"),
            "--workdir",
            str(workdir),
            "--skip-watermark",
            "--target",
            "dsh-pet",
            "--pet-id",
            "selftest",
            "--pet-name",
            "自检宠物",
        ]
    )
    if result.returncode != 0:
        print("素材链失败")
        return 1

    print("[3/3] 校验产物…")
    webm = workdir / "dist" / "webm" / "selftest.webm"
    config = workdir / "dist" / "pet" / "selftest-config.json"
    if not webm.is_file() or not config.is_file():
        print(f"缺少产物：{webm} / {config}")
        return 1
    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "validate_pet_pack.py"),
            str(workdir / "dist" / "webm"),
            "--config",
            str(config),
        ]
    )
    if result.returncode != 0:
        print("校验未通过")
        return 1

    print("\nSELF-TEST OK")
    if args.keep:
        print(f"临时目录保留：{workdir}")
    else:
        shutil.rmtree(workdir, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
