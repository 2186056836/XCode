import { z } from "zod";
import { sparseShape } from "@zcode/shared/config-schema";
// 用子路径而不是根入口：根入口会拉进 shared 的 node 依赖模块（env.ts / mcp.ts 等），
// provider 的 tsconfig 没有 node types，编译会因 process 未定义整片失败。
import { providerProxyBindingSchema } from "@zcode/shared/proxy-pool";

export const providerApiTypeDataSchema = z.enum([
  "anthropic-messages",
  "openai-chat-completions",
  "openai-responses",
]);
export const providerGroupDataSchema = z.enum([
  "standard-personal",
  "zai-family",
  "bigmodel-family",
  // XCode fork：免费供应商组（内置凭据、连接信息不对用户显示）。
  "free",
  // XCode fork：其他登录型供应商组（CodeBuddy 等，OAuth/API Key 双模式）。
  "other",
]);
export const zhipuAccountModeDataSchema = z.enum([
  "start-plan",
  "individual-coding-plan",
  "team-coding-plan",
  "off-peak",
  // 加速卡访问类别；与 zcodeProviderAccountAccessSchema.mode 同值，改动需同步两处。
  "highspeed",
]);
export const providerVisibilityDataSchema = z.enum(["visible", "hidden"]);
export const providerLogoDataSchema = z
  .object({ type: z.literal("builtin"), key: z.string().min(1) })
  .strict();

const nonBlankRequiredString = z.string().refine((value) => value.trim().length > 0, {
  message: "必填配置不能为空",
  params: { configIssueCode: "required-field-missing" },
});

export const apiKeyAccessDataSchema = z
  .object({
    type: z.enum(["api-key", "zhipu-coding-plan-api-key"]),
    apiKey: z.string().nullable().optional(),
    apiKeyManagementUrl: z.string().url().nullable().optional(),
  })
  .strict();
// XCode fork：部分提供商（本地网关 / 免鉴权端点）不需要 API Key，
// 准入不再强制非空——否则空 Key 的自定义提供商会直接被报错弃用。
// 真正需要鉴权的端点由请求层 401 反馈；请求层已对空 Key 免发 Authorization。
export const completeApiKeyAccessDataSchema = apiKeyAccessDataSchema;

export const completeZhipuAccountAccessDataSchema = z
  .object({
    type: z.literal("zhipu-account"),
    accountType: z.enum(["zai", "bigmodel"]),
    mode: zhipuAccountModeDataSchema,
    entitled: z.boolean(),
  })
  .strict();
export const zhipuAccountAccessDataSchema = z
  .object({
    ...sparseShape(completeZhipuAccountAccessDataSchema.shape),
    type: completeZhipuAccountAccessDataSchema.shape.type,
  })
  .strict();
export const providerAccessDataSchema = z.discriminatedUnion("type", [
  apiKeyAccessDataSchema,
  zhipuAccountAccessDataSchema,
]);
const completeProviderAccessDataSchema = z.discriminatedUnion("type", [
  completeApiKeyAccessDataSchema,
  completeZhipuAccountAccessDataSchema,
]);

export const completeProviderApiDataSchema = z
  .object({
    type: providerApiTypeDataSchema,
    baseUrl: nonBlankRequiredString.pipe(z.string().url()),
    headers: z.record(z.string(), z.string()).readonly().nullable().optional(),
    // XCode fork：连接级代理池绑定（{ bindings: { [accountId]: 池条目 } }）。
    // 随 provider config 下发到 agent，请求层即可自包含地按账号选出口；
    // 与全局 httpProxy 互斥（绑了池的账号不走全局），未绑定的账号跟随全局。
    // 旧形状（enabled/strategy/entryIds/accountBindings）会被 schema 降级为 null，
    // 不会让整份 provider overlay 解析失败。
    proxy: providerProxyBindingSchema.nullable().optional(),
  })
  .strict();
export const providerApiDataSchema = z
  .object({
    ...sparseShape(completeProviderApiDataSchema.shape),
    baseUrl: z.string().url().nullable().optional(),
    proxy: providerProxyBindingSchema.nullable().optional(),
  })
  .strict();
// Personal 允许暂存编辑中的 endpoint；完整 schema 仍拒绝，且只影响该 Provider 的准入。
export const personalProviderApiDataSchema = providerApiDataSchema.extend({
  baseUrl: z.string().nullable().optional(),
});

const modelIdsDataSchema = z.array(z.string().min(1)).readonly().nullable().optional();
export const providerConfigDataSchema = z
  .object({
    group: providerGroupDataSchema.nullable().optional(),
    logo: providerLogoDataSchema.nullable().optional(),
    access: providerAccessDataSchema.nullable().optional(),
    api: providerApiDataSchema.nullable().optional(),
    builtinModelIds: modelIdsDataSchema,
    personalModelIds: modelIdsDataSchema,
    modelOrder: modelIdsDataSchema,
    visibility: providerVisibilityDataSchema.nullable().optional(),
    // XCode fork：从上游拉取模型列表时仅保留 ID 匹配该正则片段的模型（不区分大小写）。
    // 缺省不过滤；正则非法时按未配置处理（拉取失败 open 比静默空列表更可诊断）。
    upstreamModelIdFilter: z.string().min(1).nullable().optional(),
    // XCode fork：上游请求画像。opencode-free-tier = OpenCode 免费档：
    // 请求体注入 bash/glob/grep/read 指纹工具并强制 stream（chat 通道）/
    // store:false（responses 通道），配合 api.headers 里的静态客户端头
    // （UA、x-opencode-client、x-opencode-session/request/project）。
    // 注意：free 档的「free tier can only be used from within OpenCode」闸门
    // 判定的是真实 OpenCode 会话，不能用伪造 header 绕过；用户必须用官方
    // OpenCode CLI 登录并把会话 token 填进 provider apiKey，SDK 才会上行
    // Authorization: Bearer <token>（所以 api.headers 里不要硬编码 Authorization，
    // 否则会按 SDK 头合并优先级遮蔽用户 token）。指纹+stream 是请求体侧必需契约。
    requestProfile: z.enum(["opencode-free-tier", "codebuddy", "qoder"]).nullable().optional(),
    // XCode fork：供应商级模型展示元数据（可读名/倍率/上下文档位/思考档位），
    // 「从上游获取」时写入。历史上存成 api.headers["X-Qoder-Model-Meta"]（JSON
    // 字符串），会随请求发往上游（越界指纹），且把 headers 变成强耦合通道；
    // provider_config.json schemaVersion 1→2 迁移把它提升到这里。
    // 刻意只验「是张表」、条目内容不校验——字段纯粹服务展示，坏条目由读取端
    // 归一化丢弃，绝不能让整层 personal 配置加载失败（headers 方案当年就是
    // 为了绕开 strict 校验才借道的）。
    modelMeta: z.record(z.string().min(1), z.unknown()).readonly().nullable().optional(),
  })
  .strict();
export const completeProviderConfigDataSchema = providerConfigDataSchema.extend({
  group: providerGroupDataSchema,
  access: completeProviderAccessDataSchema,
  api: completeProviderApiDataSchema,
});

export const providerTemplateNameMapDataSchema = z
  .object({
    "zh-CN": z.string().min(1).optional(),
    "en-US": z.string().min(1).optional(),
  })
  .strict();
export const providerTemplateDataSchema = z
  .object({
    templateId: z.string().min(1),
    templateNameMap: providerTemplateNameMapDataSchema,
    config: providerConfigDataSchema,
  })
  .strict();
