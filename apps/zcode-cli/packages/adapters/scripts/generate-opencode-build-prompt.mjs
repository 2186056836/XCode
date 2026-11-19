#!/usr/bin/env node
/**
 * 把 opencode-build-prompt.txt 生成为可 import 的 TS 常量。
 *
 * 为什么需要官方的 build prompt：opencode.ai 免费档的服务端闸门会校验 system 里
 * 必须包含官方 build agent 的原文（2026-11-20 实测：换任意自定义 system → 429，
 * 前缀/后缀/独立 system 消息都能过）。运行时再从桌面 asar 里读不现实，所以把
 * 原文入库并生成常量。
 *
 * 用法：node scripts/generate-opencode-build-prompt.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(packageRoot, "src", "model", "opencode-build-prompt.txt");
const targetPath = join(packageRoot, "src", "model", "opencode-build-prompt.generated.ts");

const text = (await readFile(sourcePath, "utf8")).replace(/\r\n/g, "\n");
const output = `/**
 * 由 scripts/generate-opencode-build-prompt.mjs 生成，不要手改。
 *
 * 来源：OpenCode CLI 1.19.4 desktop asar 的 build agent system prompt（2026-11-18）。
 * 免费档服务端会校验该原文存在于 system 中；替换/删改会落进 429 桶。
 */
export const OPENCODE_BUILD_PROMPT = ${JSON.stringify(text)};

/** 用于判断请求里是否已经包含官方 build prompt。 */
export const OPENCODE_BUILD_PROMPT_MARKER = "You are opencode, an interactive CLI tool";
`;
await writeFile(targetPath, output, "utf8");
console.log(`[opencode-prompt] wrote ${targetPath} (${text.length} chars)`);
