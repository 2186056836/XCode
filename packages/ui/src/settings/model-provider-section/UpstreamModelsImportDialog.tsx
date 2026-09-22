/* oxlint-disable eslint(max-lines) -- 批量导入弹窗承载拉取/勾选列表与统一模型配置两块紧耦合 UI；与单个添加模型对话框的字段集有意保持同构，拆分会造成两套字段映射漂移。 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { DownloadCloud, Loader2Icon, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import type { ModelConfigObject } from "@zcode/provider";
import type { UpstreamModelListResult } from "@zcode/shared";
import { TECHNICAL_INPUT_ATTRIBUTES } from "@/lib/technicalInputAttributes.js";
import {
  ModelConfigHelp,
  ModelConfigInputLabel,
} from "@/settings/model-provider-section/ModelConfigHelp.js";
import {
  BooleanModelOption,
} from "@/settings/model-provider-section/ProviderModelMetadataFields.js";
import { ProviderModelInputModalityOptions } from "@/settings/model-provider-section/ProviderModelModalityOptions.js";
import { ModelEditorAdvanced } from "@/settings/model-provider-section/ModelEditorAdvanced.js";
import { ProviderModelReasoningSettings } from "@/settings/model-provider-section/ProviderModelSettingsGroups.js";
import {
  type ProviderModelDraftValues,
  type ProviderModelInputFormatDraft,
} from "@/settings/model-provider-section/ProviderModelMetadata.js";
import { cn } from "@/components/lib/utils.js";

/**
 * XCode fork：从自定义供应商上游拉取模型列表并批量添加。
 *
 * 打开即自动拉取（GET {baseUrl}/models，Host 直连）；列表勾选要导入的模型，
 * 已存在的置灰防重复。弹窗顶部提供"统一模型配置"——与单个添加模型对话框同款字段
 * （上下文窗口/最大输出 Token/输入类型/模型能力/推理等级），勾选的所有模型共用这一套
 * 配置（替代智能推荐配置）。行为对齐单个"添加模型"：导入中等待完成，全部成功才关闭；
 * 结果 toast 由 Card 层一次性汇总。
 */

type FetchPhase = "idle" | "fetching" | "ready" | "error";

interface UpstreamFetchError {
  code?: string;
  message: string;
}

const ERROR_MESSAGE_KEY_BY_CODE: Record<string, string> = {
  "provider-unavailable": "settings.modelProvider.importModels.error.providerUnavailable",
  "endpoint-unavailable": "settings.modelProvider.importModels.error.endpointUnavailable",
  auth: "settings.modelProvider.importModels.error.auth",
  network: "settings.modelProvider.importModels.error.network",
  timeout: "settings.modelProvider.importModels.error.timeout",
  server: "settings.modelProvider.importModels.error.server",
  "invalid-response": "settings.modelProvider.importModels.error.invalidResponse",
};

/** 批量导入统一配置的草稿（复用单个添加模型的字段结构，去掉 idValue）。 */
interface BatchModelConfigDraft {
  contextWindowValue: string;
  maxOutputTokensValue: string;
  inputFormatValue: ProviderModelInputFormatDraft;
  supportsJsonSchemaOutputValue: boolean;
  supportsNativeWebSearchValue: boolean;
  supportsMidConversationSystemValue: boolean;
  reasoningLevelValuesValue: readonly string[];
  reasoningLevelMapValue: string;
}

const DEFAULT_BATCH_CONFIG: BatchModelConfigDraft = {
  contextWindowValue: "200000",
  maxOutputTokensValue: "32000",
  inputFormatValue: {
    supportsText: true,
    supportsImage: false,
    supportsVideo: false,
    supportsAudio: false,
    supportsPdf: false,
  },
  supportsJsonSchemaOutputValue: false,
  supportsNativeWebSearchValue: false,
  supportsMidConversationSystemValue: false,
  reasoningLevelValuesValue: ["disabled", "enabled"],
  reasoningLevelMapValue: "{}",
};

type BatchConfigField = "contextWindow" | "maxOutputTokens" | "reasoningLevelValues";

function parsePositiveInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** 校验统一配置并构造所有勾选模型共用的 personalConfig；无效时返回字段名。 */
function buildBatchPersonalConfig(
  draft: BatchModelConfigDraft,
): { config: ModelConfigObject } | { invalidField: BatchConfigField } {
  const contextWindow = parsePositiveInteger(draft.contextWindowValue);
  if (contextWindow === null) return { invalidField: "contextWindow" };
  const maxOutputTokens = parsePositiveInteger(draft.maxOutputTokensValue);
  if (maxOutputTokens === null) return { invalidField: "maxOutputTokens" };
  const reasoningLevelValues = draft.reasoningLevelValuesValue.map((value) => value.trim());
  if (
    reasoningLevelValues.length === 0 ||
    reasoningLevelValues.some((value) => !value) ||
    new Set(reasoningLevelValues).size !== reasoningLevelValues.length
  ) {
    return { invalidField: "reasoningLevelValues" };
  }
  if (!draft.inputFormatValue.supportsText) {
    return { invalidField: "reasoningLevelValues" };
  }
  return {
    config: {
      properties: {
        contextWindow,
        inputFormat: { ...draft.inputFormatValue },
        supportsToolCall: true,
        supportsJsonSchemaOutput: draft.supportsJsonSchemaOutputValue,
        supportsNativeWebSearch: draft.supportsNativeWebSearchValue,
        supportsMidConversationSystem: draft.supportsMidConversationSystemValue,
      },
      optionSpecs: {
        maxOutputTokens: { max: maxOutputTokens },
        reasoningLevel: {
          values: [...reasoningLevelValues],
          ...(draft.reasoningLevelMapValue.trim()
            ? { map: draft.reasoningLevelMapValue.trim() }
            : {}),
        },
      },
    },
  };
}

export function UpstreamModelsImportDialog({
  open,
  onOpenChange,
  providerId,
  existingModelIds,
  onFetchUpstreamModels,
  onImportModels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerId: string;
  existingModelIds: readonly string[];
  onFetchUpstreamModels: (providerId: string) => Promise<UpstreamModelListResult>;
  /** 批量导入整批勾选的模型，统一套用弹窗内的模型配置；串行保存与一次性汇总通知由 Card 层负责。 */
  onImportModels: (
    modelIds: readonly string[],
    config: ModelConfigObject,
  ) => Promise<{ added: number; failed: number; failedModelIds: readonly string[] }>;
}) {
  const { intl } = useXCodeIntl();
  const [phase, setPhase] = useState<FetchPhase>("idle");
  const [models, setModels] = useState<readonly string[]>([]);
  const [fetchError, setFetchError] = useState<UpstreamFetchError | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [filter, setFilter] = useState("");
  const [importing, setImporting] = useState(false);
  const [configDraft, setConfigDraft] = useState<BatchModelConfigDraft>(DEFAULT_BATCH_CONFIG);
  const [invalidField, setInvalidField] = useState<BatchConfigField | null>(null);

  const existingSet = useMemo(() => new Set(existingModelIds), [existingModelIds]);

  const runFetch = useCallback(async () => {
    setPhase("fetching");
    setFetchError(null);
    try {
      const result = await onFetchUpstreamModels(providerId);
      if (result.success) {
        setModels(result.models);
        // 默认全选尚未添加的模型；已存在的保持未选且不可选。
        setSelected(new Set(result.models.filter((id) => !existingSet.has(id))));
        setPhase("ready");
      } else {
        setFetchError(result.error);
        setPhase("error");
      }
    } catch (error) {
      logger.warn("[UpstreamModelsImport] 拉取上游模型列表失败", error);
      setFetchError({ message: error instanceof Error ? error.message : String(error) });
      setPhase("error");
    }
  }, [existingSet, onFetchUpstreamModels, providerId]);

  useEffect(() => {
    if (open && phase === "idle") void runFetch();
  }, [open, phase, runFetch]);

  const resetState = useCallback(() => {
    setPhase("idle");
    setModels([]);
    setFetchError(null);
    setSelected(new Set());
    setFilter("");
    setConfigDraft(DEFAULT_BATCH_CONFIG);
    setInvalidField(null);
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      // 保存进行中禁止关闭，与单个添加模型一致：等待本批提交完成再结束编辑。
      if (importing) return;
      if (!next) resetState();
      onOpenChange(next);
    },
    [importing, onOpenChange, resetState],
  );

  const visibleModels = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    if (!keyword) return [...models];
    return models.filter((id) => id.toLowerCase().includes(keyword));
  }, [filter, models]);

  const selectableVisibleIds = useMemo(
    () => visibleModels.filter((id) => !existingSet.has(id)),
    [existingSet, visibleModels],
  );
  const allVisibleSelected =
    selectableVisibleIds.length > 0 && selectableVisibleIds.every((id) => selected.has(id));

  const toggleModel = (id: string) => {
    if (existingSet.has(id)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of selectableVisibleIds) {
        if (allVisibleSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const updateConfig = (patch: Partial<BatchModelConfigDraft>) => {
    setConfigDraft((prev) => ({ ...prev, ...patch }));
    setInvalidField(null);
  };

  const handleImport = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const built = buildBatchPersonalConfig(configDraft);
    if ("invalidField" in built) {
      setInvalidField(built.invalidField);
      return;
    }
    setImporting(true);
    try {
      const summary = await onImportModels(ids, built.config);
      if (summary.failed === 0) {
        // 全部成功：与单个添加一致，保存完成后关窗；结果由 Card 层 toast 汇总。
        setImporting(false);
        resetState();
        onOpenChange(false);
        return;
      }
      // 有失败：保持打开供重试——成功项已随 existingModelIds 更新自动置灰，
      // 勾选收敛到失败项，明细在 Card 层红色 toast。
      setSelected(new Set(summary.failedModelIds));
    } catch (error) {
      // 批量回调自身抛错（装配缺失等）：保持打开，具体原因已由其内部记录。
      logger.warn("[UpstreamModelsImport] 批量导入失败", error);
    }
    setImporting(false);
  };

  const errorMessage = fetchError
    ? `${intl.formatMessage({
        id:
          ERROR_MESSAGE_KEY_BY_CODE[fetchError.code ?? ""] ??
          "settings.modelProvider.importModels.error.unknown",
      })}${fetchError.code === "server" ? ` (${fetchError.message})` : ""}`
    : null;

  const invalidFieldMessage = invalidField
    ? intl.formatMessage({
        id: `settings.modelProvider.importModels.invalid.${invalidField}`,
      })
    : null;

  const reasoningDraftValue: ProviderModelDraftValues = {
    idValue: "",
    contextWindowValue: configDraft.contextWindowValue,
    maxOutputTokensValue: configDraft.maxOutputTokensValue,
    inputFormatValue: configDraft.inputFormatValue,
    useRecommendedConfigValue: false,
    clearPersonalConfigValue: false,
    supportsJsonSchemaOutputValue: configDraft.supportsJsonSchemaOutputValue,
    supportsNativeWebSearchValue: configDraft.supportsNativeWebSearchValue,
    supportsMidConversationSystemValue: configDraft.supportsMidConversationSystemValue,
    reasoningLevelValuesValue: configDraft.reasoningLevelValuesValue,
    reasoningLevelMapValue: configDraft.reasoningLevelMapValue,
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[min(48rem,calc(100vh-4rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-clip sm:max-w-lg">
        <DialogHeader className="pr-8">
          <DialogTitle>
            {intl.formatMessage({ id: "settings.modelProvider.importModels.title" })}
          </DialogTitle>
          <DialogDescription>
            {intl.formatMessage({ id: "settings.modelProvider.importModels.description" })}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 min-w-0 -mr-3 space-y-4 overflow-y-auto pr-4">
          {phase === "fetching" && (
            <div className="flex h-32 items-center justify-center gap-2 text-ui-base text-foreground-subtle">
              <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
              {intl.formatMessage({ id: "settings.modelProvider.importModels.loading" })}
            </div>
          )}

          {phase === "error" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <p className="text-center text-ui-base text-destructive">{errorMessage}</p>
              <Button type="button" variant="secondary" onClick={() => void runFetch()}>
                <RefreshCw data-icon="inline-start" aria-hidden="true" />
                {intl.formatMessage({ id: "settings.modelProvider.importModels.retry" })}
              </Button>
            </div>
          )}

          {phase === "ready" && (
            models.length === 0 ? (
              <p className="py-6 text-center text-ui-base text-foreground-subtle">
                {intl.formatMessage({ id: "settings.modelProvider.importModels.empty" })}
              </p>
            ) : (
              <>
                {/* 统一模型配置：勾选的所有模型共用这一套（与单个添加模型对话框同款字段）。 */}
                <div className="space-y-3 rounded-lg border border-border p-3">
                  <div className="text-ui-base font-medium text-foreground">
                    {intl.formatMessage({
                      id: "settings.modelProvider.importModels.sharedConfig",
                    })}
                  </div>
                  <div>
                    <div className="mb-1 block text-ui-base text-foreground-subtle">
                      <ModelConfigInputLabel field="contextWindow" htmlFor="" />
                    </div>
                    <Input
                      {...TECHNICAL_INPUT_ATTRIBUTES}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      size="lg"
                      value={configDraft.contextWindowValue}
                      aria-invalid={invalidField === "contextWindow"}
                      className={cn(
                        invalidField === "contextWindow" &&
                          "border-destructive focus-visible:ring-destructive/30",
                      )}
                      disabled={importing}
                      onChange={(event) => {
                        updateConfig({ contextWindowValue: event.target.value });
                      }}
                    />
                  </div>
                  <div data-model-max-output="true">
                    <div className="mb-1 block text-ui-base text-foreground-subtle">
                      <ModelConfigInputLabel field="maxOutputTokens" htmlFor="" />
                    </div>
                    <Input
                      {...TECHNICAL_INPUT_ATTRIBUTES}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      size="lg"
                      value={configDraft.maxOutputTokensValue}
                      aria-invalid={invalidField === "maxOutputTokens"}
                      className={cn(
                        invalidField === "maxOutputTokens" &&
                          "border-destructive focus-visible:ring-destructive/30",
                      )}
                      disabled={importing}
                      onChange={(event) => {
                        updateConfig({ maxOutputTokensValue: event.target.value });
                      }}
                    />
                  </div>
                  <ModelEditorAdvanced open={open} errorField={null} validationAttempt={0}>
                    <div className="space-y-3">
                      <div>
                        <div className="mb-1 block text-ui-base text-foreground-subtle">
                          {intl.formatMessage({
                            id: "settings.modelProvider.inputModalities",
                          })}
                          <ModelConfigHelp field="inputModalities" />
                        </div>
                        <ProviderModelInputModalityOptions
                          value={configDraft.inputFormatValue}
                          onChange={(inputFormatValue) => updateConfig({ inputFormatValue })}
                        />
                      </div>
                      <div>
                        <div
                          className="mb-1 block text-ui-base text-foreground-subtle"
                          data-model-capabilities-label="true"
                        >
                          {intl.formatMessage({
                            id: "settings.modelProvider.capabilities",
                          })}
                          <ModelConfigHelp field="capabilities" />
                        </div>
                        <div
                          className="flex flex-wrap gap-2"
                          data-model-capabilities-options="true"
                        >
                          {(
                            [
                              "supportsJsonSchemaOutput",
                              "supportsNativeWebSearch",
                              "supportsMidConversationSystem",
                            ] as const
                          ).map((property) => {
                            const label = intl.formatMessage({
                              id: `settings.modelProvider.${property}`,
                            });
                            return (
                              <BooleanModelOption
                                key={property}
                                label={label}
                                selected={
                                  configDraft[
                                    `${property}Value` as keyof BatchModelConfigDraft
                                  ] as boolean
                                }
                                onToggle={() =>
                                  updateConfig({
                                    [`${property}Value`]: !(
                                      configDraft[
                                        `${property}Value` as keyof BatchModelConfigDraft
                                      ] as boolean
                                    ),
                                  } as Partial<BatchModelConfigDraft>)
                                }
                              />
                            );
                          })}
                        </div>
                      </div>
                      <ProviderModelReasoningSettings
                        draft={reasoningDraftValue}
                        onDraftChange={(patch) => {
                          updateConfig({
                            reasoningLevelValuesValue:
                              patch.reasoningLevelValuesValue ??
                              configDraft.reasoningLevelValuesValue,
                            reasoningLevelMapValue:
                              patch.reasoningLevelMapValue ?? configDraft.reasoningLevelMapValue,
                          });
                        }}
                      />
                    </div>
                  </ModelEditorAdvanced>
                  {invalidFieldMessage ? (
                    <p className="text-ui-base text-destructive" role="alert">
                      {invalidFieldMessage}
                    </p>
                  ) : null}
                </div>

                <Input
                  value={filter}
                  disabled={importing}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder={intl.formatMessage({
                    id: "settings.modelProvider.importModels.searchPlaceholder",
                  })}
                />
                <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto rounded-lg border border-input-border bg-input p-2">
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-ui-base hover:bg-accent">
                    <Checkbox
                      checked={allVisibleSelected}
                      onCheckedChange={toggleAllVisible}
                      disabled={selectableVisibleIds.length === 0 || importing}
                    />
                    <span className="text-foreground-subtle">
                      {intl.formatMessage({
                        id: "settings.modelProvider.importModels.selectAll",
                      })}
                    </span>
                  </label>
                  {visibleModels.map((id) => {
                    const alreadyAdded = existingSet.has(id);
                    return (
                      <label
                        key={id}
                        className={
                          alreadyAdded
                            ? "flex items-center gap-2 rounded px-2 py-1 text-ui-base opacity-60"
                            : "flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-ui-base hover:bg-accent"
                        }
                      >
                        <Checkbox
                          checked={selected.has(id)}
                          onCheckedChange={() => toggleModel(id)}
                          disabled={alreadyAdded || importing}
                        />
                        <span className="truncate text-ui-sm">{id}</span>
                        {alreadyAdded && (
                          <span className="ml-auto shrink-0 text-ui-sm text-foreground-subtle">
                            {intl.formatMessage({
                              id: "settings.modelProvider.importModels.alreadyAdded",
                            })}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </>
            )
          )}
        </div>

        {phase === "ready" && models.length > 0 ? (
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={importing}
            >
              {intl.formatMessage({ id: "settings.modelProvider.importModels.cancel" })}
            </Button>
            <Button
              type="button"
              onClick={() => void handleImport()}
              disabled={importing || selected.size === 0}
            >
              {importing ? (
                <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <DownloadCloud data-icon="inline-start" aria-hidden="true" />
              )}
              {intl.formatMessage(
                { id: "settings.modelProvider.importModels.import" },
                { count: selected.size },
              )}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
