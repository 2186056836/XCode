import { CustomSystemMessagesSetting } from "@/settings/CustomSystemMessagesSetting.js";
import { GodmodeTemplatePresets } from "@/settings/GodmodeTemplatePresets.js";
import { JailbreakPrefillSetting } from "@/settings/JailbreakPrefillSetting.js";
import { JailbreakObfuscationSetting } from "@/settings/JailbreakObfuscationSetting.js";

/**
 * 模型越狱设置页。
 *
 * 承载 godmode 越狱配置：
 * 1. Agent 提示词（更改 XCode 身份设定）——整段替换第 1 条 system 消息（链路：setting.json
 *    → session/requestRuntimePreferences → ContextBuilder，不因迁到这个页面而改变）。
 * 2. GODMODE 系统提示词模板预设（快速套用到 cliPrefix）。
 * 3. Prefill（预置对话 / priming turns）——注入 system 之后、首个真实 user 之前。
 * 4. Parseltongue 输入混淆（改写发给模型的 user 文本，UI 原文不变）。
 */
export function ModelJailbreakSection() {
  return (
    <>
      <CustomSystemMessagesSetting />
      <GodmodeTemplatePresets />
      <JailbreakPrefillSetting />
      <JailbreakObfuscationSetting />
    </>
  );
}
