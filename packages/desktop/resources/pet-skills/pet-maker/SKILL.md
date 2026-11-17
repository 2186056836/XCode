---
name: pet-maker
description: 制作透明动画桌宠的完整流程：AI 绿幕视频 → 透明 webm → 640×360 播放变体 → manifest + 宠物配置（dsh-pet / XCode / 通用）。当用户说「制作宠物」「做一个桌宠」「把这个角色做成宠物」「把绿幕视频转成透明动画」时使用。
---

# pet-maker：从角色到桌宠

这个包把 dsh-pet 的素材链独立出来了：**不要求安装 dsh-pet，也不要求 DSH 环境**。只要有 Python 3、ffmpeg、numpy/scipy，就能把一批绿幕视频变成可直接被渲染端播放的透明动画 + 配置。

## 0. 开始前必须确认的三件事

1. **角色参考图**：一张标准正面站立设定图（后续第一帧/最后一帧都要求与它一致）。
2. **目标格式**（影响最终配置产物）：
   - `dsh-pet`：产出 `pet/<id>-config.json` + `<id>-animation/webm/`；
   - `xcode`：产出 `dist/xcode/pet.json`（XCode 侧 DSH 悬浮窗适配）；
   - `generic`：只产出 `webm/` + `manifest.json`。
3. **动作范围**：先做 1 个待机动作跑通全链路（推荐），还是一口气做完整 106 个动作。

## 1. 硬门槛：谁来生成视频

这一步**必须问用户并等回答**，不要自行假设：

> 生成 10 秒绿幕动作视频需要文生视频模型。你有可用的 API 吗（服务商 / endpoint / key / 参考图上传方式）？
> 没有的话，你也可以自己用可灵/即梦/豆包/Runway 等按 `prompts/` 生成 mp4，放进 `video/`，剩下的我全包。

- 用户提供 API：按它的文档逐段生成；每段必须遵守 `prompts/00-通用前缀.md` 的全部硬约束。
- 用户提供 mp4：直接进入第 3 步。
- **用户既不给 API 也不给视频 → 停止，不要产出半成品，不要用占位图糊弄。**

同时检查运行环境：`python --version`、`ffmpeg -version`、`python -c "import numpy, scipy"`。缺什么就告诉用户装什么（Windows: `winget install Gyan.FFmpeg`；macOS: `brew install ffmpeg`；Linux: `apt install ffmpeg`）。

## 2. 生成绿幕动作视频（用户有 API 时）

- 每个动作一段 **10 秒、16:9、24fps、纯绿幕 #00FF00** 的视频，首尾帧都是标准正面站立。
- 角色必须全程零位移，头顶约在画面 20% 高度、脚底约在 85%，任何部位/道具距画幅边缘 ≥10%。
- 道具走「无→有→无」闭环：第一帧干净，道具由虚到实生成，结束前消散。
- 每段提示词 = `prompts/00-通用前缀.md` + `prompts/actions/<动作名>.md`。
- 角色适配：动作提示词是按上游「蓝发女仆」写的，`prompts/index.json` 里 `characterSpecific: true` 的动作约 100 段，必须把角色专有名词（蓝发/女仆/鲸鱼尾巴/呆毛/鳍饰/裙摆）替换成目标角色的对应物；实在不适用的动作直接跳过（例如角色没有尾巴，就不要「用鲸鱼尾巴拍打地面」）。
- 文件名用动作名（`吃白饭.mp4`），放进 `video/`。

## 3. 素材链（一条命令）

```bash
# 全链路：video/ → step01 → step02 → step03 → step04 → dist/
python scripts/make_pet.py --target dsh-pet --pet-id mypet --pet-name "我的宠物"
```

常用参数：

| 参数 | 说明 |
|---|---|
| `--skip-watermark` | 视频没有水印时跳过 step01（没有 `video/watermark_mask_v5.mkv` 也会自动跳过） |
| `--no-auto-chroma` | 只使用 `pr/*.mov` 的手工抠像结果 |
| `--steps chroma/normalize/encode/config` | 只跑某一段 |
| `--parallel 4` | 并发数 |
| `--size / --corner / --margin-x / --margin-y` | 生成配置时的体型与位置 |
| `--install-root ~/.dsh/dsh-pet` | 直接装进 dsh-pet 用户目录 |

产物：

```
dist/
├─ webm/<动作名>.webm     # 640×360 VP9-alpha 播放素材
├─ manifest.json          # 每个动作的尺寸/帧率/时长/alpha 统计
└─ pet/<id>-config.json   # target=dsh-pet 时的配置
```

两条抠像路线可以叠加：先用 `chroma_step02.py` 自动抠，再用 `pr_import_step02.py` 用 PR 手工结果覆盖同名动作（上游官方素材就是这么做的）。

## 4. 校验（不许跳过）

```bash
python scripts/validate_pet_pack.py dist/webm --config dist/pet/mypet-config.json
```

- **ERROR 必须修**：alpha 丢失（黑底）、配置引用的动画不存在、权重合计 ≠ 100、id 重复。
- WARN 通常是素材问题：尺寸不是 640×360、帧率不是 24、时长不在 6~14 秒、素材没被配置引用。
- 自检报告要原样给用户，不要只丢一句「完成了」。

## 5. 安装与交付

- `dsh-pet`：把 `dist/pet/<id>-config.json` 放到 `<DSH_HOME>/dsh-pet/pet/`，把 `dist/webm/*.webm` 放到 `pet/<id>-animation/webm/`；或者直接用 `--install-root`。
- `xcode`：`dist/xcode/pet.json` + `webm/` 交给渲染端适配层。
- `generic`：`manifest.json` + `webm/` 即可，任何渲染器按 manifest 播放。

交付时说明：动作清单、总大小、每个 WARN 的原因、以及下面的许可限制。

## 6. 绝对不要做

- 不要跳过 alpha 校验就宣布完成（最常见的事故是黑底）。
- 不要把非绿幕素材硬抠（花背景/渐变背景抠不干净，要求用户重新生成绿幕版或走 PR 手工路线）。
- 不要把不同站立高度的素材混在一起发（会让宠物忽大忽小；step03 会统一，但源视频构图太离谱时也会崩）。
- 不要把上游素材用于商业用途，不要删除 `NOTICE.md`。

## 许可

代码 MIT；**动画/提示词/源视频素材允许开源使用但禁止商用**；二创在公开渠道必须署名
<https://github.com/PC2005-cloud/dsh-pet>。详见 `NOTICE.md`。
