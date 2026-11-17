/* eslint-disable max-lines -- 与上游 settings/* 同构的卡片较多，单文件承载（channels.ts 同款豁免） */
/**
 * DSH 桌宠设置面板（1:1 移植 dsh-pet 设置页：src/client/settings/*）。
 *
 * 结构与上游一致：桌宠配置标题 → 宠物列表条（每只一个 tab + 添加宠物）→
 * 宠物配置卡（名字/大小/显示位置/位置/偏移/四个功能开关/实例人设）→ 全局开关卡 →
 * 外观与字体卡 → AI 模型与对话上下文卡 → 物理（拖拽抛掷手感）卡 → 操作区（保存/同步/测试通知）。
 * 保存整包写入（上游 PUT /config 同语义），Ctrl+S / Cmd+S 也可保存；删除/同步走确认弹窗。
 *
 * 余额 / 碎碎念 / 对话三块只落配置：XCode 桌宠还没有接 AI 生成与余额数据，行为随后补。
 * 字段名与取值域和桌面端 `shared/dshPetConfig.ts` 完全一致。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Card, CardContent } from "@/components/ui/card.js";
import { DshPetAssetsCard } from "@/settings/DshPetAssetsCard.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { Input } from "@/components/ui/input.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { useServices } from "@/hooks/useServices.js";

/** 与 desktop `shared/dshPetConfig.ts` 保持同形（ui 包不依赖 desktop 源码）。 */
type DshPetCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type DshPetDisplay = "web" | "desktop" | "both" | "none";

interface DshPetPhysics {
  gravity: number;
  restitution: number;
  groundFriction: number;
  throwPower: number;
  ceilingBounce: boolean;
  petCollision: boolean;
}

interface DshPetEntry {
  id: string;
  name: string;
  /** 自制宠物包（userData/dsh-pet/packs/<packId>）：空 = 内置蓝毛小女仆。 */
  packId?: string;
  size: number;
  balanceEnabled: boolean;
  whisperEnabled: boolean;
  workStatusEnabled: boolean;
  fixedEnabled: boolean;
  display: DshPetDisplay;
  position: { corner: DshPetCorner; marginX: number; marginY: number };
  whisperPrompt?: string;
}

interface DshPetFontConfig {
  family: string;
  size: number;
  followPet: boolean;
}

interface DshPetModelSelection {
  provider: string;
  model: string;
}

interface DshPetConfig {
  /** 桌宠总开关：false = 不创建任何宠物窗口（默认值）。 */
  enabled: boolean;
  pets: DshPetEntry[];
  whisperPrompt: string;
  notificationsEnabled: boolean;
  clickSoundEnabled: boolean;
  whisperImageEnabled: boolean;
  chatImageEnabled: boolean;
  confineToScreen: boolean;
  trayEnabled: boolean;
  chatMemoryRounds: number;
  chatImageLimit: number;
  whisperModel: DshPetModelSelection;
  chatModel: DshPetModelSelection;
  physics: DshPetPhysics;
  font: DshPetFontConfig;
  eventsRefreshSec: { balance: number; whisper: number };
  animationWeights: { idle: number; turn: number; move: number };
}

type DshPetBridge = {
  getConfig: () => Promise<DshPetConfig>;
  setConfig: (patch: Partial<DshPetConfig>) => Promise<DshPetConfig>;
  getMeta?: () => Promise<{ userConfig: string; memoryDir: string }>;
  listPacks?: () => Promise<Array<{ id: string; name: string }>>;
  onConfig: (callback: (config: DshPetConfig) => void) => () => void;
};

type DshPetMeta = { userConfig: string; memoryDir: string };

type DshPetConfigBridgeWindow = Window & {
  zcode?: { dshPetOverlay?: DshPetBridge };
};

const CORNERS: DshPetCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
/** XCode 桌宠没有浏览器 overlay：显示位置只剩「桌面 / 不显示」两项；
 * 旧配置里的 web / both 由数据层归一为桌面。 */
const DISPLAYS: DshPetDisplay[] = ["desktop", "none"];
const SIZE_MIN = 120;
const SIZE_MAX = 1200;
const SIZE_STEP = 10;
const FONT_SIZE_MIN = 4;
const FONT_SIZE_MAX = 200;
const FONT_PRESETS: { id: string }[] = [
  { id: "candy" },
  { id: "yahei" },
  { id: "youyuan" },
  { id: "kaiti" },
  { id: "simsun" },
  { id: "comic" },
  { id: "system" },
];

/** 与主进程 DSH_PET_DEFAULT_CONFIG 对齐的兜底值：任何缺字段的旧载荷都不会让面板崩掉。 */
const CONFIG_DEFAULTS: DshPetConfig = {
  enabled: false,
  pets: [
    {
      id: "main",
      name: "蓝毛小女仆",
      size: 462,
      balanceEnabled: true,
      whisperEnabled: true,
      workStatusEnabled: true,
      fixedEnabled: false,
      display: "desktop",
      position: { corner: "top-right", marginX: 24, marginY: 100 },
    },
  ],
  whisperPrompt:
    "你是主人桌面上的Q版蓝发小女仆，会时不时碎碎念一句。说话要自然随意、短短一句（20字以内），温柔乖巧带点俏皮，说人话不啰嗦，不要解释你自己，不要提你是AI。",
  notificationsEnabled: true,
  clickSoundEnabled: false,
  whisperImageEnabled: true,
  chatImageEnabled: true,
  confineToScreen: false,
  trayEnabled: true,
  chatMemoryRounds: 5,
  chatImageLimit: 10,
  whisperModel: { provider: "", model: "" },
  chatModel: { provider: "", model: "" },
  physics: {
    gravity: 1400,
    restitution: 0.78,
    groundFriction: 2.5,
    throwPower: 1,
    ceilingBounce: true,
    petCollision: false,
  },
  font: { family: "candy", size: 21, followPet: true },
  eventsRefreshSec: { balance: 1800, whisper: 300 },
  animationWeights: { idle: 10, turn: 5, move: 5 },
};

const normalizeConfig = (raw: Partial<DshPetConfig> | null | undefined): DshPetConfig => {
  // 与主进程 normalizeDshPetConfig 同语义：删空 pets 是合法的「收起」状态，
  // 只有字段完全缺失（首次加载 / 旧配置）才回落到默认宠物。
  const pets =
    Array.isArray(raw?.pets)
      ? raw.pets.map((pet, index) => ({
          ...CONFIG_DEFAULTS.pets[0]!,
          ...pet,
          position: { ...CONFIG_DEFAULTS.pets[0]!.position, ...pet.position },
          id: pet.id || `pet-${index + 1}`,
        }))
      : CONFIG_DEFAULTS.pets.map((pet) => ({ ...pet, position: { ...pet.position } }));
  return {
    ...CONFIG_DEFAULTS,
    ...raw,
    // 旧配置缺字段一律按「关闭」处理，避免升级后自动弹出桌宠。
    enabled: raw?.enabled === true,
    pets,
    whisperModel: { ...CONFIG_DEFAULTS.whisperModel, ...raw?.whisperModel },
    chatModel: { ...CONFIG_DEFAULTS.chatModel, ...raw?.chatModel },
    physics: { ...CONFIG_DEFAULTS.physics, ...raw?.physics },
    font: { ...CONFIG_DEFAULTS.font, ...raw?.font },
    eventsRefreshSec: { ...CONFIG_DEFAULTS.eventsRefreshSec, ...raw?.eventsRefreshSec },
    animationWeights: { ...CONFIG_DEFAULTS.animationWeights, ...raw?.animationWeights },
  };
};

type ValidationKey =
  | "invalid"
  | "invalidPhysics"
  | "invalidFont"
  | "invalidModel"
  | "invalidChatMemory"
  | "invalidChatImageLimit";

/** 校验（与主进程 validateDshPetForm 同语义）。 */
function validateForm(draft: DshPetConfig): ValidationKey | null {
  if (draft.pets.some((pet) => !Number.isFinite(pet.size) || pet.size <= 0)) return "invalid";
  if (
    draft.pets.some(
      (pet) => !Number.isFinite(pet.position.marginX) || !Number.isFinite(pet.position.marginY),
    )
  ) {
    return "invalid";
  }
  const { gravity, restitution, groundFriction, throwPower } = draft.physics;
  if (
    !Number.isFinite(gravity) ||
    gravity < 0 ||
    !Number.isFinite(groundFriction) ||
    groundFriction < 0 ||
    !Number.isFinite(restitution) ||
    restitution < 0 ||
    restitution > 1 ||
    !Number.isFinite(throwPower) ||
    throwPower <= 0
  ) {
    return "invalidPhysics";
  }
  if (
    !Number.isFinite(draft.font.size) ||
    draft.font.size < FONT_SIZE_MIN ||
    draft.font.size > FONT_SIZE_MAX
  ) {
    return "invalidFont";
  }
  const pairValid = (selection: DshPetModelSelection): boolean =>
    Boolean(selection.provider) === Boolean(selection.model);
  if (!pairValid(draft.whisperModel) || !pairValid(draft.chatModel)) return "invalidModel";
  if (!Number.isFinite(draft.chatMemoryRounds) || draft.chatMemoryRounds < 0) {
    return "invalidChatMemory";
  }
  if (!Number.isFinite(draft.chatImageLimit) || draft.chatImageLimit < 0) {
    return "invalidChatImageLimit";
  }
  return null;
}

/** 问号说明气泡（上游 `dsh-pet-cfg__q` 的等价实现）。 */
function QuestionHint({ hint }: { hint: string }): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={hint}
          tabIndex={-1}
          className="inline-flex size-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-foreground-subtle text-foreground-subtle"
        >
          <HelpCircle className="size-2.5" aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-left leading-5">{hint}</TooltipContent>
    </Tooltip>
  );
}

/** 卡片头：标题 + 问号说明；右侧动作由调用方追加（上游 cardHead）。 */
function CardHead({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex min-h-5 items-center gap-1.5">
      <span className="text-ui-base font-semibold text-foreground">{title}</span>
      {hint ? <QuestionHint hint={hint} /> : null}
      {children ? <div className="ml-auto flex items-center gap-2">{children}</div> : null}
    </div>
  );
}

/** 一个字段：标签（可带问号）在上、控件在下（上游 field）。 */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="inline-flex items-center gap-1.5 text-ui-sm text-foreground-subtle">
        {label}
        {hint ? <QuestionHint hint={hint} /> : null}
      </span>
      {children}
    </div>
  );
}

const selectClass =
  "h-9 w-full rounded-md border border-border bg-background px-2 text-ui-base text-foreground outline-none focus-visible:border-ring";

/** 开关一格（上游 toggleCell）：勾选框 + 标题，说明挂在问号上。 */
function ToggleCell({
  label,
  hint,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (value: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-2 text-ui-base text-foreground">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <label className="min-w-0 cursor-pointer break-words" onClick={() => onCheckedChange(!checked)}>
        {label}
      </label>
      <QuestionHint hint={hint} />
    </div>
  );
}

/** 数字输入（上游 numInput）。 */
function NumberField({
  value,
  disabled,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number;
  disabled: boolean;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}): React.JSX.Element {
  return (
    <Input
      type="number"
      value={Number.isFinite(value) ? String(value) : ""}
      disabled={disabled}
      min={min}
      max={max}
      step={step}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

/** 宠物字段补丁（上游 pet-card.ts PetPatch）：position 只带要改的子字段。 */
type PetPatch = Partial<Omit<DshPetEntry, "position">> & {
  position?: Partial<DshPetEntry["position"]>;
};

type DialogState =
  | null
  | { kind: "remove"; petId: string }
  | { kind: "lastOne" }
  | { kind: "sync" };

/** 确认弹窗（上游 dialog.ts：遮罩 + 居中卡片 + 按钮；lastOne 只给「知道了」）。 */
function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  infoOnly,
  onDismiss,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger: boolean;
  infoOnly: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  return (
    <div
      className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/45"
      onClick={onDismiss}
    >
      <div
        className="flex w-[340px] max-w-[calc(100vw-40px)] flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="text-ui-base font-medium text-foreground">{title}</div>
        <div className="text-ui-sm leading-5 text-foreground-subtle">{body}</div>
        <div className="flex justify-end gap-2">
          {infoOnly ? (
            <Button type="button" size="sm" onClick={onDismiss}>
              {confirmLabel}
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" size="sm" onClick={onDismiss}>
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                variant={danger ? "destructive" : "default"}
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface ModelChoiceGroup {
  providerId: string;
  providerName: string;
  models: string[];
}

/**
 * 模型选择器（上游 settings/picker 的等价实现）：可搜索的浮层清单，
 * 按服务商分组，首项「跟随当前对话」；选中后回写 {provider, model}。
 */
function DshPetModelPicker(props: {
  value: DshPetModelSelection;
  disabled: boolean;
  groups: ModelChoiceGroup[];
  failed: boolean;
  onChange: (next: DshPetModelSelection) => void;
}): React.JSX.Element {
  const { intl } = useXCodeIntl();
  const t = useCallback((id: string): string => intl.formatMessage({ id }), [intl]);
  const [open, setOpen] = useState(false);
  const providerName =
    props.groups.find((group) => group.providerId === props.value.provider)?.providerName ??
    props.value.provider;
  const label = props.value.model ? `${providerName} / ${props.value.model}` : t("settings.dshPet.model.follow");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={props.disabled}
          className="w-full min-w-0 justify-between gap-2 font-normal"
        >
          <span className="truncate">{label}</span>
          <span className="text-foreground-subtle">▾</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command>
          <CommandInput placeholder={t("settings.dshPet.model.search")} />
          <CommandList>
            <CommandEmpty>{t("settings.dshPet.model.empty")}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__follow__ 跟随当前对话"
                onSelect={() => {
                  props.onChange({ provider: "", model: "" });
                  setOpen(false);
                }}
              >
                {t("settings.dshPet.model.follow")}
              </CommandItem>
            </CommandGroup>
            {props.groups.map((group) => (
              <CommandGroup key={group.providerId} heading={group.providerName}>
                {group.models.map((model) => (
                  <CommandItem
                    key={`${group.providerId}/${model}`}
                    value={`${group.providerName} ${group.providerId} ${model}`}
                    onSelect={() => {
                      props.onChange({ provider: group.providerId, model });
                      setOpen(false);
                    }}
                  >
                    {model}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function DshPetSettingsSection(): React.JSX.Element {
  const { intl } = useXCodeIntl();
  const t = useCallback((id: string): string => intl.formatMessage({ id }), [intl]);
  // 模型目录来自宿主的模型选择视图（与「跟随当前对话」同一份来源）：分组 = 服务商。
  const services = useServices();
  const [modelChoices, setModelChoices] = useState<ModelChoiceGroup[]>([]);
  useEffect(() => {
    let disposed = false;
    void services.modelSelectionService
      .getView()
      .then((view) => {
        if (disposed) return;
        setModelChoices(
          view.providers.map((provider) => ({
            providerId: String(provider.providerId),
            providerName: String(provider.providerName ?? provider.providerId),
            models: provider.models.map((model) => String(model.modelId)),
          })),
        );
      })
      .catch(() => {
        if (!disposed) setCatalogFailed(true);
      });
    return () => {
      disposed = true;
    };
  }, [services]);
  const bridge = (
    typeof window !== "undefined"
      ? (window as unknown as DshPetConfigBridgeWindow).zcode?.dshPetOverlay
      : undefined
  ) satisfies DshPetBridge | undefined;

  const [saved, setSaved] = useState<DshPetConfig | null>(null);
  const [draft, setDraft] = useState<DshPetConfig | null>(null);
  const [selId, setSelId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | ""; text: string }>({ kind: "", text: "" });
  const [permMsg, setPermMsg] = useState<{ kind: "ok" | "err" | ""; text: string }>({
    kind: "",
    text: "",
  });
  const [dialog, setDialog] = useState<DialogState>(null);
  const [loadError, setLoadError] = useState(false);
  const [meta, setMeta] = useState<DshPetMeta | null>(null);
  const [packs, setPacks] = useState<Array<{ id: string; name: string }>>([]);
  const [catalogFailed, setCatalogFailed] = useState(false);

  const dirty = useMemo(
    () => draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved],
  );

  /** 读一次配置（首次进入与「重试」共用）。 */
  const reloadConfig = useCallback((): void => {
    if (!bridge) return;
    setLoadError(false);
    void bridge
      .getConfig()
      .then((value) => {
        const next = normalizeConfig(value);
        setSaved(next);
        setDraft(next);
        setSelId((current) =>
          next.pets.some((pet) => pet.id === current) ? current : (next.pets[0]?.id ?? ""),
        );
      })
      .catch(() => setLoadError(true));
    void bridge
      .getMeta?.()
      .then((value) => setMeta(value))
      .catch(() => setMeta(null));
    void bridge
      .listPacks?.()
      .then((value) => setPacks(value))
      .catch(() => setPacks([]));
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    let disposed = false;
    reloadConfig();
    const unsubscribe = bridge.onConfig((incoming) => {
      if (disposed) return;
      const next = normalizeConfig(incoming);
      setSaved(next);
      // 外部变更（右键菜单等）不覆盖正在编辑的草稿。
      setDraft((current) =>
        current === null || JSON.stringify(current) === JSON.stringify(next) ? next : current,
      );
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [bridge]);

  const updatePet = useCallback(
    (petId: string, patch: PetPatch) => {
      setDraft((current) =>
        current === null
          ? current
          : {
              ...current,
              pets: current.pets.map((pet) =>
                pet.id === petId
                  ? {
                      ...pet,
                      ...patch,
                      position: patch.position
                        ? { ...pet.position, ...patch.position }
                        : pet.position,
                    }
                  : pet,
              ),
            },
      );
      setMsg({ kind: "", text: "" });
    },
    [],
  );

  const updateGlobal = useCallback((patch: Partial<DshPetConfig>) => {
    setDraft((current) => (current === null ? current : { ...current, ...patch }));
    setMsg({ kind: "", text: "" });
  }, []);

  const addPet = useCallback(() => {
    setDraft((current) => {
      if (current === null) return current;
      const existing = new Set(current.pets.map((pet) => pet.id));
      let n = 2;
      while (existing.has(`pet-${n}`)) n += 1;
      const id = `pet-${n}`;
      const template = current.pets[0]!;
      const draftPet = {
        ...template,
        id,
        name: id,
        position: { ...template.position },
        whisperPrompt: undefined,
      };
      setSelId(id);
      return { ...current, pets: [...current.pets, draftPet] };
    });
    setMsg({ kind: "", text: "" });
  }, []);

  const removePet = useCallback((petId: string) => {
    setDraft((current) => {
      if (current === null) return current;
      const pets = current.pets.filter((pet) => pet.id !== petId);
      setSelId((id) => (id === petId ? (pets[0]?.id ?? "") : id));
      return { ...current, pets };
    });
    setDialog(null);
    setMsg({ kind: "", text: "" });
  }, []);

  const save = useCallback(async (): Promise<void> => {
    if (!bridge || draft === null || busy) return;
    const invalid = validateForm(draft);
    if (invalid !== null) {
      setMsg({ kind: "err", text: t(`settings.dshPet.${invalid}`) });
      return;
    }
    setBusy(true);
    try {
      const next = normalizeConfig(await bridge.setConfig(draft));
      setSaved(next);
      setDraft(next);
      setMsg({ kind: "ok", text: t("settings.dshPet.saved") });
    } catch {
      setMsg({ kind: "err", text: t("settings.dshPet.saveError") });
    } finally {
      setBusy(false);
    }
  }, [bridge, busy, draft, t]);

  const syncToDefaults = useCallback(async (): Promise<void> => {
    if (!bridge || busy) return;
    setDialog(null);
    setBusy(true);
    try {
      const defaults = normalizeConfig(CONFIG_DEFAULTS);
      const next = normalizeConfig(await bridge.setConfig(defaults));
      setSaved(next);
      setDraft(next);
      setSelId((current) =>
        next.pets.some((pet) => pet.id === current) ? current : (next.pets[0]?.id ?? ""),
      );
      setMsg({ kind: "ok", text: t("settings.dshPet.saved") });
    } catch {
      setMsg({ kind: "err", text: t("settings.dshPet.syncError") });
    } finally {
      setBusy(false);
    }
  }, [bridge, busy, t]);

  // 上游设置页的 Ctrl+S / Cmd+S 保存。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      void save();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [save]);

  const testNotification = useCallback((): void => {
    try {
      if (typeof Notification === "undefined") {
        setPermMsg({ kind: "err", text: t("settings.dshPet.notifyDenyUnsupported") });
        return;
      }
      const notice = new Notification("XCode 桌宠", {
        body: t("settings.dshPet.notifyTestOk"),
      });
      (notice as unknown as { show?: () => void }).show?.();
      setPermMsg({ kind: "ok", text: t("settings.dshPet.notifyTestOk") });
    } catch {
      setPermMsg({ kind: "err", text: t("settings.dshPet.notifyDenyUnsupported") });
    }
  }, [t]);

  const selectedPet = useMemo(
    () => draft?.pets.find((pet) => pet.id === selId) ?? draft?.pets[0] ?? null,
    [draft, selId],
  );

  if (!bridge) {
    return <p className="text-ui-sm text-foreground-subtle">{t("settings.dshPet.unavailable")}</p>;
  }

  if (draft === null) {
    return (
      <div className="flex flex-wrap items-center gap-2" role={loadError ? "alert" : "status"}>
        <span className="text-ui-sm text-foreground-subtle">
          {t(loadError ? "settings.dshPet.loadError" : "settings.dshPet.loading")}
        </span>
        {loadError ? (
          <Button type="button" size="sm" variant="outline" onClick={reloadConfig}>
            {t("settings.dshPet.retry")}
          </Button>
        ) : null}
      </div>
    );
  }

  const disabled = busy;
  const invalid = validateForm(draft);
  const canSave = !busy && dirty && invalid === null;
  const feedback =
    msg.text !== ""
      ? { ...msg }
      : invalid !== null
        ? { kind: "err" as const, text: t(`settings.dshPet.${invalid}`) }
        : { kind: "" as const, text: "" };

  return (
    <div className="flex flex-col gap-3">
      <CardHead title={t("settings.dshPet.title")} hint={t("settings.dshPet.titleHint")} />

      {/* 宠物列表条（上游 petTabs：每只一个 tab；种类条在 XCode 只有一个内置种类，省略） */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ui-sm text-foreground-subtle">{t("settings.dshPet.petsLabel")}</span>
        {draft.pets.map((pet) => (
          <button
            key={pet.id}
            type="button"
            className={
              pet.id === selectedPet?.id
                ? "rounded-md border border-ring bg-input/50 px-3 py-1 text-ui-sm text-foreground"
                : "rounded-md border border-border bg-transparent px-3 py-1 text-ui-sm text-foreground hover:bg-hover"
            }
            onClick={() => setSelId(pet.id)}
          >
            {`${pet.name || pet.id} (${pet.size}px)`}
          </button>
        ))}
        <button
          type="button"
          className="rounded-md border border-dashed border-border bg-transparent px-3 py-1 text-ui-sm text-foreground-subtle hover:bg-hover"
          onClick={addPet}
        >
          + {t("settings.dshPet.add")}
        </button>
      </div>

      {selectedPet ? (
        <Card className="border border-border bg-card py-0 shadow-none">
          <CardContent className="flex flex-col gap-3 px-4 py-3">
            <CardHead
              title={t("settings.dshPet.petCard.title")}
              hint={t("settings.dshPet.petCard.hint")}
            >
              {msg.text ? (
                <span
                  className={`text-ui-sm ${msg.kind === "err" ? "text-destructive" : "text-foreground-subtle"}`}
                >
                  {msg.text}
                </span>
              ) : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" size="sm" disabled={!canSave} onClick={() => void save()}>
                    {t(busy ? "settings.dshPet.saving" : "settings.dshPet.save")}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("settings.dshPet.saveHotkey")}</TooltipContent>
              </Tooltip>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={disabled}
                onClick={() =>
                  draft.pets.length <= 1
                    ? setDialog({ kind: "lastOne" })
                    : setDialog({ kind: "remove", petId: selectedPet.id })
                }
              >
                {t("settings.dshPet.remove")}
              </Button>
            </CardHead>

            <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-3">
              <Field label={t("settings.dshPet.name.label")} hint={t("settings.dshPet.name.hint")}>
                <Input
                  type="text"
                  maxLength={50}
                  value={selectedPet.name}
                  disabled={disabled}
                  onChange={(event) => updatePet(selectedPet.id, { name: event.target.value })}
                />
              </Field>
              <Field label={t("settings.dshPet.size.label")} hint={t("settings.dshPet.size.hint")}>
                <NumberField
                  value={selectedPet.size}
                  disabled={disabled}
                  min={SIZE_MIN}
                  max={SIZE_MAX}
                  step={SIZE_STEP}
                  onChange={(value) => updatePet(selectedPet.id, { size: Math.round(value) })}
                />
              </Field>
              <Field
                label={t("settings.dshPet.display.label")}
                hint={t("settings.dshPet.display.hint")}
              >
                <select
                  className={selectClass}
                  value={selectedPet.display}
                  disabled={disabled}
                  onChange={(event) =>
                    updatePet(selectedPet.id, { display: event.target.value as DshPetDisplay })
                  }
                >
                  {DISPLAYS.map((display) => (
                    <option key={display} value={display}>
                      {t(`settings.dshPet.display.${display}`)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-3">
              <Field label={t("settings.dshPet.pack.label")} hint={t("settings.dshPet.pack.hint")}>
                <select
                  className={selectClass}
                  value={selectedPet.packId ?? ""}
                  disabled={disabled}
                  onChange={(event) =>
                    updatePet(selectedPet.id, { packId: event.target.value })
                  }
                >
                  <option value="">{t("settings.dshPet.pack.builtin")}</option>
                  {packs.map((pack) => (
                    <option key={pack.id} value={pack.id}>
                      {pack.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={t("settings.dshPet.position.label")}
                hint={t("settings.dshPet.position.hint")}
              >
                <select
                  className={selectClass}
                  value={selectedPet.position.corner}
                  disabled={disabled}
                  onChange={(event) =>
                    updatePet(selectedPet.id, {
                      position: { corner: event.target.value as DshPetCorner },
                    })
                  }
                >
                  {CORNERS.map((corner) => (
                    <option key={corner} value={corner}>
                      {t(`settings.dshPet.corner.${corner}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={t("settings.dshPet.marginX.label")}
                hint={t("settings.dshPet.marginX.hint")}
              >
                <NumberField
                  value={selectedPet.position.marginX}
                  disabled={disabled}
                  onChange={(value) =>
                    updatePet(selectedPet.id, { position: { marginX: Math.round(value) } })
                  }
                />
              </Field>
              <Field
                label={t("settings.dshPet.marginY.label")}
                hint={t("settings.dshPet.marginY.hint")}
              >
                <NumberField
                  value={selectedPet.position.marginY}
                  disabled={disabled}
                  onChange={(value) =>
                    updatePet(selectedPet.id, { position: { marginY: Math.round(value) } })
                  }
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-x-4 gap-y-2 md:grid-cols-2">
              <ToggleCell
                label={t("settings.dshPet.toggle.balance")}
                hint={t("settings.dshPet.toggle.balanceHint")}
                checked={selectedPet.balanceEnabled}
                disabled={disabled}
                onCheckedChange={(value) => updatePet(selectedPet.id, { balanceEnabled: value })}
              />
              <ToggleCell
                label={t("settings.dshPet.toggle.whisper")}
                hint={t("settings.dshPet.toggle.whisperHint")}
                checked={selectedPet.whisperEnabled}
                disabled={disabled}
                onCheckedChange={(value) => updatePet(selectedPet.id, { whisperEnabled: value })}
              />
              <ToggleCell
                label={t("settings.dshPet.toggle.workStatus")}
                hint={t("settings.dshPet.toggle.workStatusHint")}
                checked={selectedPet.workStatusEnabled}
                disabled={disabled}
                onCheckedChange={(value) => updatePet(selectedPet.id, { workStatusEnabled: value })}
              />
              <ToggleCell
                label={t("settings.dshPet.toggle.fixed")}
                hint={t("settings.dshPet.toggle.fixedHint")}
                checked={selectedPet.fixedEnabled}
                disabled={disabled}
                onCheckedChange={(value) => updatePet(selectedPet.id, { fixedEnabled: value })}
              />
            </div>

            <Field
              label={t("settings.dshPet.persona.label")}
              hint={t("settings.dshPet.persona.hint")}
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <textarea
                  className="min-h-16 w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-ui-base leading-5 text-foreground outline-none focus-visible:border-ring"
                  rows={3}
                  value={selectedPet.whisperPrompt ?? ""}
                  disabled={disabled}
                  placeholder={draft.whisperPrompt}
                  onChange={(event) =>
                    updatePet(selectedPet.id, { whisperPrompt: event.target.value })
                  }
                />
                <span className="text-right text-ui-xs text-foreground-subtle">
                  {t("settings.dshPet.persona.count").replace(
                    "{n}",
                    String((selectedPet.whisperPrompt ?? "").length),
                  )}
                </span>
              </div>
            </Field>
          </CardContent>
        </Card>
      ) : (
        <p className="text-ui-sm text-foreground-subtle">{t("settings.dshPet.emptyPets")}</p>
      )}

      <Card className="border border-border bg-card py-0 shadow-none">
        <CardContent className="flex flex-col gap-3 px-4 py-3">
          <CardHead title={t("settings.dshPet.global.title")} hint={t("settings.dshPet.global.hint")} />
          <div className="grid grid-cols-1 gap-x-4 gap-y-2 md:grid-cols-2">
            <ToggleCell
              label={t("settings.dshPet.toggle.enabled")}
              hint={t("settings.dshPet.toggle.enabledHint")}
              checked={draft.enabled}
              disabled={disabled}
              onCheckedChange={(value) =>
                // 开启总开关 = 把宠物唤回桌面：所有宠物都在隐藏位时直接恢复桌面显示，
                // 否则用户勾选保存后桌面上什么都不会出现。
                value &&
                !draft.pets.some((pet) => pet.display === "desktop" || pet.display === "both")
                  ? updateGlobal({
                      enabled: true,
                      pets: draft.pets.map((pet) => ({ ...pet, display: "desktop" })),
                    })
                  : updateGlobal({ enabled: value })
              }
            />
            <ToggleCell
              label={t("settings.dshPet.toggle.notify")}
              hint={t("settings.dshPet.toggle.notifyHint")}
              checked={draft.notificationsEnabled}
              disabled={disabled}
              onCheckedChange={(value) => updateGlobal({ notificationsEnabled: value })}
            />
            <ToggleCell
              label={t("settings.dshPet.toggle.clickSound")}
              hint={t("settings.dshPet.toggle.clickSoundHint")}
              checked={draft.clickSoundEnabled}
              disabled={disabled}
              onCheckedChange={(value) => updateGlobal({ clickSoundEnabled: value })}
            />
            <ToggleCell
              label={t("settings.dshPet.toggle.whisperImage")}
              hint={t("settings.dshPet.toggle.whisperImageHint")}
              checked={draft.whisperImageEnabled}
              disabled={disabled}
              onCheckedChange={(value) => updateGlobal({ whisperImageEnabled: value })}
            />
            <ToggleCell
              label={t("settings.dshPet.toggle.chatImage")}
              hint={t("settings.dshPet.toggle.chatImageHint")}
              checked={draft.chatImageEnabled}
              disabled={disabled}
              onCheckedChange={(value) => updateGlobal({ chatImageEnabled: value })}
            />
            <ToggleCell
              label={t("settings.dshPet.toggle.confine")}
              hint={t("settings.dshPet.toggle.confineHint")}
              checked={draft.confineToScreen}
              disabled={disabled}
              onCheckedChange={(value) => updateGlobal({ confineToScreen: value })}
            />
            <ToggleCell
              label={t("settings.dshPet.toggle.tray")}
              hint={t("settings.dshPet.toggle.trayHint")}
              checked={draft.trayEnabled}
              disabled={disabled}
              onCheckedChange={(value) => updateGlobal({ trayEnabled: value })}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border bg-card py-0 shadow-none">
        <CardContent className="flex flex-col gap-3 px-4 py-3">
          <CardHead title={t("settings.dshPet.font.title")} hint={t("settings.dshPet.font.hint")} />
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
            <Field
              label={t("settings.dshPet.font.family.label")}
              hint={t("settings.dshPet.font.family.hint")}
            >
              <select
                className={selectClass}
                value={draft.font.family}
                disabled={disabled}
                onChange={(event) =>
                  updateGlobal({ font: { ...draft.font, family: event.target.value } })
                }
              >
                {FONT_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {t(`settings.dshPet.font.${preset.id}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={t("settings.dshPet.font.size.label")}
              hint={t("settings.dshPet.font.size.hint")}
            >
              <NumberField
                value={draft.font.size}
                disabled={disabled}
                min={FONT_SIZE_MIN}
                max={FONT_SIZE_MAX}
                step={1}
                onChange={(value) =>
                  updateGlobal({ font: { ...draft.font, size: Math.round(value) } })
                }
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-2 md:grid-cols-2">
            <ToggleCell
              label={t("settings.dshPet.toggle.fontFollow")}
              hint={t("settings.dshPet.toggle.fontFollowHint")}
              checked={draft.font.followPet}
              disabled={disabled}
              onCheckedChange={(value) =>
                updateGlobal({ font: { ...draft.font, followPet: value } })
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border bg-card py-0 shadow-none">
        <CardContent className="flex flex-col gap-3 px-4 py-3">
          <CardHead title={t("settings.dshPet.model.title")} hint={t("settings.dshPet.model.hint")} />
          {catalogFailed ? (
            <p className="text-ui-sm text-destructive">{t("settings.dshPet.model.catalogFailed")}</p>
          ) : null}
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
            <Field
              label={t("settings.dshPet.model.whisper.label")}
              hint={t("settings.dshPet.model.field.hint")}
            >
              <DshPetModelPicker
                value={draft.whisperModel}
                disabled={disabled}
                groups={modelChoices}
                failed={catalogFailed}
                onChange={(next) => updateGlobal({ whisperModel: next })}
              />
            </Field>
            <Field
              label={t("settings.dshPet.model.chat.label")}
              hint={t("settings.dshPet.model.field.hint")}
            >
              <DshPetModelPicker
                value={draft.chatModel}
                disabled={disabled}
                groups={modelChoices}
                failed={catalogFailed}
                onChange={(next) => updateGlobal({ chatModel: next })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
            <Field
              label={t("settings.dshPet.model.chatMemory.label")}
              hint={t("settings.dshPet.model.chatMemory.hint")}
            >
              <NumberField
                value={draft.chatMemoryRounds}
                disabled={disabled}
                min={0}
                onChange={(value) => updateGlobal({ chatMemoryRounds: Math.round(value) })}
              />
            </Field>
            <Field
              label={t("settings.dshPet.model.chatImageLimit.label")}
              hint={t("settings.dshPet.model.chatImageLimit.hint")}
            >
              <NumberField
                value={draft.chatImageLimit}
                disabled={disabled}
                min={0}
                onChange={(value) => updateGlobal({ chatImageLimit: Math.round(value) })}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border bg-card py-0 shadow-none">
        <CardContent className="flex flex-col gap-3 px-4 py-3">
          <CardHead
            title={t("settings.dshPet.physics.title")}
            hint={t("settings.dshPet.physics.hint")}
          />
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-4">
            <Field
              label={t("settings.dshPet.physics.gravity")}
              hint={t("settings.dshPet.physics.gravityHint")}
            >
              <NumberField
                value={draft.physics.gravity}
                disabled={disabled}
                min={0}
                step={50}
                onChange={(value) =>
                  updateGlobal({ physics: { ...draft.physics, gravity: value } })
                }
              />
            </Field>
            <Field
              label={t("settings.dshPet.physics.restitution")}
              hint={t("settings.dshPet.physics.restitutionHint")}
            >
              <NumberField
                value={draft.physics.restitution}
                disabled={disabled}
                min={0}
                step={0.01}
                onChange={(value) =>
                  updateGlobal({ physics: { ...draft.physics, restitution: value } })
                }
              />
            </Field>
            <Field
              label={t("settings.dshPet.physics.groundFriction")}
              hint={t("settings.dshPet.physics.groundFrictionHint")}
            >
              <NumberField
                value={draft.physics.groundFriction}
                disabled={disabled}
                min={0}
                step={0.1}
                onChange={(value) =>
                  updateGlobal({ physics: { ...draft.physics, groundFriction: value } })
                }
              />
            </Field>
            <Field
              label={t("settings.dshPet.physics.throwPower")}
              hint={t("settings.dshPet.physics.throwPowerHint")}
            >
              <NumberField
                value={draft.physics.throwPower}
                disabled={disabled}
                min={0.05}
                step={0.05}
                onChange={(value) =>
                  updateGlobal({ physics: { ...draft.physics, throwPower: value } })
                }
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-2 md:grid-cols-2">
            <ToggleCell
              label={t("settings.dshPet.physics.ceilingBounce")}
              hint={t("settings.dshPet.physics.ceilingBounceHint")}
              checked={draft.physics.ceilingBounce}
              disabled={disabled}
              onCheckedChange={(value) =>
                updateGlobal({ physics: { ...draft.physics, ceilingBounce: value } })
              }
            />
            <ToggleCell
              label={t("settings.dshPet.physics.petCollision")}
              hint={t("settings.dshPet.physics.petCollisionHint")}
              checked={draft.physics.petCollision}
              disabled={disabled}
              onCheckedChange={(value) =>
                updateGlobal({ physics: { ...draft.physics, petCollision: value } })
              }
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" disabled={!canSave} onClick={() => void save()}>
              {t(busy ? "settings.dshPet.saving" : "settings.dshPet.save")}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("settings.dshPet.saveHotkey")}</TooltipContent>
        </Tooltip>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => setDialog({ kind: "sync" })}
        >
          {t("settings.dshPet.sync")}
        </Button>
        <Button type="button" variant="outline" onClick={testNotification}>
          {t("settings.dshPet.notifyTest")}
        </Button>
        {feedback.text ? (
          <span
            className={`text-ui-sm ${feedback.kind === "err" ? "text-destructive" : "text-foreground-subtle"}`}
          >
            {feedback.text}
          </span>
        ) : null}
        {permMsg.text ? (
          <span
            className={`text-ui-sm ${permMsg.kind === "err" ? "text-destructive" : "text-foreground-subtle"}`}
          >
            {permMsg.text}
          </span>
        ) : null}
      </div>

      {/* 素材包：内置只带核心动作，完整素材按需下载（镜像自动测速择优）。 */}
      <DshPetAssetsCard />

      {meta ? (
        <Card className="border border-border bg-card py-0 shadow-none">
          <CardContent className="flex flex-col gap-2 px-4 py-3">
            <CardHead
              title={t("settings.dshPet.paths.title")}
              hint={t("settings.dshPet.paths.hint")}
            />
            {[
              [t("settings.dshPet.paths.userConfig"), meta.userConfig],
              [t("settings.dshPet.paths.memoryDir"), meta.memoryDir],
            ].map(([label, value]) => (
              <div key={label} className="flex min-w-0 flex-wrap items-baseline gap-2 text-ui-sm">
                <span className="shrink-0 text-foreground-subtle">{label}：</span>
                <code className="min-w-0 select-text break-all font-mono text-ui-xs text-foreground">
                  {value}
                </code>
              </div>
            ))}
            <p className="text-ui-xs text-foreground-subtle">{t("settings.dshPet.paths.note")}</p>
          </CardContent>
        </Card>
      ) : null}

      {dialog ? (
        <ConfirmDialog
          title={t("settings.dshPet.confirmTitle")}
          body={
            dialog.kind === "remove"
              ? t("settings.dshPet.confirmRemove").replace("{id}", dialog.petId)
              : dialog.kind === "lastOne"
                ? t("settings.dshPet.atLeastOne")
                : t("settings.dshPet.confirmSync")
          }
          confirmLabel={
            dialog.kind === "sync" ? t("settings.dshPet.sync") : t("settings.dshPet.remove")
          }
          danger={dialog.kind !== "sync"}
          infoOnly={dialog.kind === "lastOne"}
          onDismiss={() => setDialog(null)}
          onConfirm={() => {
            if (dialog.kind === "remove") removePet(dialog.petId);
            else if (dialog.kind === "sync") void syncToDefaults();
            else setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}
