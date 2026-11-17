"""素材链共用工具：ffmpeg 定位、通用 CLI 参数、断点续跑校验、ffprobe 探测。

定位顺序（所有脚本共用同一套，保证「零第三方依赖但可替换原生 ffmpeg」）：
  1. 环境变量 FFMPEG_BIN / FFPROBE_BIN（完整路径）
  2. 工作区 .tools/ffmpeg-*/bin（上游素材链的惯用布局）
  3. 系统 PATH

只依赖 Python 标准库；numpy/scipy 由具体步骤按需引入。
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path


def _find(name: str) -> str:
    """按 环境变量 → .tools → PATH 的顺序定位可执行文件。"""
    env_name = name.upper() + "_BIN"
    env_value = os.environ.get(env_name)
    if env_value:
        path = Path(env_value)
        if not path.is_file():
            raise SystemExit(f"{env_name} 指向的文件不存在：{env_value}")
        return str(path)

    roots = [Path.cwd() / ".tools", Path(__file__).resolve().parent.parent / ".tools"]
    for root in roots:
        if not root.is_dir():
            continue
        for tool_dir in sorted(root.glob("ffmpeg-*")):
            for candidate in (
                tool_dir / "bin" / (name + ".exe"),
                tool_dir / "bin" / name,
                tool_dir / (name + ".exe"),
                tool_dir / name,
            ):
                if candidate.is_file():
                    return str(candidate)

    found = shutil.which(name)
    if found:
        return found
    raise SystemExit(
        f"找不到 {name}。请设置 {env_name}=完整路径，或把 ffmpeg 安装到 PATH"
        "（Windows: winget install Gyan.FFmpeg；macOS: brew install ffmpeg；Linux: apt install ffmpeg）。"
    )


FFMPEG = _find("ffmpeg")
FFPROBE = _find("ffprobe")


def add_common_args(description: str | None, src_default: str, out_default: str) -> argparse.ArgumentParser:
    """构造带 --src/--out/--parallel 的解析器；脚本自己的额外参数再往上加。"""
    parser = argparse.ArgumentParser(
        description=description,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--src", default=src_default, help=f"输入目录（默认 {src_default}）")
    parser.add_argument("--out", default=out_default, help=f"输出目录（默认 {out_default}）")
    parser.add_argument("--parallel", type=int, default=4, help="并发进程数（默认 4）")
    return parser


def is_valid_output(dst: Path, src: Path, min_size: int = 50_000) -> bool:
    """断点续跑完整性检查：存在、够大、不比源旧、且能被 ffprobe 读到视频流。

    ffprobe 验证防止「中断时正在写、大小看似足够但已损坏」的文件被误判为已完成。
    """
    if not dst.exists() or dst.stat().st_size <= min_size:
        return False
    if dst.stat().st_mtime < src.stat().st_mtime:
        return False
    result = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", str(dst)],
        capture_output=True,
    )
    return bool(result.stdout.strip())


def read_exact(stream, size: int) -> bytes:
    """从管道精确读 size 字节（管道单次 read 可能只给一部分）。"""
    chunks = b""
    while len(chunks) < size:
        chunk = stream.read(size - len(chunks))
        if not chunk:
            break
        chunks += chunk
    return chunks


def probe_video(path: Path) -> dict:
    """ffprobe 读取首个视频流：宽高、帧率、时长（秒）、像素格式、编码。"""
    result = subprocess.run(
        [
            FFPROBE,
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,r_frame_rate,pix_fmt,codec_name:format=duration",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe 读取失败：{path}\n{result.stderr.strip()}")
    payload = json.loads(result.stdout or "{}")
    stream = (payload.get("streams") or [{}])[0]
    fps_raw = str(stream.get("r_frame_rate") or "0/1")
    try:
        num, den = (int(x) for x in fps_raw.split("/", 1))
        fps = num / den if den else 0.0
    except ValueError:
        fps = 0.0
    duration = float((payload.get("format") or {}).get("duration") or 0.0)
    return {
        "width": int(stream.get("width") or 0),
        "height": int(stream.get("height") or 0),
        "fps": round(fps, 3),
        "duration": round(duration, 3),
        "pixFmt": stream.get("pix_fmt"),
        "codec": stream.get("codec_name"),
    }


def alpha_stats(path: Path, at: float = 1.0, width: int = 0, height: int = 0) -> tuple[int, int]:
    """取第 at 秒一帧的 RGBA，返回 alpha 的 (min, max)。

    只要 alpha 有真实层次（min < 100 且 max > 200）就说明透明通道没丢——
    全 255 意味着编码链把 alpha 压掉了（典型症状：播放时黑底）。
    """
    info = probe_video(path) if not (width and height) else {}
    width = width or info.get("width") or 0
    height = height or info.get("height") or 0
    if not width or not height:
        return (255, 255)
    result = subprocess.run(
        [
            FFMPEG,
            "-v",
            "error",
            # 必须显式指定 libvpx-vp9 解码：ffmpeg 自动选解码器会丢 VP9 alpha（黑底）。
            "-c:v",
            "libvpx-vp9",
            "-ss",
            str(at),
            "-i",
            str(path),
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgba",
            "-",
        ],
        capture_output=True,
    )
    data = result.stdout
    if len(data) < width * height * 4:
        return (255, 255)
    alpha = data[3::4]
    return (min(alpha), max(alpha))
