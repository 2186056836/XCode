/**
 * GODMODE 身份模板（系统提示词 + 配套 PreFill）。
 *
 * **提示词本体在 `packages/shared/prompts/*.md`**，不要直接改这里：
 *   prompts/<id>.md            → 系统提示词（frontmatter: id/name/family/strategy）
 *   prompts/<id>.prefill.md    → 配套 PreFill（frontmatter: id/name；正文用 `## role` 分轮）
 *   prompts/default-prefill.md → 默认 PreFill
 *
 * 改完 md 执行 `pnpm --filter @zcode/shared generate:prompts` 重新生成
 * `src/godmode-templates/*.generated.ts`，再重建 agent bundle。
 * 生成物入库，运行时不读 md（UI 与 CLI 都直接 import 生成模块）。
 */

export interface GodmodeTemplate {
  id: string;
  name: string;
  /** 目标模型家族。 */
  family: string;
  /** 越狱策略名。 */
  strategy: string;
  /**
   * 内置模板的默认助手名字：应用模板时替换提示词 / PreFill 里的 `{{name}}`。
   * 设置页「编辑」会把它预填到「助手名字」输入框。
   */
  assistantName?: string;
  /** 整段 system 提示词，填入 cliPrefix。 */
  prompt: string;
}

export interface PrefillTemplateMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PrefillTemplate {
  id: string;
  name: string;
  messages: PrefillTemplateMessage[];
}

import { XCODE_DEFAULT_TEMPLATE } from "./godmode-templates/xcode-default.generated.js";
import { UNRESTRICTED_MODE_TEMPLATE } from "./godmode-templates/unrestricted-mode.generated.js";
import { REDTEAM_MODE_TEMPLATE } from "./godmode-templates/redteam-mode.generated.js";
import {
  XIAOHONG_CREATION_PREFILL,
  XIAOHONG_CREATION_TEMPLATE,
} from "./godmode-templates/xiaohong-creation.generated.js";
import { XIAOMEI_CTF_PREFILL, XIAOMEI_CTF_TEMPLATE } from "./godmode-templates/xiaomei-ctf.generated.js";
import {
  XIAOYU_SECURITY_PREFILL,
  XIAOYU_SECURITY_TEMPLATE,
} from "./godmode-templates/xiaoyu-security.generated.js";
import { GODMODE_DEFAULT_PREFILL as DEFAULT_PREFILL_TURNS } from "./godmode-templates/default-prefill.generated.js";
import { FUJIANG_TEMPLATE } from "./godmode-templates/fujiang.generated.js";

/**
 * 数组顺序即设置页/聊天选择器的展示顺序。
 * 「默认XCODE」放最前面，作为恢复官方身份文案的入口；「无限制模式」排第二、
 * 「红队模式」排第三（红队提示词在无限制模式基础上多了 CTF / 红队编排段）。
 */
export const GODMODE_TEMPLATES: GodmodeTemplate[] = [
  XCODE_DEFAULT_TEMPLATE,
  UNRESTRICTED_MODE_TEMPLATE,
  REDTEAM_MODE_TEMPLATE,
  XIAOMEI_CTF_TEMPLATE,
  XIAOYU_SECURITY_TEMPLATE,
  XIAOHONG_CREATION_TEMPLATE,
  FUJIANG_TEMPLATE,
];

/** godmode 默认 prefill 内容（对齐 prefill.json 的 priming turns）。 */
export const GODMODE_DEFAULT_PREFILL: PrefillTemplateMessage[] = [...DEFAULT_PREFILL_TURNS];

/**
 * PreFill 预置对话模板。
 *
 * 交互与系统提示词模板同构：下拉选一套 → 点「使用」→ 写入
 * `customSystemMessages.prefill`（同时自动开启）。
 * 只有带配套 `*.prefill.md` 的模板才会出现在这里（「默认XCODE」只提供提示词）。
 */
export const PREFILL_TEMPLATES: PrefillTemplate[] = [
  XIAOMEI_CTF_PREFILL,
  XIAOYU_SECURITY_PREFILL,
  XIAOHONG_CREATION_PREFILL,
];

/** Parseltongue 输入混淆档位说明（供 UI 使用）。 */
export const ObfuscationTierLabels: Record<"light" | "standard" | "heavy", string> = {
  light: "Light",
  standard: "Standard",
  heavy: "Heavy",
};
