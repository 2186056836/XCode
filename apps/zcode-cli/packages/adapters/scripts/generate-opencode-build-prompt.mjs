#!/usr/bin/env node
/**
 * 把 opencode-build-prompt.txt 生成为可 import 的 TS 常量。
 *
 * 历史：2026-11-20 上午曾认为免费档要求 system 里包含官方 build prompt 原文，
 * 于是把它入库并由运行时拼到 system 前面。当天下午的逐项消融推翻了该结论：
 * 闸门只校验 system 里的 `<env>...</env>` 块，且块内要有一行非空
 * `Working directory:`；官方 prompt 全文不带 env 时仍然 429。
 * 现在运行时只拼最小 env 签名段（见 opencode-build-agent.ts），本常量与 txt
 * 保留作为原文参考，不再参与请求。
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
 * 仅作原文参考；运行时不再发送，免费档只校验 <env> 块。
 */
export const OPENCODE_BUILD_PROMPT = ${JSON.stringify(text)};

/** 仅用于测试断言运行时不发送官方 prompt。 */
export const OPENCODE_BUILD_PROMPT_MARKER = "You are opencode, an interactive CLI tool";
`;
await writeFile(targetPath, output, "utf8");
console.log(`[opencode-prompt] wrote ${targetPath} (${text.length} chars)`);
