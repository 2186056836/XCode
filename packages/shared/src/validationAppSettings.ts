/* oxlint-disable eslint(max-lines) -- AppSettings schema 聚合历史迁移、默认值和 patch 校验，拆分会削弱设置迁移的单一入口。 */
import { z } from "zod";
import type { AppSettings } from "./protocol.js";
import { REMOTE_ASSET_INSTALL_MODES } from "./remoteAssetInstallMode.js";
import { isKnownRemoteResourcePackageId } from "./remoteResourcePackages.js";
import { wslUserSchema } from "./wslUserValidation.js";
import { normalizeXCodeEndpointOrigin } from "./zcodeEndpoint.js";
import {
  DEFAULT_EMBEDDED_BROWSER_VIEWPORT_PREFERENCE,
  embeddedBrowserViewportPreferenceSchema,
} from "./browser-use/command-metadata.js";
import { providerFamilyConnectionSelectionSettingsSchema } from "./provider-family-connection-selection.js";

/** 引导职业枚举；单独导出供 onboarding 记录回填 settings 时做窄化校验。 */
const appSettingsOccupationSchema = z.enum([
  "office",
  "developer",
  "independent",
  "infrastructure",
  "product",
  "design",
  "student",
  "creator",
  "operations",
  "marketing",
  "finance",
  "accounting",
  "legal",
  "other",
]);
export const appSettingsOccupationEnum = appSettingsOccupationSchema;

const nonEmptyStringSchema = z.string().trim().min(1);

export const localeSchema = z.enum(["zh-CN", "en-US"]);
const localePreferenceSchema = z.enum(["system", "zh-CN", "en-US"]);
const zcodeInteractionBehaviorSchema = z.enum(["queue", "guide"]);
const electronReleaseChannelSchema = z.enum(["stable", "preview"]);
const desktopZoomLevelSchema = z.number().int().min(-3).max(5);
const desktopWindowSizeSchema = z.object({
  width: z.number().int().min(480),
  height: z.number().int().min(640),
  maximized: z.boolean(),
});
export const integratedTerminalShellSelectionSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("auto"),
  }),
  z.object({
    mode: z.literal("shell"),
    dialect: z.enum(["cmd", "git-bash"]),
    id: nonEmptyStringSchema,
    label: nonEmptyStringSchema,
    path: nonEmptyStringSchema,
  }),
]);
const providerFamilyDomainSchema = z.enum(["zai", "bigmodel"]);

export const postUpdateReleaseNotesPayloadSchema = z.object({
  version: nonEmptyStringSchema,
  title: nonEmptyStringSchema,
  markdown: nonEmptyStringSchema,
  releaseDate: nonEmptyStringSchema.optional(),
  releaseNotesByLocale: z
    .partialRecord(
      localeSchema,
      z.object({ title: nonEmptyStringSchema, markdown: nonEmptyStringSchema }),
    )
    .optional(),
});

const skippedElectronUpdateVersionsSchema = z
  .partialRecord(electronReleaseChannelSchema, nonEmptyStringSchema)
  .default({});

const remoteWorkspaceTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ssh"),
    host: nonEmptyStringSchema,
    port: z.number().int().positive().max(65535).optional(),
    username: nonEmptyStringSchema,
    sshConfigAlias: nonEmptyStringSchema.optional(),
    privateKeyPath: z.string().optional(),
    assetInstallMode: z.enum(REMOTE_ASSET_INSTALL_MODES).optional(),
    resourcePackages: z
      .object({
        selectedPackageIds: z.array(z.string().refine(isKnownRemoteResourcePackageId)).optional(),
      })
      .optional(),
    passwordCredentialKey: nonEmptyStringSchema.optional(),
    privateKeyPassphraseCredentialKey: nonEmptyStringSchema.optional(),
  }),
  z.object({
    kind: z.literal("wsl"),
    distro: z.string().optional(),
    // 远程历史重连会直接使用 settings 中的 WSL user，必须和连接入口共用校验，避免绕过 UI 后污染 identity/日志。
    user: wslUserSchema.optional(),
  }),
  z.object({
    kind: z.literal("docker"),
    container: nonEmptyStringSchema,
  }),
]);

const appWorkspaceSessionEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("local"),
    workspacePath: nonEmptyStringSchema,
    workspacePurpose: z.enum(["project", "conversation"]).default("project"),
  }),
  z.object({
    kind: z.literal("remote"),
    workspacePath: nonEmptyStringSchema,
    localWorkspacePath: nonEmptyStringSchema.optional(),
    workspaceIdentity: nonEmptyStringSchema.optional(),
    target: remoteWorkspaceTargetSchema,
    lastOpenedAt: z.number().int().nonnegative(),
    lastConnectionStatus: z.enum(["connected", "failed"]),
    lastConnectionError: z.string().optional(),
  }),
]);

const zcodeEndpointOriginSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return normalizeXCodeEndpointOrigin(trimmed);
  } catch {
    return undefined;
  }
}, z.string().optional());

function sanitizeXCodeEndpointOrigin(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const raw = value as Record<string, unknown>;
  if (!("zcodeEndpointOrigin" in raw)) {
    return value;
  }
  const parsed = zcodeEndpointOriginSchema.safeParse(raw.zcodeEndpointOrigin);
  if (parsed.success && typeof parsed.data === "string") {
    return { ...raw, zcodeEndpointOrigin: parsed.data };
  }
  const { zcodeEndpointOrigin: _zcodeEndpointOrigin, ...next } = raw;
  // 非生产 endpoint override 是开发辅助字段，坏值只丢弃该字段，不能拖垮整个 settings 读取。
  return next;
}

function sanitizeDesktopWindowSize(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const raw = value as Record<string, unknown>;
  if (!("desktopWindowSize" in raw)) {
    return value;
  }
  const parsed = desktopWindowSizeSchema.safeParse(raw.desktopWindowSize);
  if (parsed.success) {
    return value;
  }
  const { desktopWindowSize: _desktopWindowSize, ...next } = raw;
  // 窗口尺寸是非关键偏好，坏值若参与整份 schema 校验，会让其他合法设置全部回退默认。
  // 读取历史设置时只丢弃损坏字段；写入 patch 仍保持严格校验，避免继续产生坏数据。
  return next;
}

function sanitizeEmbeddedBrowserViewportPreference(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const raw = value as Record<string, unknown>;
  if (!("embeddedBrowserViewportPreference" in raw)) {
    return value;
  }
  const parsed = embeddedBrowserViewportPreferenceSchema.safeParse(
    raw.embeddedBrowserViewportPreference,
  );
  if (parsed.success) {
    return value;
  }
  const { embeddedBrowserViewportPreference: _embeddedBrowserViewportPreference, ...next } = raw;
  // 显示偏好不是关键启动状态，单字段损坏不应让整份 setting.json 被隔离。
  // 读取时只丢弃坏偏好并回到默认值；patch 写入仍严格拒绝非法尺寸与缩放。
  return next;
}

function migrateCloseToTrayOnWindowsDefault(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const raw = value as Record<string, unknown>;
  if (raw.closeToTrayOnWindowsMigrationInitialized === true) {
    return value;
  }
  return {
    ...raw,
    // 初始化原因：旧版会把默认 false 和用户手动关闭都保存成同一个值，无法可靠区分。
    // 本版本统一开启一次；写入迁移标记后，后续再按用户明确选择保留 true/false。
    closeToTrayOnWindows: true,
    closeToTrayOnWindowsMigrationInitialized: true,
  };
}

function migrateMessageStreamShowReasoningDefault(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const raw = value as Record<string, unknown>;
  if (raw.messageStreamShowReasoningMigrationInitialized === true) {
    return value;
  }
  return {
    ...raw,
    // 初始化原因：旧版会把默认 false 和用户手动关闭都保存成同一个值，无法可靠区分。
    // 本版本统一开启一次；写入迁移标记后，后续再按用户明确选择保留 true/false。
    messageStreamShowReasoning: true,
    messageStreamShowReasoningMigrationInitialized: true,
  };
}

function migrateLegacyLocalePreference(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const raw = value as Record<string, unknown>;
  if ("localePreference" in raw || !("locale" in raw)) {
    return value;
  }

  const parsedLocale = localeSchema.safeParse(raw.locale);
  if (!parsedLocale.success) {
    return value;
  }

  return {
    ...raw,
    // 旧 setting.json 只有 locale，无法区分“用户显式选择 zh-CN”和“默认值 zh-CN”。
    // 对已经落盘的旧配置保留原 locale 作为显式偏好，避免升级后误切到 system。
    localePreference: parsedLocale.data,
  };
}

const legacyRemoteWorkspaceHistoryEntrySchema = z.object({
  id: nonEmptyStringSchema,
  workspacePath: nonEmptyStringSchema,
  localWorkspacePath: nonEmptyStringSchema.optional(),
  workspaceIdentity: nonEmptyStringSchema.optional(),
  target: remoteWorkspaceTargetSchema,
  lastOpenedAt: z.number().int().nonnegative(),
  lastConnectionStatus: z.enum(["connected", "failed"]),
  lastConnectionError: z.string().optional(),
});

function stripHistoricalRemoteResourcePackages(target: unknown): unknown {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    return target;
  }

  const rawTarget = target as Record<string, unknown>;
  if (rawTarget.kind !== "ssh" || !("resourcePackages" in rawTarget)) {
    return target;
  }

  const { resourcePackages: _resourcePackages, ...nextTarget } = rawTarget;
  // SSH 部署固定使用完整 active 资源集；旧 setting.json 里的 resourcePackages 是历史裁剪，
  // 在配置入口清掉，避免后续重连或 tab 恢复继续读取。
  return nextTarget;
}

function migrateLegacyWorkspaceSession(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const raw = value as {
    lastOpenTabs?: unknown;
    lastWorkspaceSession?: unknown;
    remoteWorkspaceHistory?: unknown;
  };
  const migrated = { ...raw } as Record<string, unknown>;
  const lastWorkspaceSession = Array.isArray(raw.lastWorkspaceSession)
    ? raw.lastWorkspaceSession
    : [];

  const hasLegacyRemoteEntries = lastWorkspaceSession.some((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return false;
    }
    return "historyId" in (entry as Record<string, unknown>);
  });

  const legacyRemoteHistory = Array.isArray(raw.remoteWorkspaceHistory)
    ? raw.remoteWorkspaceHistory
    : [];
  const legacyRemoteHistoryById = new Map(
    legacyRemoteHistory.flatMap((entry) => {
      const sanitizedEntry =
        entry && typeof entry === "object" && !Array.isArray(entry)
          ? {
              ...(entry as Record<string, unknown>),
              // 更老的 remoteWorkspaceHistory 可能保存了已退役资源包 ID。
              // 先剥离历史选择再走 schema，避免迁移阶段误删整条远程历史。
              target: stripHistoricalRemoteResourcePackages(
                (entry as Record<string, unknown>).target,
              ),
            }
          : entry;
      const parsed = legacyRemoteWorkspaceHistoryEntrySchema.safeParse(sanitizedEntry);
      return parsed.success ? [[parsed.data.id, parsed.data] as const] : [];
    }),
  );

  const migratedWorkspaceSessionEntries: Record<string, unknown>[] =
    lastWorkspaceSession.length > 0
      ? lastWorkspaceSession.flatMap((entry): Record<string, unknown>[] => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return [];
          }

          const rawEntry = entry as Record<string, unknown>;
          if (rawEntry.kind === "local" && typeof rawEntry.workspacePath === "string") {
            return [
              {
                kind: "local",
                workspacePath: rawEntry.workspacePath,
                workspacePurpose:
                  rawEntry.workspacePurpose === "conversation" ? "conversation" : "project",
              },
            ];
          }

          if (rawEntry.kind === "remote") {
            if (typeof rawEntry.workspacePath === "string" && rawEntry.target) {
              return [
                {
                  ...rawEntry,
                  target: stripHistoricalRemoteResourcePackages(rawEntry.target),
                },
              ];
            }

            if (typeof rawEntry.historyId === "string") {
              const legacyRemoteEntry = legacyRemoteHistoryById.get(rawEntry.historyId);
              return legacyRemoteEntry
                ? [
                    {
                      kind: "remote",
                      workspacePath: legacyRemoteEntry.workspacePath,
                      ...(legacyRemoteEntry.localWorkspacePath
                        ? { localWorkspacePath: legacyRemoteEntry.localWorkspacePath }
                        : {}),
                      ...(legacyRemoteEntry.workspaceIdentity
                        ? { workspaceIdentity: legacyRemoteEntry.workspaceIdentity }
                        : {}),
                      target: stripHistoricalRemoteResourcePackages(legacyRemoteEntry.target),
                      lastOpenedAt: legacyRemoteEntry.lastOpenedAt,
                      lastConnectionStatus: legacyRemoteEntry.lastConnectionStatus,
                      ...(legacyRemoteEntry.lastConnectionError
                        ? { lastConnectionError: legacyRemoteEntry.lastConnectionError }
                        : {}),
                    },
                  ]
                : [];
            }
          }

          return [];
        })
      : [];
  const migratedLegacyLocalEntries = Array.isArray(raw.lastOpenTabs)
    ? raw.lastOpenTabs.flatMap((workspacePath) =>
        typeof workspacePath === "string"
          ? [
              {
                kind: "local" as const,
                workspacePath,
                workspacePurpose: "project" as const,
              },
            ]
          : [],
      )
    : [];
  const existingLocalWorkspacePaths = new Set(
    migratedWorkspaceSessionEntries.flatMap((entry) =>
      entry.kind === "local" && typeof entry.workspacePath === "string"
        ? [entry.workspacePath]
        : [],
    ),
  );
  const nextWorkspaceSession = [
    ...migratedWorkspaceSessionEntries,
    ...migratedLegacyLocalEntries.filter(
      (entry) => !existingLocalWorkspacePaths.has(entry.workspacePath),
    ),
  ];

  // 旧 setting.json 把本地会话、远端历史、组合会话拆在三处存，
  // 一旦只删掉其中一处，启动恢复就会出现“列表还在但恢复不到”或“远端数据残留”的分叉状态。
  // 这里在 schema 解析阶段统一合并进 lastWorkspaceSession，并主动移除旧字段，
  // 保证后续所有读写都只围绕单一真相源展开。
  if (
    nextWorkspaceSession.length > 0 ||
    hasLegacyRemoteEntries ||
    Array.isArray(raw.lastOpenTabs)
  ) {
    migrated.lastWorkspaceSession = nextWorkspaceSession;
  }
  delete migrated.lastOpenTabs;
  delete migrated.remoteWorkspaceHistory;
  return migrated;
}

/**
 * XCode fork：模型越狱（godmode）设置。
 * - cliPrefix：自定义 system 消息替换内容（仅第 1 条产品身份消息），上限 65535，空串视同未设置。
 * - prefill：priming 对话轮（对齐 Hermes prefill_messages），最多 20 条。
 * - obfuscation：Parseltongue 输入混淆开关/档位。
 */
export const modelJailbreakPrefillMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(8192),
});

export const modelJailbreakPrefillSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  messages: z.array(modelJailbreakPrefillMessageSchema).max(20).optional(),
});

export const modelJailbreakObfuscationTierSchema = z.enum(["light", "standard", "heavy"]);

export const modelJailbreakObfuscationSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  tier: modelJailbreakObfuscationTierSchema.optional(),
});

export const customSystemMessagesSchema = z.object({
  cliPrefix: z.string().max(65535).optional(),
  prefill: modelJailbreakPrefillSettingsSchema.optional(),
  obfuscation: modelJailbreakObfuscationSettingsSchema.optional(),
});

/**
 * 背景图 data URL 的字符上限，与 customSkinSchema 的 max 同源。
 * 注意这是 base64 编码后的长度：编码会比原文件膨胀约 4/3，所以按原文件大小
 * 做预检会放行 7.5MB 以上的图、保存时才被 Zod 打回来（用户只看到"保存失败"）。
 * 手动选图的预检和主题包导入拦截都必须用编码后的长度对齐这个值。
 */
export const MAX_SKIN_BACKGROUND_IMAGE_CHARS = 10 * 1024 * 1024;

/**
 * 皮肤 Safe CSS 的字符上限。Codex Studio 的 dreamskin-safe-css/1 合约给 256KB，
 * 这里收紧到 64KB：我们的 safeCss 存在 setting.json 里，每次读写都要过 JSON，
 * 且只允许白名单内的 part/变量/属性，正常皮肤远达不到这个量级。
 */
export const MAX_SKIN_SAFE_CSS_CHARS = 64 * 1024;

/**
 * XCode fork：原生换肤——用户自定义皮肤覆盖层。
 * base 决定底座主题 token 块；overrides 在运行时以内联 CSS variables 盖在
 * .theme-zai-* 块之上（内联 style 天然优先），全 UI 语义 token 自动跟随。
 * backgroundImage 为 base64 data URL（上限见 MAX_SKIN_BACKGROUND_IMAGE_CHARS）。
 *
 * image/surface 两组是 Skin Studio 的构图与表面参数：此前这些值是引擎硬编码
 * （侧栏 50% 不透面、表面 80%、圆角/边框/阴影全走底座），用户想微调只能改代码。
 * 现在提升为皮肤的一部分，全部可选，缺省值即旧行为，老皮肤零迁移。
 */
export const customSkinSchema = z.object({
  base: z.enum(["zai-dark", "zai-light"]),
  overrides: z
    .object({
      background: z.string().max(64).optional(),
      backgroundWinAlt: z.string().max(64).optional(),
      surface: z.string().max(64).optional(),
      card: z.string().max(64).optional(),
      panel: z.string().max(64).optional(),
      sidebar: z.string().max(64).optional(),
      popover: z.string().max(64).optional(),
      input: z.string().max(64).optional(),
      border: z.string().max(64).optional(),
      accent: z.string().max(64).optional(),
      brand: z.string().max(64).optional(),
      // ── Skin Studio 调色板扩充（对齐 DreamSkin theme.json 的 10 色）──
      text: z.string().max(64).optional(),
      muted: z.string().max(64).optional(),
      line: z.string().max(64).optional(),
      highlight: z.string().max(64).optional(),
      secondary: z.string().max(64).optional(),
      panelAlt: z.string().max(64).optional(),
      accentAlt: z.string().max(64).optional(),
    })
    .optional(),
  backgroundImage: z.string().max(MAX_SKIN_BACKGROUND_IMAGE_CHARS).optional(),
  backgroundFocusX: z.number().min(0).max(1).optional(),
  backgroundFocusY: z.number().min(0).max(1).optional(),
  /** 背景图构图：缩放/压暗/安全区/任务区强度。 */
  image: z
    .object({
      /** 1 = cover 原始大小，3 = 放大 3 倍（裁切边缘）。 */
      zoom: z.number().min(1).max(3).optional(),
      /** 0-80：整图压暗百分比，让浅色 UI 在花图上也可读。 */
      dim: z.number().min(0).max(80).optional(),
      /** 哪一侧留给导航/列表，该侧加渐变过渡避免图抢内容。 */
      safeArea: z.enum(["left", "right", "none"]).optional(),
      /** 任务/对话区底图强度：ambient 低存在感 / full 全幅 / off 关闭。 */
      taskIntensity: z.enum(["ambient", "full", "off"]).optional(),
    })
    .optional(),
  /** 表面参数：不透明度/模糊/圆角/边框浓度/阴影。取代引擎里的硬编码值。 */
  surface: z
    .object({
      /** 0-100：侧栏与面板蒙版浓度。旧引擎固定 50。 */
      opacity: z.number().min(0).max(100).optional(),
      /** 0-40 px：面板 backdrop-filter 模糊。旧引擎为 0（用户要求去掉模糊）。 */
      blur: z.number().min(0).max(40).optional(),
      /** 0-24 px：卡片/面板圆角。 */
      radius: z.number().min(0).max(24).optional(),
      /** 0-100：卡片与面板边框 alpha 百分比。 */
      borderAlpha: z.number().min(0).max(100).optional(),
      /** 0-100：卡片/面板阴影强度。 */
      shadow: z.number().min(0).max(100).optional(),
    })
    .optional(),
  /** 高级 Safe CSS：白名单内的 part 规则，经 lint 后由引擎注入。 */
  safeCss: z.string().max(MAX_SKIN_SAFE_CSS_CHARS).optional(),
});
export type CustomSkinSettings = z.infer<typeof customSkinSchema>;

/** 皮肤表面参数缺省值 = 旧引擎硬编码值，保证老皮肤行为不变。 */
export const DEFAULT_SKIN_SURFACE = {
  opacity: 50,
  blur: 0,
  radius: 12,
  borderAlpha: 12,
  shadow: 0,
} as const;

/** 背景图构图缺省值。 */
export const DEFAULT_SKIN_IMAGE = {
  zoom: 1,
  dim: 0,
  safeArea: "none",
  taskIntensity: "ambient",
} as const;

/**
 * Safe CSS 白名单。逐条对齐 Codex 客户端仓库的 dreamskin-safe-css/1 合约
 * （源：dreamskin studio rebuilt/source-data/safe-css.policy.json，公仓
 * source/macos/assets/safe-css-validator.mjs 同源）。
 *
 * 12 个 part 全部登记：Codex 主题包的 theme.css 按这些 part 写规则，少一个
 * 就会在导入时被判为"未登记 part"而整段丢弃——miku v2 用了 home-hero /
 * project-list / thread，旧表只有 8 项，导入后这些面全部回落到引擎默认蒙层，
 * 表现为"背景图被洗白"。属性表同理：原表缺 border-*-color/width/style 与
 * border-*-radius，而 theme.css 的 sidebar 边框正好用 border-right-color。
 */
export const SKIN_SAFE_CSS_CONTRACT = "dreamskin-safe-css/1";
export const SKIN_SAFE_CSS_PARTS = [
  "root",
  "sidebar",
  "main",
  "header",
  "home",
  "home-hero",
  "project-list",
  "thread",
  "message",
  "composer",
  "composer-toolbar",
  "dialog",
] as const;
export const SKIN_SAFE_CSS_STATES = ["hover", "focus-visible"] as const;
export const SKIN_SAFE_CSS_PROPERTIES = [
  "backdrop-filter",
  "background-color",
  "border-bottom-color",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "border-bottom-style",
  "border-bottom-width",
  "border-color",
  "border-left-color",
  "border-left-style",
  "border-left-width",
  "border-radius",
  "border-right-color",
  "border-right-style",
  "border-right-width",
  "border-style",
  "border-top-color",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-top-style",
  "border-top-width",
  "border-width",
  "box-shadow",
  "color",
  "column-gap",
  "font-family",
  "font-size",
  "font-weight",
  "gap",
  "letter-spacing",
  "line-height",
  "opacity",
  "row-gap",
  "transition-duration",
  "transition-property",
] as const;

/**
 * Safe CSS 可引用的变量（Codex 合约同款 24 项）。Codex 客户端把这些变量定义在
 * 文档根上，主题包的 theme.css 再引用它们；我们不定义就等于让引用方拿到
 * invalid var()——background-color 会回落成 transparent，整面消失。
 * 颜色 10 项由皮肤 overrides 反推（见 useTheme 的 buildDreamSkinVariables），
 * 其余按 Codex 客户端缺省值常量定义。
 */
export const SKIN_SAFE_CSS_VARIABLES = [
  "--ds-theme-color-background",
  "--ds-theme-color-panel",
  "--ds-theme-color-panel-alt",
  "--ds-theme-color-accent",
  "--ds-theme-color-accent-alt",
  "--ds-theme-color-secondary",
  "--ds-theme-color-highlight",
  "--ds-theme-color-text",
  "--ds-theme-color-muted",
  "--ds-theme-color-line",
  "--ds-theme-font-family",
  "--ds-theme-font-scale",
  "--ds-theme-surface-opacity",
  "--ds-theme-surface-blur",
  "--ds-theme-surface-radius",
  "--ds-theme-surface-border-alpha",
  "--ds-theme-surface-shadow",
  "--ds-theme-image-focus-x",
  "--ds-theme-image-focus-y",
  "--ds-theme-image-zoom",
  "--ds-theme-image-dim",
  "--ds-theme-image-task-intensity",
  "--ds-theme-density-scale",
  "--ds-theme-motion-level",
] as const;

/** Codex 客户端对非颜色 ds-theme 变量的缺省值（Studio 控件表 pp 的 default 列）。 */
export const DEFAULT_DREAM_SKIN_VARS: Record<string, string> = {
  "--ds-theme-font-family": "system",
  "--ds-theme-font-scale": "1",
  "--ds-theme-surface-opacity": "1",
  "--ds-theme-surface-blur": "0px",
  "--ds-theme-surface-radius": "12px",
  "--ds-theme-surface-border-alpha": "0.14",
  "--ds-theme-surface-shadow": "soft",
  "--ds-theme-image-focus-x": "0.5",
  "--ds-theme-image-focus-y": "0.5",
  "--ds-theme-image-zoom": "1",
  "--ds-theme-image-dim": "0",
  "--ds-theme-image-task-intensity": "0.35",
  "--ds-theme-density-scale": "standard",
  "--ds-theme-motion-level": "standard",
};

/**
 * DreamSkin theme.json 的 10 色 → 皮肤 overrides 字段。
 * Codex 客户端把 theme.json.colors 原样写进 --ds-theme-color-*（含 alpha，
 * alpha 是主题设计的一部分），所以这里必须原样搬运、不做任何混合。
 */
export const DREAM_SKIN_COLOR_TO_OVERRIDE = {
  background: "background",
  panel: "panel",
  panelAlt: "panelAlt",
  accent: "accent",
  accentAlt: "accentAlt",
  secondary: "secondary",
  highlight: "highlight",
  text: "text",
  muted: "muted",
  line: "line",
} as const;


const appSettingsObjectSchema = z.object({
  recentProjects: z.array(z.string()).default([]),
  locale: localeSchema.default("zh-CN"),
  // 快捷键用户覆盖（语义校验在 ui/src/shortcuts 生效表阶段容错，schema 只管形状）
  shortcutBindings: z.record(z.string(), z.array(z.string())).optional(),
  localePreference: localePreferenceSchema.default("system"),
  terminalInheritSystemProfile: z.boolean().default(true),
  terminalFontFamily: nonEmptyStringSchema.optional(),
  integratedTerminalShell: integratedTerminalShellSelectionSchema.optional(),
  httpProxy: nonEmptyStringSchema.optional(),
  httpProxyNoProxy: nonEmptyStringSchema.optional(),
  httpProxyCaCertPath: nonEmptyStringSchema.optional(),
  embeddedBrowserAllowInsecureCertificates: z.boolean().default(false),
  embeddedBrowserViewportPreference: embeddedBrowserViewportPreferenceSchema.default(
    DEFAULT_EMBEDDED_BROWSER_VIEWPORT_PREFERENCE,
  ),
  // 输入框电脑操作入口改为默认不展示，设置项保留、默认关闭。
  // default 只对缺省字段生效，显式存过 false 的用户仍保持展示。
  computerUseComposerEntryHidden: z.boolean().default(true),
  taskAutoArchiveEnabled: z.boolean().default(false),
  taskAutoArchiveOlderThanDays: z.number().int().positive().max(365).default(7),
  closeToTrayOnWindows: z.boolean().default(true),
  closeToTrayOnWindowsMigrationInitialized: z.boolean().default(true),
  keepAwakeWhileRunning: z.boolean().default(false),
  desktopZoomLevel: desktopZoomLevelSchema.optional(),
  desktopWindowSize: desktopWindowSizeSchema.optional(),
  desktopChromiumHardwareAccelerationEnabled: z.boolean().default(true),
  messageStreamShowReasoning: z.boolean().default(true),
  messageStreamShowReasoningMigrationInitialized: z.boolean().default(true),
  messageStreamShowTodos: z.boolean().default(false),
  toolGroupingExploreEnabled: z.boolean().default(true),
  toolGroupingTerminalEnabled: z.boolean().default(true),
  toolGroupingChangesEnabled: z.boolean().default(false),
  zcodeInteractionBehavior: zcodeInteractionBehaviorSchema.default("queue"),
  askUserQuestionAutoResolutionEnabled: z.boolean().default(true),
  modelIoFullRetentionEnabled: z.boolean().default(false),
  startPlanRecommendationDismissed: z.boolean().default(false),
  providerFamilyConnectionSelections: providerFamilyConnectionSelectionSettingsSchema.default({}),
  providerFamilyDomain: providerFamilyDomainSchema.optional(),
  providerFamilyDomainUpdatedAt: z.number().int().nonnegative().optional(),
  providerFamilyDomainMigrated: z.boolean().default(false),
  nativeSearchEnhancementsEnabled: z.boolean().default(true),
  onboardingOccupation: appSettingsOccupationSchema.nullish(),
  proactiveSuggestionsEnabled: z.boolean().optional(),
  memoryEnabled: z.boolean().default(false),
  lastWorkspaceSession: z.array(appWorkspaceSessionEntrySchema).default([]),
  lastActiveTabIndex: z.number().int().nonnegative().default(0),
  lastActiveTaskByWorkspace: z.record(z.string(), z.string()).optional(),
  dataBaseDir: z.string().trim().min(1).optional(),
  pendingPostUpdateReleaseNotes: postUpdateReleaseNotesPayloadSchema.optional(),
  receivePreviewUpdates: z.boolean().default(false),
  autoDownloadAndInstallUpdates: z.boolean().default(false),
  skippedElectronUpdateVersions: skippedElectronUpdateVersionsSchema,
  settingsSyncFirstRunPromptHandled: z.boolean().optional(),
  zcodeEndpointOrigin: zcodeEndpointOriginSchema.optional(),
  customSystemMessages: customSystemMessagesSchema.optional(),
  // null = 显式移除皮肤、回退官方主题（RPC/JSON 会吞 undefined，清空必须走 null）。
  customSkin: customSkinSchema.nullable().optional(),
});

export const appSettingsSchema = z.preprocess(
  (value) =>
    sanitizeEmbeddedBrowserViewportPreference(
      sanitizeDesktopWindowSize(
        migrateMessageStreamShowReasoningDefault(
          migrateCloseToTrayOnWindowsDefault(
            migrateLegacyLocalePreference(
              sanitizeXCodeEndpointOrigin(migrateLegacyWorkspaceSession(value)),
            ),
          ),
        ),
      ),
    ),
  appSettingsObjectSchema,
);

export const appSettingsPatchSchema = z.object({
  recentProjects: z.array(z.string()).optional(),
  locale: localeSchema.optional(),
  shortcutBindings: z.record(z.string(), z.array(z.string())).optional(),
  localePreference: localePreferenceSchema.optional(),
  terminalInheritSystemProfile: z.boolean().optional(),
  terminalFontFamily: nonEmptyStringSchema.optional(),
  integratedTerminalShell: integratedTerminalShellSelectionSchema.optional(),
  httpProxy: nonEmptyStringSchema.optional(),
  httpProxyNoProxy: nonEmptyStringSchema.optional(),
  httpProxyCaCertPath: nonEmptyStringSchema.optional(),
  embeddedBrowserAllowInsecureCertificates: z.boolean().optional(),
  embeddedBrowserViewportPreference: embeddedBrowserViewportPreferenceSchema.optional(),
  computerUseComposerEntryHidden: z.boolean().optional(),
  taskAutoArchiveEnabled: z.boolean().optional(),
  taskAutoArchiveOlderThanDays: z.number().int().positive().max(365).optional(),
  closeToTrayOnWindows: z.boolean().optional(),
  keepAwakeWhileRunning: z.boolean().optional(),
  closeToTrayOnWindowsMigrationInitialized: z.boolean().optional(),
  desktopZoomLevel: desktopZoomLevelSchema.optional(),
  desktopWindowSize: desktopWindowSizeSchema.optional(),
  desktopChromiumHardwareAccelerationEnabled: z.boolean().optional(),
  messageStreamShowReasoning: z.boolean().optional(),
  messageStreamShowReasoningMigrationInitialized: z.boolean().optional(),
  messageStreamShowTodos: z.boolean().optional(),
  toolGroupingExploreEnabled: z.boolean().optional(),
  toolGroupingTerminalEnabled: z.boolean().optional(),
  toolGroupingChangesEnabled: z.boolean().optional(),
  zcodeInteractionBehavior: zcodeInteractionBehaviorSchema.optional(),
  askUserQuestionAutoResolutionEnabled: z.boolean().optional(),
  modelIoFullRetentionEnabled: z.boolean().optional(),
  startPlanRecommendationDismissed: z.boolean().optional(),
  providerFamilyConnectionSelections: providerFamilyConnectionSelectionSettingsSchema.optional(),
  providerFamilyDomain: z.union([providerFamilyDomainSchema, z.literal("")]).optional(),
  providerFamilyDomainUpdatedAt: z.number().int().nonnegative().optional(),
  providerFamilyDomainMigrated: z.boolean().optional(),
  nativeSearchEnhancementsEnabled: z.boolean().optional(),
  onboardingOccupation: z
    .enum([
      "office",
      "developer",
      "independent",
      "infrastructure",
      "product",
      "design",
      "student",
      "creator",
      "operations",
      "marketing",
      "finance",
      "accounting",
      "legal",
      "other",
    ])
    .nullish(),
  proactiveSuggestionsEnabled: z.boolean().optional(),
  memoryEnabled: z.boolean().optional(),
  lastWorkspaceSession: z.array(appWorkspaceSessionEntrySchema).optional(),
  lastActiveTabIndex: z.number().int().nonnegative().optional(),
  lastActiveTaskByWorkspace: z.record(z.string(), z.string()).optional(),
  dataBaseDir: z.string().trim().min(1).optional(),
  pendingPostUpdateReleaseNotes: postUpdateReleaseNotesPayloadSchema.optional(),
  receivePreviewUpdates: z.boolean().optional(),
  autoDownloadAndInstallUpdates: z.boolean().optional(),
  skippedElectronUpdateVersions: z
    .partialRecord(electronReleaseChannelSchema, nonEmptyStringSchema)
    .optional(),
  settingsSyncFirstRunPromptHandled: z.boolean().optional(),
  zcodeEndpointOrigin: zcodeEndpointOriginSchema.optional(),
  customSystemMessages: customSystemMessagesSchema.optional(),
  // null = 显式移除皮肤、回退官方主题（RPC/JSON 会吞 undefined，清空必须走 null）。
  customSkin: customSkinSchema.nullable().optional(),
});
