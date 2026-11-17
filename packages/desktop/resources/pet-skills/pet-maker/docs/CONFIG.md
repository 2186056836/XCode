# 配置：字段与规则

## 三层结构（dsh-pet）

| 层级 | 写在哪 | 字段 |
|---|---|---|
| 实例级 | `main-config.jsonc` 或 `pet/<名>-config.json` 的 `pets[]` | `name` / `id` / `size` / `balanceEnabled` / `whisperEnabled` / `workStatusEnabled` / `fixedEnabled` / `display` / `position` / `whisperPrompt` |
| 全局默认 | 顶层（main 与 pet pack 都可写） | `physics` / `font` / `confineToScreen` / `whisperImageEnabled` / `chatImageEnabled` / `chatImageLimit` / `chatMemoryRounds` / `whisperModel` / `chatModel` / `eventsRefreshSec` |
| 条目级 | 顶层（main 一份、每个 pet pack 各一份） | `whisperPrompt` / `memes` / `workStatusTexts` / `animations` / `animationWeights` |

合并规则：**顶层字段整段替换**。写了 `animations` 就整段用你的，缺的子键不会从默认补回来。

## pets[] 字段

| 字段 | 必需 | 说明 |
|---|---|---|
| `id` | 是 | 全局唯一；素材根/记忆/接口参数都按它定位 |
| `name` | 否 | 显示名；悬浮提示与 AI 人设里用，可重复 |
| `size` | 是 | 宽度 px；高度自动 = size × 9/16 |
| `balanceEnabled` | 是 | 是否启用余额功能 |
| `whisperEnabled` | 是 | 是否按周期用 AI 生成碎碎念 |
| `workStatusEnabled` | 是 | 是否跟随工作状态切档位动画 |
| `fixedEnabled` | 是 | 随机链不抽 turn/move（不会自己转向/走开） |
| `display` | 是 | `web` / `desktop` / `both` / `none` |
| `position` | 是 | `{ corner: top-left/top-right/bottom-left/bottom-right, marginX, marginY }` |
| `whisperPrompt` | 否 | 实例人设；写了覆盖条目级 |

## animations

```jsonc
{
  "idle": ["待机呼吸休闲"],          // 必需、非空
  "turn": ["东张西望"],              // 播完会翻转朝向的动画
  "drag": ["被鼠标拖拽悬空反馈"],     // 被抓起悬空的姿势
  "clicks": ["点击回应-开心跃动"],    // 点击回应
  "moves": {
    "default": { "minDist": 60, "maxDist": 240, "margin": 20, "leadSec": 2, "tailSec": 2 },
    "actions": [{ "name": "螃蟹走路" }]
  },
  "categories": [
    { "id": "小动作", "weight": 50, "actions": ["悠闲哼歌"] },
    { "id": "文字", "weight": 30, "noMirror": true, "actions": ["是啊，吃什么"] }
  ],
  "events": { "workStatus": ["…6 档…"] }
}
```

规则：

- `moves.default` 的距离以基准宽 **462px** 为准，运行时按 `实际 size / 462` 等比缩放。
- `categories[].weight` 之和必须等于 `100 - idle - turn - move` 的权重余量。
- `noMirror: true`：带文字、镜像会颠倒的分类；宠物朝右时不播，点播前强制朝左。
- `events` 不进随机链，只由代码触发。`workStatus` 索引固定：
  `0 thinking / 1 working / 2 result / 3 waiting / 4 success / 5 error`，**不能插队**。
- `events.balance` 6 档按已用百分比：`p===100 → 5`，否则 `floor(p/20)`；缺档会错位。

## animationWeights

```json
{ "idle": 10, "turn": 5, "move": 5 }
```

`idle + turn + move + 各分类 weight = 100`。`fixedEnabled` 时 turn/move 的份额自动并入随机动作。

## pet pack（新「种类」）

```
<DSH_HOME>/dsh-pet/
├─ main-config.jsonc
├─ main-animation/webm/*.webm
└─ pet/
   ├─ pig-config.json
   └─ pig-animation/webm/*.webm
```

- 文件名前缀 = 种类名 = 素材根；`pets[]` 可放该种类任意多实例。
- 素材只查自己的目录，查不到即 404，**绝不回落** main/包内素材。
- `animations` / `animationWeights` 必须写全（不回落全局）。
- 实例 `id` 与其它条目冲突 → 加载时报错并跳过。

## 我们生成的配置（make_pet.py）

`--target dsh-pet` 会按**实际存在的素材**生成一份合法配置：

- `idle` 优先取 `待机呼吸休闲`，没有就用第一个动作；
- `turn/drag/clicks/moves` 只收存在的规范名；
- `events.balance` / `events.workStatus` 只有 6 段齐全时才写入（否则索引会错位，直接省略并告警）；
- 其余动作全部进一个「随机动作」分类，权重自动补到 100；
- 没有剩余动作时把余量并入 `idle`，仍然保证合计 100。

## XCode 适配（target=xcode）

`dist/xcode/pet.json` 是渲染端的中间格式：

```json
{
  "name": "我的宠物",
  "sizePx": 462,
  "position": { "corner": "top-right", "marginX": 24, "marginY": 100 },
  "webmDir": "webm",
  "manifest": "manifest.json",
  "actions": ["…"]
}
```

渲染端按 `manifest.json` 播放 640×360 的 webm 即可；画布与脚底线与 dsh-pet 一致
（画布 640×360、`FEET_Y=330`、命中区 200~440 × 50~335、基准宽 462）。
