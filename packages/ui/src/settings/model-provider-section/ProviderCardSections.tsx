/* eslint-disable max-lines -- 模型供应商卡片仍在迁移期集中维护多个紧耦合区块，后续拆分时再移除。 */
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  type ReactNode,
} from "react";
import type {
  ProviderSettingsFormProvider,
  ProviderSettingsFormModel,
} from "@/lib/providerSettingsFormTypes.js";
import type { ModelConnectivityResult, UpstreamModelListResult } from "@zcode/shared";
import type { ModelConfigObject, ProviderApiType } from "@zcode/provider";
import {
  TID_MODEL_PROVIDER_ADD_MODEL_BUTTON,
  TID_MODEL_PROVIDER_BASE_URL_INPUT,
  TID_MODEL_PROVIDER_BATCH_DELETE_BUTTON,
  TID_MODEL_PROVIDER_IMPORT_MODELS_BUTTON,
  TID_MODEL_PROVIDER_MODEL_DELETE_BUTTON,
  TID_MODEL_PROVIDER_MODEL_INPUT,
  TID_MODEL_PROVIDER_MODEL_SELECT_CHECKBOX,
  TID_MODEL_PROVIDER_NAME_EDIT_BUTTON,
  TID_MODEL_PROVIDER_NAME_INPUT,
  TID_MODEL_PROVIDER_SELECT_ALL_MODEL,
  testId,
} from "@zcode/shared";
import {
  InfoIcon,
  Loader2Icon,
  LockKeyholeIcon,
  Plus,
  Pencil,
  Trash2,
  MoreHorizontal,
  DownloadCloud,
} from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useProviderDetailFeedback } from "@/settings/model-provider-section/ProviderDetailFeedback.js";
import { useServices } from "@/hooks/useServices.js";
import { TECHNICAL_INPUT_ATTRIBUTES } from "@/lib/technicalInputAttributes.js";
import { ApiKeyInput } from "./ApiKeyInput.js";
import { ModelRowInput } from "./ProviderFormControls.js";
import { PresetProviderApiKeyBanner } from "./PresetProviderApiKeyBanner.js";
import { type ProviderModelDraftValues } from "@/settings/model-provider-section/ProviderModelMetadata.js";
import { ProviderModelMetadataDialog } from "@/settings/model-provider-section/ProviderModelMetadataDialog.js";
import { UpstreamModelsImportDialog } from "@/settings/model-provider-section/UpstreamModelsImportDialog.js";
import {
  PROVIDER_CONNECTION_API_FORMATS,
  ProviderApiFormatSelect,
  resolveProviderConnectionApiFormatDisplayLabel,
} from "@/settings/model-provider-section/ProviderApiFormatSelect.js";
import { SortableProviderModelList } from "@/settings/model-provider-section/SortableProviderModelList.js";
import { useProviderModelDraft } from "@/settings/model-provider-section/useProviderModelDraft.js";
import { ProviderLogo } from "@/settings/model-provider-section/ProviderLogo.js";
import { DEFAULT_PERSONAL_PROVIDER_API_FORMAT } from "@/settings/model-provider-section/constants.js";
import type { ProviderConfigObject } from "@zcode/provider";

export {
  resolveProviderConnectionApiFormatDisplayLabel,
  resolveProviderConnectionApiFormatOptions,
} from "@/settings/model-provider-section/ProviderApiFormatSelect.js";
export { formatModelContextWindowLabel } from "@/lib/tokenNumberFormat.js";

export function resolveProviderApiFormatOptions(
  _provider: Pick<ProviderSettingsFormProvider, "config" | "models">,
): ProviderApiType[] {
  return [...PROVIDER_CONNECTION_API_FORMATS];
}

export function shouldShowProviderApiFormat(
  _provider: Pick<ProviderSettingsFormProvider, "providerId">,
): boolean {
  return true;
}

export function ProviderCardHeader({
  providerName,
  logo,
  editingName,
  nameValue,
  nameInputRef,
  nameEditable = true,
  onNameChange,
  onNameBlur,
  onNameKeyDown,
  onNameCompositionEnd,
  onNameCompositionStart,
  onStartEditName,
  onDelete,
  actionsVisible = true,
  providerToggle,
}: {
  providerName: string;
  logo?: ProviderConfigObject["logo"];
  editingName: boolean;
  nameValue: string;
  nameInputRef: RefObject<HTMLInputElement | null>;
  nameEditable?: boolean;
  onNameChange: (value: string) => void;
  onNameBlur: () => void;
  onNameKeyDown: (event: ReactKeyboardEvent) => void;
  onNameCompositionEnd?: () => void;
  onNameCompositionStart?: () => void;
  onStartEditName: () => void;
  onDelete?: () => void;
  actionsVisible?: boolean;
  providerToggle?: ReactNode;
}) {
  const { intl } = useXCodeIntl();
  const renameRequestedRef = useRef(false);
  const secondaryActionsVisible = actionsVisible && (nameEditable || Boolean(onDelete));

  return (
    <div className="flex items-center justify-between gap-3" data-testid="model-provider-header">
      <div className="flex min-w-0 items-center gap-2">
        <ProviderLogo logo={logo} className="size-5" />
        {editingName ? (
          <Input
            {...TECHNICAL_INPUT_ATTRIBUTES}
            ref={nameInputRef}
            data-testid={TID_MODEL_PROVIDER_NAME_INPUT}
            type="text"
            size="lg"
            className="w-auto min-w-0 text-ui-lg font-semibold"
            value={nameValue}
            onChange={(event) => onNameChange(event.target.value)}
            onCompositionEnd={onNameCompositionEnd}
            onCompositionStart={onNameCompositionStart}
            onBlur={onNameBlur}
            onKeyDown={onNameKeyDown}
          />
        ) : (
          <>
            <div className="min-w-0 truncate text-ui-lg font-semibold text-foreground">
              {providerName}
            </div>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {providerToggle}
        {secondaryActionsVisible ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                data-testid="model-provider-actions-button"
                aria-label={intl.formatMessage({ id: "common.more" })}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(event) => {
                // 重命名后的焦点交给输入框，不能被菜单关闭时重新抢回触发按钮。
                if (renameRequestedRef.current) {
                  event.preventDefault();
                  renameRequestedRef.current = false;
                }
              }}
            >
              {nameEditable ? (
                <DropdownMenuItem
                  data-testid={TID_MODEL_PROVIDER_NAME_EDIT_BUTTON}
                  onSelect={() => {
                    renameRequestedRef.current = true;
                    onStartEditName();
                  }}
                >
                  <Pencil className="size-3.5" />
                  {intl.formatMessage({ id: "settings.modelProvider.renameProvider" })}
                </DropdownMenuItem>
              ) : null}
              {nameEditable && onDelete ? <DropdownMenuSeparator /> : null}
              {onDelete ? (
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Trash2 className="size-3.5" />
                  {intl.formatMessage({ id: "common.delete" })}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );
}

export function ProviderConnectionSection({
  provider,
  readOnly,
  hidden,
  apiFormat,
  baseUrlValue,
  onApiFormatChange,
  onBaseUrlChange,
  onBaseUrlBlur,
  onBaseUrlKeyDown,
  onBaseUrlCompositionStart,
  onBaseUrlCompositionEnd,
}: {
  provider: ProviderSettingsFormProvider;
  readOnly?: boolean;
  /**
   * 登录型供应商（其他提供商分组）不需要暴露 Base URL / API 格式：
   * 端点与协议由内置配置和 requestProfile 决定，登录后直接可用。
   */
  hidden?: boolean;
  apiFormat: ProviderApiType;
  baseUrlValue: string;
  onApiFormatChange: (value: ProviderApiType) => void;
  onBaseUrlChange: (value: string) => void;
  onBaseUrlBlur: () => void;
  onBaseUrlKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onBaseUrlCompositionStart?: () => void;
  onBaseUrlCompositionEnd?: () => void;
}) {
  const { intl } = useXCodeIntl();
  const showApiFormat = shouldShowProviderApiFormat(provider);
  const readOnlyBaseUrl = provider.config.api?.baseUrl ?? "";
  const resolvedApiFormat = provider.config.api?.type ?? DEFAULT_PERSONAL_PROVIDER_API_FORMAT;

  if (hidden) return null;

  const renderReadOnlyField = (label: string, value: string) => (
    <div>
      <label className="mb-1 block text-ui-base text-foreground-subtle">{label}</label>
      <div className="flex min-h-8 items-center gap-2 rounded-lg border border-input-border bg-input px-3 py-1.5 text-ui-base text-foreground">
        <span className="min-w-0 flex-1 break-all">{value || "-"}</span>
        <span
          role="img"
          aria-label={intl.formatMessage(
            { id: "settings.modelProvider.readOnlyField" },
            { field: label },
          )}
          className="shrink-0 text-foreground-subtle"
        >
          <LockKeyholeIcon className="size-3.5" aria-hidden="true" />
        </span>
      </div>
    </div>
  );

  if (readOnly) {
    return (
      <>
        {renderReadOnlyField(
          intl.formatMessage({ id: "settings.modelProvider.baseUrl" }),
          readOnlyBaseUrl,
        )}
        {showApiFormat
          ? renderReadOnlyField(
              intl.formatMessage({ id: "settings.modelProvider.apiFormat" }),
              resolveProviderConnectionApiFormatDisplayLabel(intl, resolvedApiFormat),
            )
          : null}
      </>
    );
  }

  return (
    <>
      <div>
        <label className="mb-1 block text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.modelProvider.baseUrl" })}
        </label>
        <Input
          {...TECHNICAL_INPUT_ATTRIBUTES}
          type="text"
          size="lg"
          data-testid={TID_MODEL_PROVIDER_BASE_URL_INPUT}
          value={baseUrlValue}
          placeholder={intl.formatMessage({
            id: "settings.modelProvider.baseUrlPlaceholder",
          })}
          onChange={(event) => onBaseUrlChange(event.target.value)}
          onBlur={onBaseUrlBlur}
          onKeyDown={onBaseUrlKeyDown}
          onCompositionStart={onBaseUrlCompositionStart}
          onCompositionEnd={onBaseUrlCompositionEnd}
        />
      </div>
      {showApiFormat ? (
        <div>
          <label className="mb-1 block text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "settings.modelProvider.apiFormat" })}
          </label>
          <ProviderApiFormatSelect value={apiFormat} onChange={onApiFormatChange} />
        </div>
      ) : null}
    </>
  );
}

export function ProviderApiKeySection({
  apiKeyValue,
  apiKeyVisible,
  readOnly,
  presetApiKeyUrl,
  onOpenPresetApiKey,
  onApiKeyChange,
  onApiKeyBlur,
  onApiKeyKeyDown,
  onApiKeyCompositionStart,
  onApiKeyCompositionEnd,
  onToggleApiKeyVisibility,
}: {
  apiKeyValue: string;
  apiKeyVisible: boolean;
  readOnly?: boolean;
  presetApiKeyUrl?: string;
  onOpenPresetApiKey?: () => void;
  onApiKeyChange: (value: string) => void;
  onApiKeyBlur: () => void;
  onApiKeyKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onApiKeyCompositionStart?: () => void;
  onApiKeyCompositionEnd?: () => void;
  onToggleApiKeyVisibility: () => void;
}) {
  const { intl } = useXCodeIntl();

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="block text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.modelProvider.apiKey" })}
        </label>
        {presetApiKeyUrl && onOpenPresetApiKey ? (
          <PresetProviderApiKeyBanner onOpenApiKey={onOpenPresetApiKey} />
        ) : null}
      </div>
      <ApiKeyInput
        value={apiKeyValue}
        visible={apiKeyVisible}
        readOnly={readOnly}
        onChange={onApiKeyChange}
        onBlur={onApiKeyBlur}
        onKeyDown={onApiKeyKeyDown}
        onCompositionStart={onApiKeyCompositionStart}
        onCompositionEnd={onApiKeyCompositionEnd}
        onToggleVisibility={onToggleApiKeyVisibility}
      />
    </div>
  );
}

function createEmptyModel(): ProviderSettingsFormModel {
  return {
    kind: "candidate",
    modelId: "",
    builtin: false,
    personalConfig: {},
    // 空 ID 尚未解析模型配置，硬编码档位会被误认为智能推荐。
    config: {
      properties: { supportsToolCall: true },
    },
    hasPersonalConfig: false,
    executable: false,
    selectable: false,
  };
}

export function ProviderModelsSection({
  providerId,
  providerName,
  providerEnabled = true,
  providerAccess,
  providerModelMeta,
  models,
  onTestModel,
  onModelCommit,
  onModelEnabledChange,
  onDeleteModel,
  onAddModel,
  onFetchUpstreamModels,
  onImportUpstreamModels,
  onReorderModelIds,
  settingsRevision = 0,
}: {
  providerId: string;
  providerName?: string;
  providerEnabled?: boolean;
  providerAccess?: ProviderConfigObject["access"];
  /** XCode fork：provider 的模型展示元数据表（可读名/倍率/档位）。 */
  providerModelMeta?: ProviderConfigObject["modelMeta"];
  models: ProviderSettingsFormModel[];
  onTestModel?: (model: string) => Promise<ModelConnectivityResult>;
  onModelCommit: (
    originalModelId: string,
    model: ProviderSettingsFormModel,
    basedOnRevision: number,
  ) => void | Promise<void>;
  /** XCode fork：返回 Promise 以支持批量删除的串行等待。 */
  onDeleteModel: (modelId: string) => void | Promise<void>;
  onModelEnabledChange?: (modelId: string, enabled: boolean) => void | Promise<void>;
  onAddModel: (model: ProviderSettingsFormModel) => void | Promise<void>;
  /** 从上游拉取模型列表批量添加；缺省时不渲染入口按钮。 */
  onFetchUpstreamModels?: (providerId: string) => Promise<UpstreamModelListResult>;
  /** 整批导入勾选的模型（每项可带各自配置，来自统一配置或上游元数据），Card 层串行保存并只发一次汇总通知。 */
  onImportUpstreamModels?: (
    items: ReadonlyArray<{ modelId: string; config: ModelConfigObject }>,
  ) => Promise<{ added: number; failed: number; failedModelIds: readonly string[] }>;
  onReorderModelIds?: (modelIds: string[]) => void;
  settingsRevision?: number;
}) {
  const { intl } = useXCodeIntl();
  const { providerSettingsService } = useServices();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const addSavingRef = useRef(false);
  const [addCommitError, setAddCommitError] = useState<string | null>(null);
  const [addModel] = useState(createEmptyModel);
  const [addDraftErrorField, setAddDraftErrorField] = useState<
    | "id"
    | "contextWindow"
    | "maxOutputTokens"
    | "inputFormat"
    | "reasoningLevelValues"
    | "reasoningLevelMap"
    | null
  >(null);
  const resolveAddModelConfig = useCallback(
    (modelId: string) => providerSettingsService.resolveModelConfig({ providerId, modelId }),
    [providerId, providerSettingsService],
  );
  const editor = useProviderModelDraft({
    model: addModel,
    open: addDialogOpen,
    scopeKey: providerId,
    resolve: resolveAddModelConfig,
  });
  const { draft: addDraft } = editor;

  const openAddDialog = useCallback(() => {
    editor.reset(createEmptyModel());
    setAddDraftErrorField(null);
    setAddCommitError(null);
    setAddDialogOpen(true);
  }, [editor.reset]);

  // 上游模型批量导入对话框开关；导入执行与通知在 Card 层批量回调中收口。
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  // XCode fork：批量删除选中态。默认不勾选（与「从上游批量添加」一致）。
  // Built-in 模型也可删除（Host 删除时自动拍平名单），因此全部行可勾选。
  const [selectedModelIds, setSelectedModelIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [batchDeleting, setBatchDeleting] = useState(false);
  const confirmDialog = useConfirmDialog();
  const { showFeedback } = useProviderDetailFeedback();

  const deletableModelIds = useMemo(() => models.map((model) => model.modelId), [models]);
  // 与当前可删列表求交集：models 变化（删除/导入）后不留死 id，避免按钮计数虚高。
  const effectiveSelectedModelIds = useMemo(
    () => deletableModelIds.filter((id) => selectedModelIds.has(id)),
    [deletableModelIds, selectedModelIds],
  );
  const allDeletableSelected =
    deletableModelIds.length > 0 &&
    effectiveSelectedModelIds.length === deletableModelIds.length;

  const toggleModelSelected = useCallback((modelId: string, checked: boolean) => {
    setSelectedModelIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(modelId);
      else next.delete(modelId);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedModelIds((prev) => {
      const next = new Set(prev);
      const selectAll = deletableModelIds.length > 0 && next.size < deletableModelIds.length;
      for (const id of deletableModelIds) {
        if (selectAll) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, [deletableModelIds]);

  // 批量删除：串行循环现有 onDeleteModel（与单个删除同一条链路、同样的错误处理），
  // 整批只发一条汇总通知——避免 N 个模型弹 N 组 toast。
  const handleBatchDelete = useCallback(async () => {
    const targets = effectiveSelectedModelIds;
    if (targets.length === 0) return;
    const confirmed = await confirmDialog({
      title: intl.formatMessage(
        { id: "settings.modelProvider.batchDelete.confirmTitle" },
        { count: targets.length },
      ),
      description: intl.formatMessage({
        id: "settings.modelProvider.batchDelete.confirmDescription",
      }),
      confirmLabel: intl.formatMessage({ id: "settings.modelProvider.batchDelete.confirmAction" }),
      cancelLabel: intl.formatMessage({ id: "common.cancel" }),
      confirmVariant: "destructive",
    });
    if (!confirmed) return;

    const feedbackKey = `models-batch-delete:${providerId}`;
    setBatchDeleting(true);
    showFeedback({
      key: feedbackKey,
      message: intl.formatMessage(
        { id: "settings.modelProvider.batchDelete.deleting" },
        { count: targets.length },
      ),
      state: "pending",
      durationMs: 0,
    });
    let deleted = 0;
    let failed = 0;
    for (const modelId of targets) {
      try {
        // 串行 await：Host 的配置写入是一次事务，等上一次落盘再发下一次。
        // 一次性派发会让后续删除撞上"模型已不存在"。
        await onDeleteModel(modelId);
        deleted += 1;
      } catch (error) {
        failed += 1;
        logger.warn("[ModelProviderSection] 批量删除模型失败", { providerId, modelId, error });
      }
    }
    showFeedback({
      key: feedbackKey,
      message: intl.formatMessage(
        { id: "settings.modelProvider.batchDelete.result" },
        { deleted, failed },
      ),
      state: failed > 0 ? "failure" : "success",
    });
    setBatchDeleting(false);
    setSelectedModelIds(new Set());
  }, [
    confirmDialog,
    effectiveSelectedModelIds,
    intl,
    onDeleteModel,
    providerId,
    showFeedback,
  ]);

  const updateAddDraft = (patch: Partial<ProviderModelDraftValues>) => {
    editor.change(patch);
    setAddDraftErrorField(null);
  };

  const cancelAddDialog = () => {
    setAddDialogOpen(false);
    editor.reset(createEmptyModel());
    setAddDraftErrorField(null);
    editor.cancel();
  };

  const handleAddDialogOpenChange = useCallback(
    (open: boolean) => {
      // 保存中的关闭/再打开会让旧请求结束掉新草稿，等待本次提交完成再结束编辑。
      if (addSavingRef.current) return;
      if (!open) {
        cancelAddDialog();
        return;
      }
      setAddDialogOpen(true);
    },
    [cancelAddDialog],
  );

  const commitAddDraft = useCallback(async (): Promise<boolean> => {
    if (addSavingRef.current) return false;
    addSavingRef.current = true;
    setAddSaving(true);
    setAddCommitError(null);
    try {
      const result = await editor.commit();
      if (result.status === "invalid") {
        setAddDraftErrorField(result.field);
        return false;
      }
      // 过去只发起异步添加就关闭弹窗，失败后输入也丢了；以实际保存完成作为结束边界。
      await onAddModel(result.model);
      setAddDialogOpen(false);
      editor.reset(createEmptyModel());
      return true;
    } catch (error) {
      setAddCommitError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      addSavingRef.current = false;
      setAddSaving(false);
    }
  }, [editor, onAddModel]);
  const addDraftErrorMessage = addDraftErrorField
    ? intl.formatMessage({
        id: `settings.modelProvider.modelMetadata.invalid.${addDraftErrorField}`,
      })
    : null;

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <span className="text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.modelProvider.models" })}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {onFetchUpstreamModels && onImportUpstreamModels && (
            <Button
              type="button"
              variant="secondary"
              size="default"
              className="rounded-lg"
              data-testid={TID_MODEL_PROVIDER_IMPORT_MODELS_BUTTON}
              onClick={() => setImportDialogOpen(true)}
            >
              <DownloadCloud data-icon="inline-start" aria-hidden="true" />
              {intl.formatMessage({ id: "settings.modelProvider.importModels.button" })}
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            size="default"
            className="rounded-lg"
            data-testid={TID_MODEL_PROVIDER_ADD_MODEL_BUTTON}
            onClick={openAddDialog}
          >
            <Plus data-icon="inline-start" aria-hidden="true" />
            {intl.formatMessage({ id: "settings.modelProvider.addModel" })}
          </Button>
        </div>
      </div>
      {/* XCode fork：勾选后浮现的操作条。默认无勾选时不占空间。 */}
      {effectiveSelectedModelIds.length > 0 ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-input-border bg-surface px-3 py-2">
          <span className="text-ui-sm text-foreground">
            {intl.formatMessage(
              { id: "settings.modelProvider.batchDelete.selectedCount" },
              { count: effectiveSelectedModelIds.length },
            )}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-lg"
            data-testid={TID_MODEL_PROVIDER_SELECT_ALL_MODEL}
            onClick={toggleSelectAll}
            disabled={batchDeleting}
          >
            {intl.formatMessage({
              id: allDeletableSelected
                ? "settings.modelProvider.batchDelete.deselectAll"
                : "settings.modelProvider.batchDelete.selectAll",
            })}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="rounded-lg"
            data-testid={TID_MODEL_PROVIDER_BATCH_DELETE_BUTTON}
            disabled={batchDeleting}
            onClick={() => void handleBatchDelete()}
          >
            {batchDeleting ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 data-icon="inline-start" aria-hidden="true" />
            )}
            {intl.formatMessage({ id: "settings.modelProvider.batchDelete.deleteSelected" })}
          </Button>
        </div>
      ) : null}
      {models.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-input-border bg-input">
          <SortableProviderModelList
            modelIds={models.map((model) => model.modelId)}
            sortableModelIds={models.map((model) => model.modelId)}
            onReorder={onReorderModelIds}
            renderModel={(_modelId, index) => {
              const model = models[index]!;
              const inputFormat = model.config.properties?.inputFormat;
              const outputFormat = model.config.properties?.outputFormat;
              const completeProperties =
                model.config.properties?.contextWindow != null &&
                inputFormat?.supportsText != null &&
                inputFormat.supportsImage != null &&
                inputFormat.supportsVideo != null &&
                inputFormat.supportsAudio != null &&
                inputFormat.supportsPdf != null &&
                outputFormat?.supportsText != null;
              return (
                <>
                  <ModelRowInput
                    key={`${providerId}/${model.modelId}`}
                    providerId={providerId}
                    providerName={providerName}
                    providerEnabled={providerEnabled}
                    providerAccess={providerAccess}
                    providerModelMeta={providerModelMeta}
                    inputTestId={testId(TID_MODEL_PROVIDER_MODEL_INPUT, String(index))}
                    deleteTestId={testId(TID_MODEL_PROVIDER_MODEL_DELETE_BUTTON, String(index))}
                    selected={selectedModelIds.has(model.modelId)}
                    onSelectedChange={(checked) =>
                      toggleModelSelected(model.modelId, checked)
                    }
                    selectTestId={testId(
                      TID_MODEL_PROVIDER_MODEL_SELECT_CHECKBOX,
                      String(index),
                    )}
                    model={model}
                    onCommit={(value, basedOnRevision) =>
                      onModelCommit(model.modelId, value, basedOnRevision)
                    }
                    onResolveDraft={(nextModelId, personalConfig) =>
                      providerSettingsService.resolveModelConfig({
                        providerId,
                        originalModelId: model.modelId,
                        modelId: nextModelId,
                        personalConfig: structuredClone(personalConfig),
                      })
                    }
                    settingsRevision={settingsRevision}
                    onDelete={() => onDeleteModel(model.modelId)}
                    onEnabledChange={(enabled) => {
                      void Promise.resolve(onModelEnabledChange?.(model.modelId, enabled)).catch(
                        () => undefined,
                      );
                    }}
                    onTest={onTestModel}
                  />
                  {!completeProperties && (
                    <div className="px-3 pb-2 text-ui-sm text-destructive">
                      {model.issues?.[0]?.message ??
                        intl.formatMessage({ id: "settings.modelProvider.modelConfigIncomplete" })}
                    </div>
                  )}
                </>
              );
            }}
          />
        </div>
      ) : (
        <div className="mt-1 flex h-12 items-center justify-start gap-2 rounded-lg border border-dashed border-border px-4 text-left text-ui-base text-foreground-subtle">
          <InfoIcon className="size-4 shrink-0" aria-hidden="true" />
          {intl.formatMessage({ id: "settings.modelProvider.modelsEmpty" })}
        </div>
      )}
      <>
        <ProviderModelMetadataDialog
          onRestore={() => {
            setAddDraftErrorField(null);
            setAddCommitError(null);
            void editor
              .restore()
              .catch((error) =>
                setAddCommitError(error instanceof Error ? error.message : String(error)),
              );
          }}
          mode="add"
          open={addDialogOpen}
          draft={addDraft}
          draftErrorMessage={addCommitError ?? addDraftErrorMessage}
          draftErrorField={addDraftErrorField}
          inheritedConfig={editor.inheritedConfig}
          overrideFields={editor.overrides}
          onOpenChange={handleAddDialogOpenChange}
          onDraftChange={updateAddDraft}
          onCommit={commitAddDraft}
          saving={addSaving}
          modelConfigResolutionPending={editor.pending}
          modelDefaultsLoaded={editor.defaultsLoaded}
          onModelIdBlur={() => {
            void editor.flush().catch(() => undefined);
          }}
        />
        {onFetchUpstreamModels && onImportUpstreamModels && (
          <UpstreamModelsImportDialog
            open={importDialogOpen}
            onOpenChange={setImportDialogOpen}
            providerId={providerId}
            existingModelIds={models.map((model) => model.modelId)}
            onFetchUpstreamModels={onFetchUpstreamModels}
            onImportModels={onImportUpstreamModels}
          />
        )}
      </>
    </div>
  );
}
