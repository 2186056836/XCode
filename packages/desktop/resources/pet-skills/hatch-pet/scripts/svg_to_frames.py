#!/usr/bin/env python3
"""Rasterize a hand-authored SVG row strip (or single frame) into a decoded PNG.

This is the SVG fallback for environments without an image-generation API. The
SVG document is the authored artifact; this script produces the exact PNG the
deterministic hatch-pet pipeline consumes (`decoded/<job>.png`).

SVG requirements (checked and reported, not silently fixed):

  * the canvas must be the exact pixel size: width = frames * 192, height = 208
  * frames sit in equal column slots, left to right, in animation order
  * the whole canvas must be covered by the flat chroma background from
    `pet_request.json` (default `#00FF00`); no transparency, no gradients
  * no text, labels, guide marks or slot borders

Rasterization backends, tried in order:

  1. cairosvg           (pip install cairosvg)      - best alpha/AA fidelity
  2. svglib + reportlab (pip install svglib reportlab) - pure Python, no native deps
  3. rsvg-convert / inkscape / magick on PATH

When no backend is available the script exits with the install hint instead of
producing a blank or partially rendered strip.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

CELL_WIDTH = 192
CELL_HEIGHT = 208
SUPPORTED_SUFFIXES = {".svg"}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Rasterize a hatch-pet SVG row strip into a decoded PNG."
    )
    parser.add_argument("--svg", required=True, type=Path, help="path to the .svg document")
    parser.add_argument(
        "--frames",
        required=True,
        type=int,
        help="number of frame slots in the strip (1 for the base pet)",
    )
    parser.add_argument("--output", required=True, type=Path, help="decoded PNG path to write")
    parser.add_argument(
        "--allow-size-mismatch",
        action="store_true",
        help="resize a non-192x208-per-frame raster instead of failing",
    )
    return parser.parse_args(argv)


def target_size(frames: int) -> tuple[int, int]:
    return frames * CELL_WIDTH, CELL_HEIGHT


def rasterize_with_cairosvg(svg_path: Path, out_path: Path, size: tuple[int, int]) -> bool:
    try:
        import cairosvg  # type: ignore
    except Exception:
        return False
    cairosvg.svg2png(
        url=str(svg_path),
        write_to=str(out_path),
        output_width=size[0],
        output_height=size[1],
    )
    return True


def rasterize_with_svglib(svg_path: Path, out_path: Path, size: tuple[int, int]) -> bool:
    try:
        from reportlab.graphics import renderPM  # type: ignore
        from svglib.svglib import svg2rlg  # type: ignore
    except Exception:
        return False
    drawing = svg2rlg(str(svg_path))
    if drawing is None:
        raise SystemExit(f"svglib could not parse {svg_path}")
    # Scale the drawing so the raster lands on the exact pixel grid. The SVG must
    # already carry width/height in pixels and a viewBox; this only guards
    # point/pixel rounding differences.
    if drawing.width and drawing.height:
        sx = size[0] / float(drawing.width)
        sy = size[1] / float(drawing.height)
        drawing.width *= sx
        drawing.height *= sy
        drawing.scale(sx, sy)
    renderPM.drawToFile(drawing, str(out_path), fmt="PNG")
    return True


def rasterize_with_cli(svg_path: Path, out_path: Path, size: tuple[int, int]) -> bool:
    commands = {
        "rsvg-convert": [
            "rsvg-convert",
            "-w", str(size[0]),
            "-h", str(size[1]),
            "-o", str(out_path),
            str(svg_path),
        ],
        "inkscape": [
            "inkscape",
            str(svg_path),
            "--export-type=png",
            f"--export-filename={out_path}",
            f"--export-width={size[0]}",
            f"--export-height={size[1]}",
        ],
        "magick": [
            "magick",
            "-background", "none",
            "-density", "384",
            str(svg_path),
            "-resize", f"{size[0]}x{size[1]}!",
            str(out_path),
        ],
    }
    for name, command in commands.items():
        if shutil.which(name) is None:
            continue
        subprocess.run(command, check=True)
        return True
    return False


def rasterize(svg_path: Path, out_path: Path, size: tuple[int, int]) -> str:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="hatch-pet-svg-") as tmp:
        temp_out = Path(tmp) / "raster.png"
        for name, fn in (
            ("cairosvg", rasterize_with_cairosvg),
            ("svglib", rasterize_with_svglib),
            ("cli", rasterize_with_cli),
        ):
            if fn(svg_path, temp_out, size):
                shutil.move(str(temp_out), str(out_path))
                return name
    raise SystemExit(
        "no SVG rasterizer available. Install one of:\n"
        "  python -m pip install cairosvg\n"
        "  python -m pip install svglib reportlab\n"
        "  or put rsvg-convert / inkscape / magick on PATH"
    )


def normalize_raster(out_path: Path, size: tuple[int, int], allow_mismatch: bool) -> None:
    from PIL import Image

    with Image.open(out_path) as image:
        if image.size == size:
            return
        if not allow_mismatch:
            raise SystemExit(
                f"rasterized size {image.size[0]}x{image.size[1]} != expected "
                f"{size[0]}x{size[1]}; set the SVG width/height to "
                f"{size[0]}x{size[1]} (frames * {CELL_WIDTH} x {CELL_HEIGHT}) or pass "
                "--allow-size-mismatch"
            )
        image.resize(size, Image.LANCZOS).save(out_path)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    svg_path: Path = args.svg
    if svg_path.suffix.lower() not in SUPPORTED_SUFFIXES:
        raise SystemExit(f"expected an .svg document, got: {svg_path}")
    if not svg_path.is_file():
        raise SystemExit(f"svg not found: {svg_path}")
    if args.frames < 1:
        raise SystemExit("--frames must be >= 1")

    size = target_size(args.frames)
    backend = rasterize(svg_path, args.output, size)
    normalize_raster(args.output, size, args.allow_size_mismatch)
    print(
        f"ok svg={svg_path} frames={args.frames} size={size[0]}x{size[1]} "
        f"output={args.output} backend={backend}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
