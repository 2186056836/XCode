import { describe, expect, it } from "vitest";
import { decodeProviderConfigFile } from "../src/provider-config-file-codec.js";

const BROKEN_MAP = JSON.stringify({
  reasoning_effort: 'reasoningLevel == "disabled" ? "none" : reasoningLevel',
});
const REPAIRED_MAP =
  '{"reasoning_effort": reasoningLevel == "disabled" ? "none" : reasoningLevel}';

function configWithMap(map: string) {
  return {
    schemaVersion: 1,
    config: {
      providerConfigRules: { providerRules: [] },
      modelConfigRules: {
        providerModelRules: [],
        manualProviderModelRules: [
          {
            providerId: "other:codebuddy-cn",
            modelId: "deepseek-v4.1-flash",
            config: {
              enabled: true,
              properties: {
                contextWindow: 1_000_000,
                supportsJsonSchemaOutput: false,
                supportsNativeWebSearch: false,
                supportsMidConversationSystem: false,
                inputFormat: {
                  supportsImage: true,
                  supportsVideo: false,
                  supportsPdf: false,
                },
              },
              optionSpecs: {
                reasoningLevel: { values: ["disabled", "low", "high", "max"], map },
                maxOutputTokens: { max: 128_000 },
              },
            },
          },
        ],
      },
    },
  };
}

describe("provider config option map self-heal", () => {
  it("rewrites a stringified CEL expression into a bare expression", () => {
    const decoded = decodeProviderConfigFile(configWithMap(BROKEN_MAP));
    const rules = decoded.models.toPersonalJSON().manualProviderModelRules;
    expect(rules[0].config?.optionSpecs?.reasoningLevel?.map).toBe(REPAIRED_MAP);
  });

  it("is idempotent for already-correct maps", () => {
    const once = decodeProviderConfigFile(configWithMap(REPAIRED_MAP));
    const twice = decodeProviderConfigFile(configWithMap(REPAIRED_MAP));
    expect(once.models.toPersonalJSON()).toEqual(twice.models.toPersonalJSON());
    const rules = once.models.toPersonalJSON().manualProviderModelRules;
    expect(rules[0].config?.optionSpecs?.reasoningLevel?.map).toBe(REPAIRED_MAP);
  });

  it("leaves literal values and unrelated maps untouched", () => {
    const literal = '{"reasoning_effort": "high"}';
    const decoded = decodeProviderConfigFile(configWithMap(literal));
    const rules = decoded.models.toPersonalJSON().manualProviderModelRules;
    expect(rules[0].config?.optionSpecs?.reasoningLevel?.map).toBe(literal);
  });

  it("leaves non-JSON map sources untouched", () => {
    const expression = 'reasoningLevel == "disabled" ? {"thinking": {"type": "disabled"}} : {}';
    const decoded = decodeProviderConfigFile(configWithMap(expression));
    const rules = decoded.models.toPersonalJSON().manualProviderModelRules;
    expect(rules[0].config?.optionSpecs?.reasoningLevel?.map).toBe(expression);
  });
});
