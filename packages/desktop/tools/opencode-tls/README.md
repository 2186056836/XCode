# opencode-tls

OpenCode 免费档的 TLS 传输 helper。

## 为什么需要它

`opencode.ai` 的匿名免费模型按 **TLS 客户端指纹**分额度桶：

| 客户端                                    | TLS 栈             | 结果                    |
| ----------------------------------------- | ------------------ | ----------------------- |
| Bun 1.4.4（官方 CLI 1.19.4 同源）         | BoringSSL          | 200                     |
| Node / Electron / Go crypto/tls           | OpenSSL / 各自默认 | 429 FreeUsageLimitError |
| uTLS 复刻 Bun 1.4.4 的 ClientHello（本 helper） | 手写 ClientHello | 200                     |

2026-11-20 用本地 CONNECT 代理抓到了官方 CLI 的原始 ClientHello，并逐字节对齐：
TLS 1.3、17 个 cipher、无 GREASE、13 个 extension 固定顺序；key share 首项是
**X25519MLKEM768**（1216 字节）再接 X25519，ClientHello 约 1.5KB，**没有 padding**。

旧版 helper 复刻的是 Bun 1.3.14 的 512 字节 padded 指纹，换成 1.4.4 后该指纹不再是
官方客户端形态，请求会稳定 429——升级上游 CLI 后必须重新抓包对齐。

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

## 代理

helper 默认直连。需要走 HTTP CONNECT 代理时设置 `OPENCODE_TLS_PROXY`
（例如 `http://user:pass@127.0.0.1:7890`）；未设置时回退标准 `HTTPS_PROXY` /
`https_proxy`。代理只转发 TCP 隧道，TLS 仍由本进程端到端发起，ClientHello
指纹不受影响。仅支持 `http://` CONNECT（不支持 SOCKS）。

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

1. 用本地 **转发型** CONNECT 代理（只记录原始字节、不终止 TLS）记录官方 CLI 对
   `opencode.ai:443` 的 ClientHello；
2. 对齐 cipher、extension 顺序与 body、key share（X25519MLKEM768 在前）、ALPN；
3. 更新 `main.go` 的 `ClientHelloSpec`（uTLS 自定义 spec，混合 key share 用
   `utls.X25519MLKEM768`）；
4. 重建二进制并跑一次真实请求确认 200。
5. 注意：签名还要求 system 含 `<env>` 段、工具里含小写 `read`（且 read/edit 的
   参数名不能是 file_path/old_string/new_string）；这些在
   `adapters/src/model/opencode-build-agent.ts`，不在 helper 内。
