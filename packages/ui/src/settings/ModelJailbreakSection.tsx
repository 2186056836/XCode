import { CustomPersonaTemplatesSetting } from "@/settings/CustomPersonaTemplatesSetting.js";
import { GodmodeTemplatePresets } from "@/settings/GodmodeTemplatePresets.js";
import { JailbreakPrefillSetting } from "@/settings/JailbreakPrefillSetting.js";
import { JailbreakObfuscationSetting } from "@/settings/JailbreakObfuscationSetting.js";

/**
 * 模型越狱设置页。
 *
 * 承载 godmode 越狱配置，内容编辑全部收敛到身份模板：
 * 1. 内置身份模板（提示词 + PreFill 成套预设，「默认XCODE」在最前）。
 * 2. 自定义身份模板（用户自建的提示词 + PreFill 组合）。
 * 3. 全局 PreFill 开关（内容由上面两处模板写入，这里只控制是否注入）。
 * 4. Parseltongue 输入混淆（改写发给模型的 user 文本，UI 原文不变）。
 */
export function ModelJailbreakSection() {
  return (
    <>
      <GodmodeTemplatePresets />
      <CustomPersonaTemplatesSetting />
      <JailbreakPrefillSetting />
      <JailbreakObfuscationSetting />
    </>
  );
}
