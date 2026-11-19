/**
 * OpenCode 免费档 TLS helper 的环境变量名（由 Desktop 主进程注入）。
 *
 * 免费档按 TLS 客户端指纹分额度桶：Node/OpenSSL 是 429，只有复刻 Bun 的
 * ClientHello 才能进 200 桶。helper 是随桌面端打包的原生二进制，路径通过
 * 这个环境变量传给 agent/host；不在桌面端运行时缺省为空，调用侧回退普通 fetch。
 */
export const OPENCODE_FREE_TLS_HELPER_ENV = "ZCODE_OPENCODE_TLS_HELPER";
