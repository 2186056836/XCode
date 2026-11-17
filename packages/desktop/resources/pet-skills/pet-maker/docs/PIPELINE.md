# 素材链：参数与数值

```
video/ (任意分辨率 16:9 mp4，建议 1280×720 或 1920×1080，24fps)
  │ watermark_step01.py        去水印（可选，需要遮罩 mkv）
  ▼
step01/ (无损尺寸 mp4)
  │ chroma_step02.py           HSV 绿幕抠像 → 透明 webm
  │ pr_import_step02.py        PR 手工 alpha mov → 透明 webm（覆盖同名）
  ▼
step02/ (透明 webm，保持源分辨率)
  │ normalize_step03.py        站立高度统一 + 2160×1215 居中 + 脚底对齐
  ▼
step03/ (母版 2160×1215，24fps，VP9-alpha CRF30)
  │ encode_thumbs.py           缩到 640×360 播放变体
  ▼
step04/ = dist/webm/ (640×360，24fps，VP9-alpha CRF40)
  │ make_pet.py                manifest + 宠物配置 + 校验
  ▼
dist/manifest.json / dist/pet/<id>-config.json
```

## 每一步的固定数值

| 步骤 | 关键参数 |
|---|---|
| 源视频 | 16:9；建议 1280×720；24fps；10s；绿幕 #00FF00 |
| watermark | 遮罩 `watermark_mask_v5.mkv`；每个水印像素取第 5 近的非水印像素颜色；libx264 crf18 |
| chroma | HSV：hue 70°~170°，S≥0.15，V≥0.15，边界羽化 6°；`libvpx-vp9 + yuva420p + CRF30 + auto-alt-ref 0` |
| pr_import | `libvpx-vp9 + yuva420p + CRF32 + -an`，保持原分辨率 |
| normalize | 画布 2160×1215；站立高度 900；脚底 `FEET_Y = 1215-100`；水平中心用 alpha 像素 x 中位数；24fps；CRF30 |
| encode | 640×360；CRF40；24fps；`-an`；`scale=640:360,format=yuva420p` |

**推导**：2160×1215 → 640×360 是 ×0.2963，因此母版脚底 1115 → 播放素材脚底 ≈330，正好是渲染端的 `FEET_Y=330`、画布 640×360。

## 两个必须记住的 alpha 坑

1. **解码**：任何读 webm 的地方都必须显式 `-c:v libvpx-vp9`。ffmpeg 自动选解码器会丢 VP9 alpha，表现为播放黑底。
2. **滤镜**：`scale` 之后必须 `format=yuva420p`，否则 alpha 同样被压掉。

`validate_pet_pack.py` 会用与渲染端一致的方式复核 alpha（min < 100 且 max > 200）。

## 常用命令

```bash
# 全链路
python scripts/make_pet.py --target dsh-pet --pet-id mypet --pet-name "我的宠物"

# 只重做某段（输入目录/输出目录默认是约定的 stepXX，可用 --src/--out 改）
python scripts/chroma_step02.py --src video --out step02
python scripts/normalize_step03.py --src step02 --out step03
python scripts/encode_thumbs.py --src step03 --out step04

# 手工抠像覆盖
python scripts/pr_import_step02.py --src pr --out step02

# 换画布 / 换站立高度 / 换播放分辨率
python scripts/normalize_step03.py --canvas 1920x1080 --target-height 800 --feet-gap 90
python scripts/encode_thumbs.py --width 480 --height 270 --crf 38

# 校验
python scripts/validate_pet_pack.py dist/webm --config dist/pet/mypet-config.json --strict
```

## 断点续跑

每个脚本都会跳过「输出存在、体积够、比源新、ffprobe 可读」的文件。中断后重跑同一条命令即可，不会重复编码已完成的动作。要强制重做某个动作，删掉对应输出文件再跑。

## 水印

源视频没有水印时：
- 直接 `--skip-watermark`；
- 或保证 `video/` 下没有 `watermark_mask_v5.mkv`（脚本会自动跳过）。

有动态水印时，遮罩必须覆盖水印出现过的所有帧（上游用 `make_mask_black.py` 从黑底遮罩视频生成）。

## macOS / Safari

Safari 与 WKWebView 不认 VP9 alpha。需要额外跑：

```bash
./scripts/encode_hevc_alpha.sh assets/webm dist-mov
python scripts/check_alpha.py dist-mov/*.mov
```

产物是 HEVC-with-Alpha `.mov`，放进 `main-animation/mov/`（pet pack 则是 `pet/<名>-animation/mov/`），
并把渲染端的播放扩展名切到 `.mov`。这一步只能在 macOS 上跑（AVFoundation）。
