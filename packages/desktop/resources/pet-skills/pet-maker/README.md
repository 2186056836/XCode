# pet-maker

把角色做成透明动画桌宠的独立制作包。**不需要安装 dsh-pet，也不需要 DSH**：输入一批 10 秒绿幕视频，输出 640×360 VP9-alpha 的透明动画、清单和可直接加载的宠物配置。

流水线来自 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（MIT 代码），已做成可配置版本：目录、帧率、画布、CRF、并发都可以用命令行覆盖。

## 快速开始

```bash
# 环境：Python 3.10+ / ffmpeg / numpy / scipy
python -m pip install numpy scipy

# 1) 把绿幕 mp4 放进 video/（文件名 = 动作名，如 待机呼吸休闲.mp4）
#    或者把 PR 抠好的透明 mov 放进 pr/
# 2) 一条命令跑完
python scripts/make_pet.py --target dsh-pet --pet-id mypet --pet-name "我的宠物"

# 3) 校验（alpha / 尺寸 / 帧率 / 时长 / 配置引用 / 权重）
python scripts/validate_pet_pack.py dist/webm --config dist/pet/mypet-config.json

# 4) 安装进 dsh-pet（可选）
python scripts/make_pet.py --steps config --target dsh-pet --pet-id mypet \
  --install-root "$USERPROFILE/.dsh/dsh-pet"
```

产物：

```
dist/
├─ webm/<动作名>.webm
├─ manifest.json
└─ pet/<id>-config.json
```

## 目录

| 路径 | 作用 |
|---|---|
| `SKILL.md` | 给 AI agent 的工作流（含必须停下来问人的门槛） |
| `prompts/00-通用前缀.md` | 绿幕/构图/安全区/道具闭环/首尾帧硬约束 |
| `prompts/actions/*.md` | 106 段动作提示词（按秒分解） |
| `prompts/index.json` | 动作索引 + 是否含角色专有名词 |
| `scripts/make_pet.py` | 编排器：watermark → chroma/pr → normalize → encode → manifest/config |
| `scripts/*_step0*.py` | 各段素材链（可单独跑） |
| `scripts/validate_pet_pack.py` | 素材与配置校验 |
| `scripts/encode_hevc_alpha.sh` | macOS Safari 用的 HEVC-alpha `.mov`（可选） |
| `templates/` | 配置模板 |
| `docs/` | 流水线参数、配置字段、排障 |

## 两条抠像路线

- **自动（默认）**：`chroma_step02.py` 用 HSV 色相判定去绿幕，蓝/白/红不会误抠。
- **手工（推荐用于复杂动作）**：PR 导出带 alpha 的 `.mov` 放进 `pr/`，`pr_import_step02.py` 覆盖同名动作。
  可以同时用：先自动抠，再手工覆盖。

## 一条动作都没有？先跑冒烟测试

```bash
# 生成 4 秒纯绿幕 + 橙色方块
ffmpeg -y -f lavfi -i "color=c=0x00FF00:s=1280x720:d=4:r=24" \
  -vf "drawbox=x='400+80*sin(t*2)':y=200:w=320:h=400:color=orange:t=fill" \
  -c:v libx264 -pix_fmt yuv420p video/test.mp4
python scripts/make_pet.py --skip-watermark --target dsh-pet --pet-id smoke
```

能走到 `dist/pet/smoke-config.json` 且校验 0 error 就说明环境正常（时长警告是正常的，冒烟视频只有 4 秒）。

## 文档

- `docs/PIPELINE.md`：每一步的参数与数值。
- `docs/CONFIG.md`：宠物配置 / pet pack 字段与规则。
- `docs/TROUBLESHOOTING.md`：黑底、404、忽大忽小、脚底不齐等。

## 许可

代码 MIT。**素材（动画/提示词/源视频）禁止商用**，二创公开渠道须署名原项目。详见 `NOTICE.md`。
