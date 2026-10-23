/**
 * 账号轮询 failover 的可用状态码。
 *
 * 放在 shared 而不是 services：services 的入口会拉进 `node:fs/promises`，渲染进程
 * （dev 下 `@zcode/services` 直接解析到 src/index.ts）引用任何一个运行期值都会整页白屏。
 * 这里只放常量与纯类型，UI 和 host 侧共用同一份取值。
 */
export const ACCOUNT_ROTATION_FAILOVER_STATUS = [401, 402, 403, 429] as const;

export type AccountRotationFailoverStatus = (typeof ACCOUNT_ROTATION_FAILOVER_STATUS)[number];
