"""Unify character size across step02 videos into step03.

整帧等比缩放 + overlay 平移到 2160x1215（16:9）透明画布：
- 站立高度 900（按首尾站立帧的平均高度计算缩放比例）
- 水平居中，脚底对齐（按全帧内容最低点对齐，保证动画不裁剪）
- 不裁剪人物/动作内容，底部超出的透明空白直接裁掉
- 画布 2160x1215 与原始视频同为 16:9，宽度容纳最宽动作（2015px）
"""

from __future__ import annotations

import json
import re
import subprocess
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

from _common import FFMPEG, FFPROBE, add_common_args, probe_video  # noqa: F401

# 默认目录；main() 按 CLI 覆盖
SRC = Path("step02")
OUT = Path("step03")
PARALLEL = 4
CANVAS_W = 2160  # 16:9：2160 = 1215 * 16/9，与原始视频同比例
CANVAS_H = 1215
TARGET_HEIGHT = 900
FEET_Y = CANVAS_H - 100  # 距底 100

SRC_W = 1280
SRC_H = 720
FPS = 24
HEAD_FRAMES = 5
TAIL_SEEK = -0.2  # 从末尾取帧，避免取到收尾动作

_BBOX_RE = re.compile(r"x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)")


def scan_bbox(video: Path, seek: float | None = None, frames: int | None = None) -> list[tuple[int, int, int, int]]:
    """用 alphaextract,bbox 滤镜扫描帧内容边界，返回 [(x1, x2, y1, y2)] 列表。"""
    cmd = [FFMPEG, "-hide_banner", "-loglevel", "info", "-c:v", "libvpx-vp9"]
    if seek is not None:
        cmd += ["-sseof", str(seek)]
    cmd += ["-i", str(video)]
    if frames is not None:
        cmd += ["-frames:v", str(frames)]
    cmd += ["-vf", "alphaextract,bbox", "-f", "null", "-"]
    # text=True 时显式指定 UTF-8 解码（Windows 默认 GBK 会解不了 ffmpeg 的 UTF-8 输出）
    result = subprocess.run(cmd, check=False, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())
    return [tuple(int(g) for g in m.groups()) for m in _BBOX_RE.finditer(result.stderr)]


def read_alpha_frames(video: Path, seek: float | None = None, frames: int | None = None) -> list[np.ndarray]:
    """解码指定帧的 alpha 通道（每帧 H×W uint8 数组）。"""
    cmd = [FFMPEG, "-hide_banner", "-loglevel", "error", "-c:v", "libvpx-vp9"]
    if seek is not None:
        cmd += ["-sseof", str(seek)]
    cmd += ["-i", str(video)]
    if frames is not None:
        cmd += ["-frames:v", str(frames)]
    cmd += ["-f", "rawvideo", "-pix_fmt", "rgba", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    frame_size = SRC_W * SRC_H * 4
    out: list[np.ndarray] = []
    while True:
        buf = b""
        while len(buf) < frame_size:
            chunk = p.stdout.read(frame_size - len(buf))
            if not chunk:
                break
            buf += chunk
        if len(buf) < frame_size:
            break
        out.append(np.frombuffer(buf, np.uint8).reshape(SRC_H, SRC_W, 4)[..., 3])
    p.stdout.close()
    p.wait()
    return out


def measure_standing(video: Path) -> dict:
    """首尾各 HEAD_FRAMES 帧站立姿态。

    水平中心用非透明像素 x 的中位数（防手/零食等扩展物把 bbox 中心拉偏），
    垂直基准用 bbox（y 方向扩展物干扰小，bbox 本身可靠）。
    """
    alphas = read_alpha_frames(video, frames=HEAD_FRAMES) + read_alpha_frames(video, seek=TAIL_SEEK, frames=HEAD_FRAMES)
    med_xs, heights, max_ys = [], [], []
    for a in alphas:
        ys, xs = np.where(a > 10)
        if len(xs) == 0:
            continue
        med_xs.append(float(np.median(xs)))
        heights.append(int(ys.max() - ys.min() + 1))
        max_ys.append(int(ys.max()))
    if not med_xs:
        raise RuntimeError(f"No opaque pixels found in {video.name}")
    return {
        "height": sum(heights) / len(heights),
        "max_y": sum(max_ys) / len(max_ys),
        "center_x": sum(med_xs) / len(med_xs),
    }


def measure_content_union(video: Path) -> tuple[int, int, int, int]:
    """全帧扫描内容范围并集 (x1, y1, x2, y2)，用于校验动画内容是否被裁。"""
    boxes = scan_bbox(video)
    if not boxes:
        raise RuntimeError(f"No opaque pixels found in {video.name}")
    return (
        min(b[0] for b in boxes),
        min(b[2] for b in boxes),
        max(b[1] for b in boxes),
        max(b[3] for b in boxes),
    )


def build_filter(scale: float, standing: dict) -> str:
    """整帧缩放 + overlay 平移到透明画布，站立水平居中、脚底对齐 FEET_Y。"""
    scaled_w = int(SRC_W * scale) // 2 * 2
    scaled_h = int(SRC_H * scale) // 2 * 2
    overlay_x = CANVAS_W / 2 - standing["center_x"] * scale
    overlay_y = FEET_Y - standing["max_y"] * scale
    return (
        f"color=c=black@0:s={CANVAS_W}x{CANVAS_H}:r={FPS}[bg];"
        f"[0:v]scale={scaled_w}:{scaled_h}[sc];"
        f"[bg][sc]overlay={overlay_x:.1f}:{overlay_y:.1f}:shortest=1,format=yuva420p[v]"
    )


def convert_video(src: Path, dst: Path, filter_complex: str) -> None:
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
        "-filter_complex",
        filter_complex,
        "-map",
        "[v]",
        "-map",
        "0:a?",
        "-c:v",
        "libvpx-vp9",
        "-crf",
        "30",
        "-b:v",
        "0",
        "-auto-alt-ref",
        "0",
        "-deadline",
        "good",
        "-cpu-used",
        "4",
        "-c:a",
        "libopus",
        "-b:a",
        "128k",
        str(dst),
    ]
    result = subprocess.run(cmd, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())


def _is_valid(dst: Path, src: Path, min_size: int = 50_000) -> bool:
    """断点续跑完整性检查：存在、够大、不比源旧、且能被 ffprobe 读到视频流。"""
    if not dst.exists() or dst.stat().st_size <= min_size:
        return False
    if dst.stat().st_mtime < src.stat().st_mtime:
        return False
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "stream=codec_name",
                        "-of", "csv=p=0", str(dst)], capture_output=True)
    return bool(r.stdout.strip())


def _init_worker(
    out: str,
    src_w: int,
    src_h: int,
    fps: int,
    canvas_w: int,
    canvas_h: int,
    target_height: int,
    feet_y: int,
) -> None:
    # Windows spawn 会重新导入模块：CLI 设置的全局变量不会自动带过来，必须在子进程里重置。
    global OUT, SRC_W, SRC_H, FPS, CANVAS_W, CANVAS_H, TARGET_HEIGHT, FEET_Y
    OUT = Path(out)
    SRC_W, SRC_H, FPS = src_w, src_h, fps
    CANVAS_W, CANVAS_H = canvas_w, canvas_h
    TARGET_HEIGHT, FEET_Y = target_height, feet_y

def _process_one(video: Path) -> tuple[dict, bool]:
    """处理单个视频（worker 函数）：测量 + 转码（或跳过转码），返回 entry。

    注意：entry 必须可 JSON 序列化（params.json 由主进程汇总写入）。
    """
    dst = OUT / (video.stem + ".webm")
    # 断点续跑：完整输出已存在 → 跳过转码（但仍测量，保证 params.json 完整）
    skip = _is_valid(dst, video)
    standing = measure_standing(video)
    union = measure_content_union(video)
    scale = TARGET_HEIGHT / standing["height"]
    entry = {
        "file": video.name,
        "standing": {k: round(v, 1) for k, v in standing.items()},
        "content_union": {"x1": union[0], "y1": union[1], "x2": union[2], "y2": union[3]},
        "scale": round(scale, 6),
    }
    if not skip:
        filter_complex = build_filter(scale, standing)
        convert_video(video, dst, filter_complex)
    return entry, skip


def main(argv=None) -> int:
    global SRC, OUT, PARALLEL, SRC_W, SRC_H, FPS, CANVAS_W, CANVAS_H, TARGET_HEIGHT, FEET_Y
    parser = add_common_args(__doc__, "step02", "step03")
    parser.add_argument("--src-width", type=int, default=0, help="step02 视频宽（默认自动探测）")
    parser.add_argument("--src-height", type=int, default=0, help="step02 视频高（默认自动探测）")
    parser.add_argument("--fps", type=float, default=0, help="帧率（默认自动探测）")
    parser.add_argument("--target-height", type=int, default=900, help="站立高度（母版像素，默认 900）")
    parser.add_argument("--canvas", default="2160x1215", help="母版画布 WxH（默认 2160x1215）")
    parser.add_argument("--feet-gap", type=int, default=100, help="脚底距画布底边的像素（默认 100）")
    args = parser.parse_args(argv)
    SRC, OUT, PARALLEL = Path(args.src), Path(args.out), args.parallel

    OUT.mkdir(parents=True, exist_ok=True)
    videos = sorted(SRC.glob("*.webm"))
    if not videos:
        print(f"No WebM files found in {SRC}")
        return 1

    cw, ch = (int(x) for x in args.canvas.lower().split("x", 1))
    CANVAS_W, CANVAS_H = cw, ch
    TARGET_HEIGHT = args.target_height
    FEET_Y = CANVAS_H - args.feet_gap
    if args.src_width and args.src_height:
        SRC_W, SRC_H = args.src_width, args.src_height
    else:
        info = probe_video(videos[0])
        SRC_W, SRC_H = info["width"], info["height"]
    if args.fps:
        FPS = max(1, int(round(args.fps)))

    payload = {"canvas": f"{CANVAS_W}x{CANVAS_H}", "target_height": TARGET_HEIGHT, "feet_y": FEET_Y, "videos": []}
    total = len(videos)
    with ProcessPoolExecutor(max_workers=PARALLEL, initializer=_init_worker, initargs=(str(OUT), SRC_W, SRC_H, FPS, CANVAS_W, CANVAS_H, TARGET_HEIGHT, FEET_Y)) as ex:
        for index, (entry, skip) in enumerate(ex.map(_process_one, videos), start=1):
            payload["videos"].append(entry)
            status = "SKIP" if skip else "OK"
            print(f"[{index}/{total}] {entry['file']} {status} (scale={entry['scale']})", flush=True)

    (OUT / "params.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Done. {total} videos written to {OUT} (parallel={PARALLEL})")
    return 0
if __name__ == "__main__":
    raise SystemExit(main())
