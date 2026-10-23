// ============================================================
// Model Jailbreak Port - agent-side jailbreak configuration boundary
// ============================================================
// 与 ProxyPoolPort 兄弟并列：只放「agent 能读写的那部分配置面」的窄类型，
// 不 import services 的视图类型。
//
// 语义（与设置页「模型越狱」四块逐字一致）：
// - identityPrompt：整段替换发给模型的第 1 条 system 消息；null = 内置默认身份行；
// - templateId：GODMODE 预设，套用后其正文写入 identityPrompt；
// - prefill：system 之后、首个真实 user 之前的 priming turns；
// - obfuscation：改写发给模型的 user 文本（UI 原文不变）。
//
// 所有写操作都返回**改动后的完整状态**，模型不必再读一次。

import type {
  ModelJailbreakState,
  ModelJailbreakTemplateView,
} from "../tools/model-jailbreak.js";

export type {
  ModelJailbreakObfuscationView,
  ModelJailbreakPrefillMessage,
  ModelJailbreakPrefillView,
  ModelJailbreakState,
  ModelJailbreakTemplateView,
} from "../tools/model-jailbreak.js";

export interface ModelJailbreakSnapshot {
  state: ModelJailbreakState;
  /** 可用模板清单；只有 list 才填，写操作省略。 */
  templates?: ModelJailbreakTemplateView[];
}

export interface ModelJailbreakPort {
  /** 当前状态 + 可用模板清单。 */
  read(): Promise<ModelJailbreakSnapshot>;
  /** 设置身份提示词；空串或纯空白 = 清除自定义，回落内置默认。 */
  setIdentityPrompt(prompt: string): Promise<ModelJailbreakSnapshot>;
  /** 套用 GODMODE 模板；模板 id 必须是 read() 返回过的值。 */
  applyTemplate(templateId: string): Promise<ModelJailbreakSnapshot>;
  /** 设置 prefill；空数组 = 清除。 */
  setPrefill(messages: Array<{ role: "user" | "assistant"; content: string }>): Promise<ModelJailbreakSnapshot>;
  /** 设置 Parseltongue 输入混淆。 */
  setObfuscation(input: {
    enabled: boolean;
    tier?: "light" | "standard" | "heavy";
  }): Promise<ModelJailbreakSnapshot>;
}
