# 排障

## 播放黑底 / 透明区域是黑的

alpha 丢了。检查两处：

1. 解码：读取 webm 的任何命令都必须带 `-c:v libvpx-vp9`（自动解码器会丢 alpha）。
2. 编码滤镜：`scale` 之后必须有 `format=yuva420p`。

复核：

```bash
python scripts/validate_pet_pack.py dist/webm
# 期望每行 alpha 形如 0-255；全 255 就是丢了
```

## dsh-pet 里右键菜单有名字，但点了不播

1. **文件名不匹配**：菜单来自配置，播放按名字找素材。必须逐字一致（含中文、空格）。
2. **放错目录**：主宠物要放 `main-animation/webm/`（多一层 webm 子目录）；
   pet pack 要放 `pet/<名>-animation/webm/`。直接放 `main-animation/` 根下会 404。
3. **素材根不对**：pet pack 只查自己的 `<名>-animation/`，绝不回落包内素材。

## 宠物忽大忽小 / 脚底不齐

- 上游规定源视频里角色头顶在 20%、脚底在 85%，且各段一致。构图偏差太大时
  `normalize_step03.py` 的站立测量会被道具干扰。
- 检查 `step03/params.json`：每段的 `scale` 应该接近；差异过大多半是某段动作把
  角色整体放大/缩小了（生成时没有锁死人物大小），需要重新生成那一段。
- 水平中心用的是 alpha 像素 x 中位数，避免手/道具把 bbox 拉偏；如果某段出现
  大面积单侧特效（烟花、动物环绕），仍可能偏，必要时手工修图或重生成。

## 角色被裁切 / 道具出画

生成阶段的问题：任何一帧任何部位/道具距画幅边缘必须 ≥10%。被裁的素材在抠像后
会直接缺一块，无法靠后处理补回来——只能重新生成。

## `ffmpeg not found`

- Windows：`winget install Gyan.FFmpeg`，或设置 `FFMPEG_BIN` / `FFPROBE_BIN` 为完整路径；
- 工作区有 `.tools/ffmpeg-*/bin` 时会自动使用；
- macOS：`brew install ffmpeg`；Linux：`apt install ffmpeg`。

## `ModuleNotFoundError: numpy/scipy`

```bash
python -m pip install numpy scipy
```

## 校验报「权重合计 ≠ 100」

`idle + turn + move + 各分类 weight` 必须正好 100。用 `make_pet.py` 生成的配置会自动满足；
手改配置时记得同步调整分类权重。

## 校验报「配置引用了不存在的动画素材」

配置里写了素材目录里没有的名字。删掉该项，或补齐对应的 webm。

## 工作状态动画档位错乱

`events.workStatus` 的数组索引就是状态档位（0 thinking … 5 error），**不能插队**，
只能整组存在或整组省略。`make_pet.py` 在 6 段不全时会直接省略该事件并告警。

## 文字被镜像

带文字的动作必须放进 `noMirror: true` 的分类，或者干脆不放随机分类
（只通过右键菜单点播，点播时渲染端会强制朝左）。

## PR 抠像的 mov 在 Windows 上导入后不透明

- mov 必须真的带 alpha（ProRes 4444 with Alpha 或 PNG 序列封装）；
- 用 `ffprobe -show_streams` 看 `pix_fmt` 是否含 `a`（如 `yuva444p10le`）；
- 导出时不要用 H.264（不支持 alpha）。

## 想强制重做某一段

删掉对应的 `stepXX/<名字>.webm` 再跑；脚本的断点续跑只跳过「存在且比源新」的文件。

## 时间太长 / 并发太高

`--parallel 1` 最稳；机械硬盘或内存紧张时建议 2~4。编码本身是 CPU 密集，核数决定上限。
