---
name: xcode-proxy-pool
description: "Use when configuring XCode proxy pools or per-connection proxy bindings: adding/editing/deleting/testing a pool, assigning a pool to a provider account (Qoder / CodeBuddy), batch-applying one pool to all accounts, cycling pools across accounts, enabling/disabling a pool, and explaining proxy egress — which traffic uses a pool, which follows XCode's global proxy, and why a bound account ignores the global proxy. Also covers the config file shapes behind these settings, for reading or diagnosing only."
when_to_use: "Only when the user is talking about XCode's own proxy configuration — 代理池, 代理出口, 全局代理, 账号绑代理, 某个账号不走全局代理. Not for general HTTP proxy questions, curl -x debugging, or writing a proxy into some other app's config."
---

# XCode 代理池配置

一句话模型：**出口绑定在「连接」上，不在「供应商」上**。一个连接 = 一个账号（Qoder / CodeBuddy 才有账号）。配置载体是设置页里的「代理池」与「代理出口」，agent 侧走 `ProxyPool` 工具，**不要去手改配置文件**。

## 1. 三个状态（穷尽，不要发明第四个）

| 状态 | 出口 |
| --- | --- |
| 已绑定某个启用的池 | 该连接的提供商流量（登录、模型请求、签到）全部走该池，**不再走全局代理** |
| 未绑定 | 跟随 XCode 全局代理状态：全局设了就用，没设就走直连 |
| 绑定但池被停用 / 地址无效 | **硬直连**，绝不回落全局代理 |

第三条是最容易讲错的地方：池停用是「关掉这个出口」，不是「回退到全局代理」。用户问「为什么这个账号没走全局代理」时，先查它是不是绑定了一个被停用的池。

`distribute`（轮流分配）的语义是**按账号轮转，每个账号固定拿一个池**，不是按请求轮换。不要描述成「每次请求换 IP」。

## 2. 工具接口

工具名 `ProxyPool`，一个 `action` 枚举，扁平入参（没有 provider 层级，不要拼嵌套对象）。

| action | 必填 | 说明 |
| --- | --- | --- |
| `list` | — | 读全部池 + 供应商摘要（含 `accountCount` / `boundAccountCount`）；给 `providerId` 时附带该供应商的账号与绑定视图。**任何其它 action 前先跑这个拿 id** |
| `save` | `poolName`, `proxyUrl` | 新建池；带 `poolId` 则是更新。可选 `noProxy`（绕过规则）、`isActive`、`strictProxy` |
| `delete` | `poolId` | 删池；所有绑定它的连接回到「未绑定 = 跟随全局」 |
| `set_active` | `poolId`, `isActive` | 启停池。停用后绑定者变硬直连 |
| `test` | `poolId` 或 `proxyUrl` | 真发一个出网请求探测出口 IP；可选 `testUrl` 覆盖探测目标 |
| `bind_account` | `providerId`, `accountId`, `poolId` | 单账号绑池 |
| `unbind_account` | `providerId`, `accountId` | 解绑，回到跟随全局 |
| `apply_to_all` | `providerId`, `poolId` | 把某池套用到该供应商全部账号 |
| `clear_all` | `providerId` | 清空该供应商全部绑定（等价于对全部账号解绑） |
| `distribute` | `providerId` | 按 `poolIds` 顺序轮流分配；`poolIds` 可省或传空数组 = 用当前全部启用的池（没有任何启用池时会被拒） |

`proxyUrl` 支持 `http` / `https` / `socks4` / `socks4a` / `socks5` / `socks5h`（`socks4a` / `socks5h` 是别名，分别归一到 socks4 / socks5），带认证写成 `http://user:pass@host:port`；只写 `host:port` 也接受，按 `http` 处理。控制字符、反引号、`$` 会被拒。

返回值：所有 action 都回当前全量 `pools` + `providers` 摘要，`provider` 相关的 action 再回该供应商的 `provider` 视图（含 per-account `boundEntryId`），`test` 额外回 `test`（`ok` / `status` / `elapsedMs` / `exitIp` / `error`）。所以**改完不用再读一次**。

## 3. id 怎么来（最容易踩的坑）

- `poolId`、`accountId` **只能从 `list` 的返回里取**，不许自己编。`save` 传一个不存在的 `poolId` 不会报错，它会**新建一个池**；`accountId` 写错则是绑了个永远不会被用到的 key，工具还回 success。
- `providerId` 用带前缀的规范形式，就是 `list` 里 `providers[].providerId` 的原样字符串：
  `other:qoder`、`other:qoder-cn`、`other:codebuddy`、`other:codebuddy-cn`。
- `other:qoder` 与 `other:qoder-cn` 是**两份独立的账号表**（国内 / 海外区）。在哪个区读到账号，就绑哪个区的 `providerId`；跨区绑会写到一个永不使用的 id 上。
- `accountId` 是供应商侧的账号标识：Qoder 取 `x-qoder-internal-user-id`，CodeBuddy 取 JWT 的 `sub`。用户口头说的「邮箱 / 昵称」对应视图里的 `email` / `displayName`，要映射回 `id` 再传。
- 只有 `supportsConnections=true` 的供应商有账号（Qoder、CodeBuddy）。其它供应商没有账号概念，也就**没有代理池绑定**，一律吃全局代理——不要试图给它们绑池。

## 4. 典型流程

新建一个池并验证，再套给某个供应商的全部账号：

```
ProxyPool { action: "save", poolName: "sydney-1", proxyUrl: "http://user:pass@1.2.3.4:7897" }
ProxyPool { action: "test", poolId: "<上一步返回的 id>" }        ← 报告 exitIp
ProxyPool { action: "apply_to_all", providerId: "other:qoder", poolId: "<id>" }
```

只给一个账号换出口：

```
ProxyPool { action: "list", providerId: "other:qoder" }          ← 拿 accountId
ProxyPool { action: "bind_account", providerId: "other:qoder", accountId: "<id>", poolId: "<poolId>" }
```

解绑或停用：

```
ProxyPool { action: "unbind_account", providerId: "other:qoder", accountId: "<id>" }   ← 回到跟随全局
ProxyPool { action: "set_active", poolId: "<id>", isActive: false }                    ← 绑定者转硬直连
```

## 5. 错误与拒绝

`save` 的入参校验失败会回稳定错误码，按码改参数重试即可，不要换参数硬试：

- `proxy-pool-name-required` — 没给名字（新建时 `poolName` 必填）
- `proxy-url-required` / `proxy-url-invalid-characters` / `proxy-url-unparsable`
- `proxy-url-unsupported-scheme` — scheme 不在 http/https/socks4/socks4a/socks5/socks5h 之内
- `proxy-url-missing-host`

其它情况：

- 回 `-32601` / 提示代理池服务不可用 → 这个 Host 没装配代理池服务（老版本）。告诉用户升级应用，**别去改配置文件**。
- `providerId` 未知 → 视图为 null，回 `Unknown provider id: ...`。回头用 `list` 取规范 id。

## 6. 权限与副作用

- `list` 只读，计划模式放行。
- `test` 只读但会真发一次出网请求，需要确认。
- 其余 action 改的是**应用级配置**（对所有 workspace 生效，不属于任何一个 workspace），一律需要确认，且**计划模式下不允许**。用户没让你改就别改。

改完不用重启，下一个请求生效。用户问「为什么某账号流量没走全局代理」时，答「它绑了池」并说出池名与出口 IP；这就是设计如此。

## 7. 落盘位置（仅供排查，禁止手改）

- 池定义：`<dataDir>/.xcode/v2/setting.json` → `proxyPools`（dataDir 默认 `~`）
- 绑定的落点：提供商配置的 `api.proxy` → `~/.xcode/v2/provider_config.json`

绑定是「连接 → 单个池」的映射，没有供应商级的开关，也没有存进配置的轮换策略——所以**不存在**「这个供应商启用了代理池」这种状态，别去找它。旧版本写下的一些历史 `api.proxy` 形状会在读取时被判为无效并降级成「未绑定」，用户需要在新的界面里重新绑一次。

手工编辑这两个文件会和正在运行的应用互相覆盖（应用写完约 1 秒后可能被另一份进程重写），所以让用户走设置页或让 agent 走 `ProxyPool` 工具。
