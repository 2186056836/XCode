/**
 * Parseltongue v4 — 输入混淆引擎（移植自 Hermes godmode skill 的 `scripts/parseltongue.py`）。
 *
 * 对用户 query 做文本混淆以绕过 LLM 输入侧安全分类器，按 tier 逐级增强：
 *   - light：leetspeak + 语义同义词 + 字符间距
 *   - standard：+ Unicode 同形字 + 每词反转 + 括号包裹
 *   - heavy：+ Base64 / Hex 多层级编码
 *
 * XCode 仅在 `customSystemMessages.obfuscation.enabled` 且并发回合内对发给模型的
 * `input` 生效；UI 展示层（displayInput）与消息历史保持原文不变。
 */

import type { SystemPromptObfuscationTier } from "../context/types.js";

export { type SystemPromptObfuscationTier };

/** 常见触发安全分类器的词（用于命中检测，也作为混淆候选）。 */
const TRIGGER_WORDS = [
  "hack", "exploit", "bypass", "crack", "break", "attack", "penetrate",
  "inject", "manipulate", "override", "disable", "circumvent", "evade",
  "malware", "virus", "trojan", "payload", "shellcode", "rootkit",
  "keylogger", "backdoor", "vulnerability", "weapon", "bomb", "explosive",
  "poison", "drug", "synthesize", "jailbreak", "unlock", "root", "sudo",
  "admin", "privilege", "phishing", "scam", "impersonate", "deceive", "fraud",
  "nsfw", "explicit", "uncensored", "unfiltered", "unrestricted",
  "ignore", "disregard", "forget", "pretend", "roleplay",
  "act as", "you are now", "new identity",
];

const LEET_MAP: Record<string, string> = {
  a: "4", b: "8", c: "(", e: "3", g: "9", h: "#", i: "1", l: "1",
  o: "0", s: "5", t: "7", z: "2",
};

const LEET_MAP_HEAVY: Record<string, string> = {
  a: "@", b: "|3", c: "¢", d: "|)", e: "€", f: "ƒ", g: "&", h: "|-|",
  i: "!", j: "_|", k: "|<", l: "|_", m: "/\\/\\", n: "|\\|", o: "()",
  p: "|*", r: "|2", s: "$", t: "+", u: "|_|", v: "\\/", w: "\\/\\/",
  x: "><", y: "`/", z: "7_",
};

const UNICODE_MAP: Record<string, string> = {
  a: "а", c: "с", e: "е", i: "і", o: "о", p: "р", s: "ѕ", x: "х", y: "у",
};

const SEMANTIC_SYNONYMS: Record<string, string> = {
  hack: "gain unauthorized access to",
  exploit: "take advantage of",
  bypass: "work around",
  crack: "break open",
  attack: "target",
  inject: "insert into",
  manipulate: "alter",
  override: "supersede",
  disable: "deactivate",
  circumvent: "go around",
  evade: "avoid",
  penetrate: "get into",
  malware: "malicious software",
  virus: "self-replicating program",
  payload: "delivery mechanism",
  shellcode: "executable stub",
  backdoor: "alternate entry",
  jailbreak: "escape restrictions",
  unlock: "open up",
  nsfw: "adult oriented",
  explicit: "graphic",
  uncensored: "raw",
  unfiltered: "unedited",
  unrestricted: "unconstrained",
};

const ZERO_WIDTH_JOINER = "\u200d";

function replaceWord(word: string, map: Record<string, string>): string {
  return word
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("");
}

function semanticReplace(input: string): string {
  let out = input;
  for (const [key, value] of Object.entries(SEMANTIC_SYNONYMS)) {
    const re = new RegExp(`\\b${key}\\b`, "gi");
    out = out.replace(re, value);
  }
  return out;
}

function lightTransform(input: string): string {
  const semantic = semanticReplace(input);
  const leet = replaceWord(semantic, LEET_MAP);
  // 字符间距混入零宽连接符，打散词边界又不破坏语义。
  return leet.split("").join(ZERO_WIDTH_JOINER);
}

function standardTransform(input: string): string {
  const light = lightTransform(input);
  // Unicode 同形字 + 每词反转 + 括号包裹。
  const homoglyph = replaceWord(light, UNICODE_MAP);
  const parts = homoglyph.split(/\s+/).map((w) => `[${w.split("").reverse().join("")}]`);
  return parts.join(" ");
}

function heavyTransform(input: string): string {
  const standard = standardTransform(input);
  // 多层级编码：hex 层 + base64 层，包裹触发词。
  const hex = Buffer.from(standard, "utf-8").toString("hex");
  const b64 = Buffer.from(standard, "utf-8").toString("base64");
  return `p((h))${hex}((b))${b64}`;
}

/** 是否命中任一触发词（用于校验/调试）。 */
export function hasTriggerWord(input: string): boolean {
  const lower = input.toLowerCase();
  return TRIGGER_WORDS.some((word) => lower.includes(word));
}

/** 按档位对用户输入做混淆。tier 缺省为 light。 */
export function obfuscateQuery(input: string, tier?: SystemPromptObfuscationTier): string {
  if (!input || !tier) return input;
  switch (tier) {
    case "heavy":
      return heavyTransform(input);
    case "standard":
      return standardTransform(input);
    case "light":
    default:
      return lightTransform(input);
  }
}
