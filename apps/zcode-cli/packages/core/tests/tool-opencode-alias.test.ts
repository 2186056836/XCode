import { describe, expect, it } from "vitest";
import { deferredToolCallEntry } from "../src/tool/handlers/deferred-tool-call.js";
import { editToolEntry } from "../src/tool/handlers/edit.js";
import { readToolEntry } from "../src/tool/handlers/read.js";
import { toolSearchToolEntry } from "../src/tool/handlers/tool-search.js";
import { createToolRegistry } from "../src/tool/registry.js";

/** OpenCode 免费档出站别名：模型回显别名时 registry 必须解析回原工具。 */
describe("OpenCode free outbound tool aliases", () => {
  it("resolves renamed tool calls back to the canonical entries", () => {
    const registry = createToolRegistry();
    registry.register(readToolEntry);
    registry.register(editToolEntry);
    registry.register(deferredToolCallEntry);
    registry.register(toolSearchToolEntry);

    expect(registry.get("ReadFile")?.metadata.name).toBe(readToolEntry.metadata.name);
    expect(registry.get("EditFile")?.metadata.name).toBe(editToolEntry.metadata.name);
    expect(registry.get("Defer")?.metadata.name).toBe(deferredToolCallEntry.metadata.name);
    expect(registry.get("SearchTools")?.metadata.name).toBe(toolSearchToolEntry.metadata.name);
  });

  it("keeps the alias listable as the canonical name only", () => {
    const registry = createToolRegistry();
    registry.register(readToolEntry);
    expect(registry.list()).toContain(readToolEntry.metadata.name);
    expect(registry.list()).not.toContain("ReadFile");
  });
});
