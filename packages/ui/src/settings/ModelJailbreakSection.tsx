import { CustomSystemMessagesSetting } from "@/settings/CustomSystemMessagesSetting.js";
import { CustomPersonaTemplatesSetting } from "@/settings/CustomPersonaTemplatesSetting.js";
import { GodmodeTemplatePresets } from "@/settings/GodmodeTemplatePresets.js";
import { JailbreakPrefillSetting } from "@/settings/JailbreakPrefillSetting.js";
import { JailbreakObfuscationSetting } from "@/settings/JailbreakObfuscationSetting.js";

/**
 * 模型越狱设置页。
 *
 * 承载 godmode 越狱配置：
 * 1. Agent 提示词（更改 XCode 身份设定）——整段替换第 1 条 system 消息（链路：setting.json
 *    → session/requestRuntimePreferences → ContextBuilder，不因迁到这个页面而改变）。
 * 2. 全局 PreFill 预置对话——紧跟在提示词下方，提示词与预置对话成套编辑。
 * 3. GODMODE 系统提示词模板预设（快速套用到 cliPrefix）。
 * 4. 自定义身份模板（提示词 + PreFill 组合，用户可新建/编辑/删除）。
 * 5. Parseltongue 输入混淆（改写发给模型的 user 文本，UI 原文不变）。
 */
export function ModelJailbreakSection() {
  return (
    <>
      <CustomSystemMessagesSetting />
      <JailbreakPrefillSetting />
      <GodmodeTemplatePresets />
      <CustomPersonaTemplatesSetting />
      <JailbreakObfuscationSetting />
    </>
  );
}
