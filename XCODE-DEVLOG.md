
---

### 修复历史误改（2026-09-21）

第一轮目录分离的 `.zcode` → `.xcode` 替换规则误伤了代码上下文中的 `.zcode`（成员访问 `meta.xcode)`、spread 运算符 `...xcode,`、window 桥接 `window.xcode` 等），共约 70 处标识符级损坏。经三次 bootstrap 尝试失败后精确定位并修复，详见 Git history commit `568080c`。

关键修复点：
- `_meta.zcode` 协议字段读取（7+ 处：telemetry facts、server-operations、session-mapper、task adapter、api retry、background notifications、agentHelpers）
- legacy 配置字段 `model.zcode` / `provider.zcode`（3 处，改了会读不到旧配置数据）
- `rawNames.zcode` 工具身份解析（4 处）
- i18n key `settingsSync.agent.zcode`（4 处配对回滚）
- `window.zcode` 相关注释/类型定义（7+ 处）、legacy 迁移路径 `ai.z.zcode`（1 处）

**最终验证状态**：

| 检查 | 结果 |
|---|---|
| Node 24 type-stripping import 两个 locale | ✅ 通过，22 个 importModels key 中英对齐 |
| tsc --noResolve 语法级检查 | ✅ 无新增语法错误 |
| `pnpm bootstrap` | ✅ 通过（exit 0，第三次重跑成功） |
| `pnpm typecheck` | ✅ 通过（exit 0） |
| `pnpm lint` | ✅ 通过（exit 0, 0 errors, 70 warnings 全是既有遗留） |
| Git 历史 | `568080c 修复:标识符级 .zcode→.xcode 误改损坏` + `4f3690e fork baseline` |

---

## 改动 1：目录分离（已完成）

命令名 `zcode` → `xcode`，安装/数据目录 `.zcode` → `.xcode`，桌面身份 `dev.xcode.app` / AUMID `cn.aminer.xcode` / service label `com.zhipu.xcode.server`。详见 [XCODE-MIGRATION.md](./XCODE-MIGRATION.md)。
