"""Transcode step03 masters into 640x360 playback clips (step04).

素材处理链的第 4 步（转码）：把归一化后的 2160x1215 透明母版（step03/）
缩成 640x360 播放变体（step04/），供桌宠渲染端使用。

完整处理链：
  video/（绿幕源视频）→ watermark_step01.py（可选）→ chroma_step02.py（抠像）
  → step02/（透明 webm，源分辨率）→ normalize_step03.py（2160x1215 统一站立）
  → step03/（母版）→ 本脚本 → step04/（640x360 播放变体）

为什么需要转码：
- 播放时宠物只显示约 200~460px，640 宽已经足够清晰，2160 是 3.4 倍冗余
- 母版全量体积远超 npm 包上限；转码后透明区域更省码
- 播放更省内存、切换更快（A/B 双缓冲换源）

编码要点（丢了就会黑底）：
- 解码端必须显式 `-c:v libvpx-vp9`；
- `scale` 之后必须 `format=yuva420p`。
"""

from __future__ import annotations

import subprocess
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from _common import FFMPEG, FFPROBE, add_common_args  # noqa: F401

# 默认目录；main() 按 CLI 覆盖
SRC = Path("step03")
OUT = Path("step04")
PARALLEL = 4
# 转码参数（调这里改画质/分辨率）
TARGET_W = 640    # thumb 宽度（与 2160x1215 母版同 16:9 比例）
TARGET_H = 360    # thumb 高度
CRF = 40       # VP9 质量参数（0-63，越小越清晰越大；40 偏轻，透明区域省码）
FPS = 24  # 帧率（与母版一致，保持动作节奏）


def convert_video(src: Path, dst: Path) -> None:
    """转码单个视频。

    注意：
    - 解码端必须指定 -c:v libvpx-vp9（libvpx 解码才能保留 VP9 alpha，与
      normalize_step03.py 一致）；ffmpeg 自动选解码器会丢 alpha 导致黑底。
    - scale 滤镜默认也会丢 alpha，需 format=yuva420p 强制保留。
    """
    cmd = [
        FFMPEG,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-c:v",
        "libvpx-vp9",  # 关键：libvpx 解码才能保留 VP9 alpha
        "-i",
        str(src),
        "-vf",
        f"scale={TARGET_W}:{TARGET_H},format=yuva420p",
        "-c:v",
        "libvpx-vp9",  # VP9 编码（WebM 标准）
        "-crf",
        str(CRF),
        "-b:v",
        "0",  # 恒定质量模式（CRF）
        "-row-mt",
        "1",  # 多行并行（加速编码）
        "-r",
        str(FPS),
        "-an",  # 丢弃音轨（动画无声音，省体积）
        str(dst),
    ]
    result = subprocess.run(cmd, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())


def _is_valid(dst: Path, src: Path, min_size: int = 20_000) -> bool:
    """断点续跑完整性检查：存在、够大、不比源旧、且能被 ffprobe 读到视频流。"""
    if not dst.exists() or dst.stat().st_size <= min_size:
        return False
    if dst.stat().st_mtime < src.stat().st_mtime:
        return False
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "stream=codec_name",
                        "-of", "csv=p=0", str(dst)], capture_output=True)
    return bool(r.stdout.strip())


def _init_worker(out: str, target_w: int, target_h: int, crf: int, fps: int) -> None:
    # Windows spawn 会重新导入模块：CLI 设置的全局变量不会自动带过来，必须在子进程里重置。
    global OUT, TARGET_W, TARGET_H, CRF, FPS
    OUT = Path(out)
    TARGET_W, TARGET_H, CRF, FPS = target_w, target_h, crf, fps

def _process_one(video: Path) -> tuple[str, int, int, bool]:
    """处理单个视频（worker 函数），返回 (名字, 源大小, 输出大小, 是否跳过)。"""
    src_size = video.stat().st_size
    dst = OUT / video.name
    if _is_valid(dst, video):
        return video.name, src_size, 0, True
    convert_video(video, dst)
    return video.name, src_size, dst.stat().st_size, False


def main(argv=None) -> int:
    global SRC, OUT, PARALLEL, TARGET_W, TARGET_H, CRF, FPS
    parser = add_common_args(__doc__, "step03", "step04")
    parser.add_argument("--width", type=int, default=640, help="输出宽（默认 640）")
    parser.add_argument("--height", type=int, default=360, help="输出高（默认 360）")
    parser.add_argument("--crf", type=int, default=40, help="VP9 CRF（0-63，默认 40）")
    parser.add_argument("--fps", type=float, default=24, help="输出帧率（默认 24）")
    args = parser.parse_args(argv)
    SRC, OUT, PARALLEL = Path(args.src), Path(args.out), args.parallel
    TARGET_W, TARGET_H, CRF = args.width, args.height, args.crf
    FPS = max(1, int(round(args.fps)))

    OUT.mkdir(parents=True, exist_ok=True)
    videos = sorted(SRC.glob("*.webm"))
    if not videos:
        print(f"No WebM masters found in {SRC}")
        return 1

    src_total = 0
    out_total = 0
    total = len(videos)
    with ProcessPoolExecutor(max_workers=PARALLEL, initializer=_init_worker, initargs=(str(OUT), TARGET_W, TARGET_H, CRF, FPS)) as ex:
        for index, (name, src_size, out_size, skipped) in enumerate(ex.map(_process_one, videos), start=1):
            src_total += src_size
            out_total += out_size
            if skipped:
                print(f"[{index}/{total}] SKIP {name} (already encoded)", flush=True)
            else:
                print(f"[{index}/{total}] {name}  {src_size / 1e6:.1f}MB -> {out_size / 1e6:.1f}MB", flush=True)

    print(f"\n=== summary ===")
    print(f"masters: {total}")
    print(f"source total: {src_total / 1e6:.1f}MB")
    print(f"thumb total: {out_total / 1e6:.1f}MB")
    return 0
if __name__ == "__main__":
    raise SystemExit(main())
