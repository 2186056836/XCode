"""Remove green backgrounds from step01 videos into transparent WebM files in step02/."""

from __future__ import annotations

import subprocess
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np


from _common import FFMPEG, FFPROBE, add_common_args, probe_video  # noqa: F401

# 默认目录；main() 按 CLI 覆盖（宽高默认从第一条视频自动探测）
SRC = Path("step01")
OUT = Path("step02")
PARALLEL = 4
W, H, FPS = 1280, 720, 24
# HSV 色相判定抠像：只把"绿色色相 + 足够饱和/明度"的像素判为背景（透明）。
# 相比 chromakey(YUV 色度距离) 和 RGB 色差阈值：它们是"以绿幕为中心画圈"，
# 蓝色/白色等彩色可能落入圈内被误抠；HSV 色相判定只认绿色方向，蓝/白/红永不误抠。
GREEN_HUE_MIN = 70.0   # 绿色色相下界
GREEN_HUE_MAX = 170.0  # 绿色色相上界
SAT_MIN = 0.15         # 饱和度下界（低于此的白色/浅色不算背景）
VAL_MIN = 0.15         # 明度下界
HUE_FEATHER = 6.0      # 色相边界渐变（度）
# 背景色采样用的别名（上游脚本里两处用了不同名字，保持原样避免行为漂移）
SATURATION_MIN = SAT_MIN
VALUE_MIN = VAL_MIN

# 背景色采样：把视频缩到 320x180 再统计，够用且快
WIDTH = 320
HEIGHT = 180
MARGIN_X = WIDTH // 10
MARGIN_Y = HEIGHT // 10
FRAMES_PER_VIDEO = 10
QUANTIZE = 8


def rgb_to_hsv(r: int, g: int, b: int) -> tuple[float, float, float]:
    rn, gn, bn = r / 255.0, g / 255.0, b / 255.0
    mx = max(rn, gn, bn)
    mn = min(rn, gn, bn)
    delta = mx - mn
    if delta == 0:
        return 0.0, 0.0, mx
    if mx == rn:
        hue = 60.0 * (((gn - bn) / delta) % 6.0)
    elif mx == gn:
        hue = 60.0 * (((bn - rn) / delta) + 2.0)
    else:
        hue = 60.0 * (((rn - gn) / delta) + 4.0)
    saturation = delta / mx if mx else 0.0
    return hue, saturation, mx


def sample_background_color(video: Path) -> str:
    cmd = [
        FFMPEG,
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(video),
        "-an",
        "-vf",
        f"fps=1,scale={WIDTH}:{HEIGHT}",
        "-frames:v",
        str(FRAMES_PER_VIDEO),
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
    ]
    result = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    frame_size = WIDTH * HEIGHT * 3
    counter: Counter = Counter()

    for offset in range(0, len(result.stdout) - frame_size + 1, frame_size):
        frame = result.stdout[offset : offset + frame_size]
        for y in range(HEIGHT):
            for x in range(WIDTH):
                if MARGIN_X <= x < WIDTH - MARGIN_X and MARGIN_Y <= y < HEIGHT - MARGIN_Y:
                    continue
                index = (y * WIDTH + x) * 3
                r, g, b = frame[index], frame[index + 1], frame[index + 2]
                hue, sat, val = rgb_to_hsv(r, g, b)
                if GREEN_HUE_MIN <= hue <= GREEN_HUE_MAX and sat >= SATURATION_MIN and val >= VALUE_MIN:
                    q = (r // QUANTIZE * QUANTIZE, g // QUANTIZE * QUANTIZE, b // QUANTIZE * QUANTIZE)
                    counter[q] += 1

    if not counter:
        raise RuntimeError(f"No green pixels found in border of {video.name}")
    (r, g, b), _ = counter.most_common(1)[0]
    return "#%02X%02X%02X" % (r, g, b)


def read_exact(stream, n):
    """阻塞读满 n 字节（管道 read 可能部分返回，必须循环）。EOF 时返回不足。"""
    buf = b""
    while len(buf) < n:
        chunk = stream.read(n - len(buf))
        if not chunk:
            break
        buf += chunk
    return buf


def _rgb_to_yuv(frame: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """rgb24 (H,W,3) → Y/U/V 平面（BT.601 limited）。U/V 用 2x2 平均做 4:2:0 子采样。"""
    r = frame[..., 0].astype(np.float32)
    g = frame[..., 1].astype(np.float32)
    b = frame[..., 2].astype(np.float32)
    y = np.clip(16 + 0.257 * r + 0.504 * g + 0.098 * b, 16, 235).astype(np.uint8)
    u = np.clip(128 - 0.148 * r - 0.291 * g + 0.439 * b, 16, 240)
    v = np.clip(128 + 0.439 * r - 0.368 * g - 0.071 * b, 16, 240)
    u = u.reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3)).astype(np.uint8)
    v = v.reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3)).astype(np.uint8)
    return y, u, v


def _rgb_to_hsv(frame: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """rgb24 (H,W,3) → hue(0-360), saturation(0-1), value(0-1)，numpy 向量化。"""
    r = frame[..., 0].astype(np.float32) / 255.0
    g = frame[..., 1].astype(np.float32) / 255.0
    b = frame[..., 2].astype(np.float32) / 255.0
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    delta = mx - mn
    hue = np.zeros_like(mx)
    nz = delta > 0
    with np.errstate(divide="ignore", invalid="ignore"):
        hr = 60.0 * (((g - b) / np.where(nz, delta, 1)) % 6.0)
        hg = 60.0 * (((b - r) / np.where(nz, delta, 1)) + 2.0)
        hb = 60.0 * (((r - g) / np.where(nz, delta, 1)) + 4.0)
    hue = np.where((mx == r) & nz, hr, np.where((mx == g) & nz, hg, np.where((mx == b) & nz, hb, 0.0)))
    sat = np.where(mx > 0, delta / np.maximum(mx, 1e-6), 0.0)
    return hue, sat, mx


def convert_video(src: Path, dst: Path, color: str) -> None:
    """HSV 色相判定抠像：绿色色相 + 足够饱和/明度 → 透明。

    输入管道：step01 视频 rgb24 流；输出管道：yuva420p → VP9 透明 webm。
    """
    bg = np.array([int(color[i:i + 2], 16) for i in (1, 3, 5)], np.uint8)  # #RRGGBB（仅用于参考）
    p1 = subprocess.Popen(
        [FFMPEG, "-loglevel", "error", "-i", str(src), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE)
    p2 = subprocess.Popen(
        [FFMPEG, "-y", "-loglevel", "error",
         "-f", "rawvideo", "-pix_fmt", "yuva420p", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-crf", "30", "-b:v", "0",
         "-auto-alt-ref", "0", "-deadline", "good", "-cpu-used", "4", str(dst)],
        stdin=subprocess.PIPE)

    frame_size = W * H * 3
    # 色相跨 0 度处理：绿色范围 [70,170]，两侧各留 HUE_FEATHER 渐变
    lo = GREEN_HUE_MIN - HUE_FEATHER
    hi = GREEN_HUE_MAX + HUE_FEATHER
    while True:
        buf = read_exact(p1.stdout, frame_size)
        if len(buf) < frame_size:
            break
        frame = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
        hue, sat, val = _rgb_to_hsv(frame)
        # 背景 = 绿色色相内 且 饱和度/明度达标；色相边界做线性渐变
        in_hue = np.clip((hue - lo) / HUE_FEATHER, 0, 1) * np.clip((hi - hue) / HUE_FEATHER, 0, 1)
        bg_mask = (sat >= SAT_MIN) & (val >= VAL_MIN) & (hue >= lo) & (hue <= hi)
        # 背景 → alpha 0（透明）；绿色色相中心全透明，边缘渐变；非背景 → 255
        alpha = np.where(bg_mask, (1.0 - in_hue) * 255, 255).astype(np.uint8)
        y, u, v = _rgb_to_yuv(frame)
        p2.stdin.write(y.tobytes() + u.tobytes() + v.tobytes() + alpha.tobytes())
    p1.stdout.close()
    p2.stdin.close()
    rc = p1.wait() + p2.wait()
    if rc != 0:
        raise RuntimeError(f"convert failed rc={rc}: {src.name}")


def _is_valid(dst: Path, src: Path, min_size: int = 50_000) -> bool:
    """断点续跑完整性检查：存在、够大、不比源旧、且能被 ffprobe 读到视频流。"""
    if not dst.exists() or dst.stat().st_size <= min_size:
        return False
    if dst.stat().st_mtime < src.stat().st_mtime:
        return False
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "stream=codec_name",
                        "-of", "csv=p=0", str(dst)], capture_output=True)
    return bool(r.stdout.strip())


def _init_worker(out: str, width: int, height: int, fps: int) -> None:
    # Windows spawn 会重新导入模块：CLI 设置的全局变量不会自动带过来，必须在子进程里重置。
    global OUT, W, H, FPS
    OUT = Path(out)
    W, H, FPS = width, height, fps

def _process_one(video: Path) -> tuple[str, str]:
    """处理单个视频（worker 函数，必须模块级以支持 Windows spawn）。"""
    dst = OUT / (video.stem + ".webm")
    if _is_valid(dst, video):
        return video.name, "SKIP"
    color = sample_background_color(video)
    convert_video(video, dst, color)
    return video.name, f"{color}"


def main(argv=None) -> int:
    global SRC, OUT, PARALLEL, W, H, FPS
    parser = add_common_args(__doc__, "step01", "step02")
    parser.add_argument("--width", type=int, default=0, help="输入视频宽（默认自动探测）")
    parser.add_argument("--height", type=int, default=0, help="输入视频高（默认自动探测）")
    parser.add_argument("--fps", type=float, default=0, help="输入视频帧率（默认自动探测）")
    args = parser.parse_args(argv)
    SRC, OUT, PARALLEL = Path(args.src), Path(args.out), args.parallel

    OUT.mkdir(parents=True, exist_ok=True)
    videos = sorted(SRC.glob("*.mp4"))
    if not videos:
        print(f"No MP4 files found in {SRC}")
        return 1

    if args.width and args.height:
        W, H = args.width, args.height
    else:
        info = probe_video(videos[0])
        W, H = info["width"], info["height"]
    if args.fps:
        FPS = max(1, int(round(args.fps)))
    print(f"input: {W}x{H} @ {FPS}fps, {len(videos)} file(s)")

    total = len(videos)
    with ProcessPoolExecutor(max_workers=PARALLEL, initializer=_init_worker, initargs=(str(OUT), W, H, FPS)) as ex:
        for index, (name, status) in enumerate(ex.map(_process_one, videos), start=1):
            print(f"[{index}/{total}] {name} -> {status}", flush=True)

    print(f"Done. {total} videos written to {OUT} (parallel={PARALLEL})")
    return 0
if __name__ == "__main__":
    raise SystemExit(main())
