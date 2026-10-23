---
name: xcode-provider-account
description: "Use when importing, listing, switching, removing, or refreshing XCode provider account credentials: Qoder (cn/intl), CodeBuddy (cn/intl), zai, bigmodel. Covers the ProviderAccount tool contract, why Qoder imports need a device fingerprint and how the tool obtains one, why zai/bigmodel use accountRef instead of a provider id, and the exact failure modes when a token is imported into the wrong region or without a refresh token."
when_to_use: "Only when the user is working with XCode's own provider accounts — 导入账号, 导入 token, 账号凭据, 切换账号, 刷新 token, 删除账号, 账号轮询. Not for general OAuth questions, and not for editing provider_config.json or credential files by hand."
---

# XCode 账号凭据导入

一句话模型：**凭据只能通过 `ProviderAccount` 工具写入，工具永远不回显令牌**。账号表按族分开存，四族的身份键和必填项都不一样。

## 1. 四个族，两套存储

| family | 存储 | 账号键 | 必填 |
| --- | --- | --- | --- |
| `qoder` | 独立 region 账号表 | `userId`（JWT `sub`，或显式 `identity`） | `region` + `accessToken` |
| `codebuddy` | 独立 region 账号表 | JWT `sub` | `region` + `accessToken` |
| `zai` | `oauthCredentialRepo` | `accountRef = zai:<identity>` | `accessToken` |
| `bigmodel` | `oauthCredentialRepo` | `accountRef = bigmodel:<identity>` | `accessToken` |

`region` 只对 Qoder / CodeBuddy 有意义，**且必须与令牌签发区一致**：CN 令牌导进 `intl` 表能写进去，但第一次请求就会被上游拒绝。zai / bigmodel 没有 region，传了会被忽略。

## 2. Qoder 的设备指纹是硬约束

Qoder 的 claim 接口和 COSY 签名都校验 `machineToken` 的真实性——必须是官方 machine-info 铸造的 `P1gA...`，本地随机生成一律被判「User is not eligible」。

因此 `ProviderAccount` 的 Qoder 导入路径**会自动向 mi-token 接口取一套三件套**（`machineToken` / `machineType` / `machineCode`）：

- 一号一绑，不缓存：每次导入都取新的，避免两个账号拿到同一套指纹；
- 取不到就直接让导入失败并说明原因，不会存一个没有指纹的账号——那种账号要等到第一次请求才炸，更难排查；
- mi-token 端点可用 `QODER_MI_TOKEN_URL` 覆盖（逗号分隔多个），`QODER_MI_TOKEN_API_KEY` 用于批量。

CodeBuddy 不需要设备指纹，只有 region + token。

## 3. 工具接口

工具名 `ProviderAccount`，扁平入参，`action` 枚举。

| action | 必填 | 说明 |
| --- | --- | --- |
| `list` | `family`（+`region`） | 返回脱敏账号视图：`accountId` / `displayName` / `hasAccessToken` / `hasRefreshToken` / `expiresAt` / `active`。**任何写操作前先跑这个拿 accountId** |
| `import` | `family`, `accessToken`（+`region`） | upsert 语义：同一 identity 再导入是覆盖令牌，不会产生重复账号 |
| `remove` | `family`, `accountId`（+`region`） | 删除账号；破坏性操作，执行前先跟用户确认 accountId |
| `activate` | `family`, `accountId`（+`region`） | 切换激活账号 |
| `refresh` | `family`, `accountId`（+`region`） | 用 refreshToken 换新 accessToken。zai/bigmodel 不支持手动刷新（按需自动刷新） |

### import 的字段

- `accessToken`：必填。Qoder 是 `token` 字段，CodeBuddy 是 `accessToken`，zai/bigmodel 是 OAuth `access_token`。
- `refreshToken`：**强烈建议带上**。不带的话令牌过期后无法自刷新，只能重新导入。
- `expiresAt`：epoch 毫秒。可省；省了就当「一直有效直到上游拒绝」。
- `identity`：zai/bigmodel 必填（除非 token 是带 `sub` 的 JWT），它决定 accountRef。Qoder/CodeBuddy 可省，默认取 JWT `sub`。
- `displayName` / `email`：仅用于展示。

## 4. 常见失败

| 现象 | 原因 |
| --- | --- |
| `qoder import needs identity` | 令牌不是 JWT（没有 `sub`），必须显式传 `identity` |
| `qoder import could not obtain a device fingerprint` | mi-token 端点不可用。检查 `QODER_MI_TOKEN_URL` 与出口网络，**不要**改成伪造 token |
| `qoder requires region` | 漏了 `region`，Qoder/CodeBuddy 必须指定 cn 或 intl |
| 导入成功但请求 401 | 令牌与 region 不匹配，或令牌已过期且没有 refreshToken |
| `zai refreshes its OAuth token on demand` | zai/bigmodel 不支持 `refresh` action，这是预期行为 |

## 5. 安全边界

- 不要把令牌写进文件、shell 命令、日志或聊天记录。工具是唯一的写入路径。
- `list` 只返回布尔状态和到期时间，拿不到令牌原文——需要令牌本身时，只能由用户提供。
- `remove` 是破坏性的：除非用户明确点名要删哪个 accountId，否则先确认。
