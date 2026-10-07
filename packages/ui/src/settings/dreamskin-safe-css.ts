/**
 * DreamSkin Safe CSS 白名单校验（dreamskin-safe-css/1）。
 *
 * 一份实现两处消费：皮肤工坊的 CSS 面板（用户手写）和 DreamSkin 主题包导入
 * （theme.css 原文）。规则表在 @zcode/shared 的 SKIN_SAFE_CSS_*，逐条对齐
 * Codex 客户端仓库的同名合约，所以 Codex 产出的 theme.css 在这里必须零告警——
 * 白名单缺项不会让导入失败，只会让主题丢面（见 dreamskin-import 的降级说明）。
 *
 * 安全边界只卡两件事，其余放行：
 *   url() —— 唯一的外联/跟踪向量，一律拒绝；
 *   @ 规则 —— import/charset/namespace/media/supports/keyframes/font-face 一律拒绝。
 * 属性白名单里没有任何能改变布局或加载资源的属性（无 position/filter/transform/
 * background-image/content），所以即使漏放行一条也只会影响观感。
 */

import {
  SKIN_SAFE_CSS_PARTS,
  SKIN_SAFE_CSS_PROPERTIES,
  SKIN_SAFE_CSS_VARIABLES,
} from "@zcode/shared";

export interface SafeCssIssue {
  line: number;
  message: string;
}

const URL_RE = /url\s*\(/i;
const AT_RULE_RE = /@(import|charset|namespace|media|supports|keyframes|font-face)\b/i;
const VAR_RE = /var\(\s*(--[a-z0-9-]+)/gi;
const PART_RE = /\[data-ds-part[~^|*$]?=["']?([a-z-]+)["']?\]/gi;
const ALLOWED_PARTS = new Set<string>(SKIN_SAFE_CSS_PARTS);
const ALLOWED_PROPERTIES = new Set<string>(SKIN_SAFE_CSS_PROPERTIES);
const ALLOWED_VARIABLES = new Set<string>(SKIN_SAFE_CSS_VARIABLES);

/** 对工坊里的高级 CSS 做白名单校验；返回空数组即通过。 */
export function lintSkinSafeCss(css: string): SafeCssIssue[] {
  const issues: SafeCssIssue[] = [];
  const lines = css.split("\n");
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("/*")) return;
    if (URL_RE.test(line)) {
      issues.push({ line: lineNo, message: "url() reference is not allowed" });
    }
    const at = AT_RULE_RE.exec(line);
    if (at?.[1]) {
      issues.push({ line: lineNo, message: `@${at[1]} is not allowed` });
    }
    for (const m of line.matchAll(VAR_RE)) {
      const name = m[1];
      if (name && !ALLOWED_VARIABLES.has(name)) {
        issues.push({ line: lineNo, message: `unknown variable ${name}` });
      }
    }
    // 选择器行（含 { 但不是声明）里出现的 data-ds-part 必须在登记表内
    if (trimmed.includes("{") && !trimmed.includes(":")) {
      for (const m of line.matchAll(PART_RE)) {
        const part = m[1];
        if (part && !ALLOWED_PARTS.has(part)) {
          issues.push({ line: lineNo, message: `unregistered part ${part}` });
        }
      }
    }
  });
  // 声明属性白名单
  const declRe = /([a-z-]+)\s*:/g;
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("/*") || trimmed.includes("{")) return;
    for (const m of line.matchAll(declRe)) {
      const prop = m[1];
      if (!prop) continue;
      if (prop.startsWith("--")) continue;
      if (!ALLOWED_PROPERTIES.has(prop)) {
        issues.push({
          line: index + 1,
          message: `property ${prop} is not in the safe list`,
        });
      }
    }
  });
  return issues;
}

/**
 * 只保留会真正造成安全影响的问题：url() 与 @ 规则。
 * 导入侧用它判断"这段 theme.css 能不能注入"，属性和 part 的白名单偏差只记录不拦截
 * ——Codex 自己的校验器已经放行过这份 CSS，我们因为白名单缺项就整段丢掉，
 * 代价是皮肤直接退回默认蒙层（比放行一条背景色严重得多）。
 */
export function findUnsafeCssIssues(css: string): SafeCssIssue[] {
  return lintSkinSafeCss(css).filter(
    (issue) => issue.message.startsWith("url(") || issue.message.startsWith("@"),
  );
}
