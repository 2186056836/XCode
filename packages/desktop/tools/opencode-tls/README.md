# opencode-tls

OpenCode 免费档的 TLS 传输 helper。

## 为什么需要它

`opencode.ai` 的匿名免费模型按 **TLS 客户端指纹**分额度桶：

| 客户端                                    | TLS 栈             | 结果                    |
| ----------------------------------------- | ------------------ | ----------------------- |
| Bun 1.3.14（官方 CLI 同源）               | BoringSSL          | 200                     |
| Node / Electron / Go crypto/tls           | OpenSSL / 各自默认 | 429 FreeUsageLimitError |
| uTLS 复刻 Bun 的 ClientHello（本 helper） | 手写 ClientHello   | 200                     |

2026-11-20 用本地 CONNECT 代理抓到了 Bun 的真实 ClientHello，并逐字节对齐：
TLS 1.3、17 个 cipher、无 GREASE、extension 顺序固定、padding 把 ClientHello
固定为 512 字节。复刻之后，Go 客户端从 429 变为稳定 200。

注意：**session ID 必须是合法格式**（`ses_` + 6 字节 descending 时间 hex + 14 位
base62，counter ≤ 63）。过长的 ID 也会落进 429 桶；这是参考实现里一个容易
踩的坑。

## 协议

每个进程处理一个请求：

```text
stdin  一行 JSON: {"method","url","headers":[["name","value"],...],"body":"<base64>"}
stdout 一行 JSON: {"status","statusText","headers":[["name","value"],...]}
       之后是解压后的响应体字节（Content-Encoding / Content-Length /
       Transfer-Encoding 已移除）
stderr 出错时的可读原因
```

只接受 `https://opencode.ai/...`，避免被当成任意 SSRF 通道。

## 构建

```bash
# 当前平台（发布链 prepare:runtime-assets 会自动调用）
node packages/desktop/scripts/build-opencode-tls-helper.mjs

# 全部目标（win32-x64 | win32-arm64 | darwin-arm64 | darwin-x64 | linux-x64）
node packages/desktop/scripts/build-opencode-tls-helper.mjs --all

# 指定目标
node packages/desktop/scripts/build-opencode-tls-helper.mjs --target win32-x64
```

需要本机安装 Go 1.24+（仅构建 helper 时需要，运行时不需要）。

产物写入 `packages/desktop/bundled-tools/<platform>/opencode-tls/`。

## 更新指纹

上游升级 Bun / 更改 TLS 配置后，旧指纹可能重新落进 429。重新抓包：

1. 用本地 CONNECT 代理记录 Bun 对 `opencode.ai:443` 的 ClientHello；
2. 对齐 cipher、extension 顺序、key share、padding（总长 512）；
3. 更新 `main.go` 的 `ClientHelloSpec` 与 `paddingLength`；
4. 重建二进制并跑一次真实请求确认 200。
