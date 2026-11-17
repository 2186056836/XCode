/**
 * 账号轮询 failover 的可用状态码。
 *
 * 放在 shared 而不是 services：services 的入口会拉进 `node:fs/promises`，渲染进程
 * （dev 下 `@zcode/services` 直接解析到 src/index.ts）引用任何一个运行期值都会整页白屏。
 * 这里只放常量与纯类型，UI 和 host 侧共用同一份取值。
 */
export const ACCOUNT_ROTATION_FAILOVER_STATUS = [401, 402, 403, 429] as const;

export type AccountRotationFailoverStatus = (typeof ACCOUNT_ROTATION_FAILOVER_STATUS)[number];

/**
 * 账号轮询 failover 的可用业务码（provider 响应体里的 providerCode）。
 *
 * zai / bigmodel 账号族的上游把业务错误包在 HTTP 200 里返回（如额度耗尽
 * providerCode=1005、statusMessage="exceed quota limit"），HTTP 状态码白名单对它们
 * 天然失明；且额度按账号隔离，换号才能真正解决，其余错误（429/并发/鉴权）应走
 * 重试而不是切号。当前唯一换号触发码就是额度耗尽 1005。
 */
export const ACCOUNT_ROTATION_FAILOVER_QUOTA_PROVIDER_CODES = ["1005"] as const;

export type AccountRotationFailoverProviderCode =
  (typeof ACCOUNT_ROTATION_FAILOVER_QUOTA_PROVIDER_CODES)[number];
