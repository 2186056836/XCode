/**
 * 桌宠设置页（复刻 Codex Pets 页面）。
 *
 * 页面结构对齐官方：标题「宠物」→「选择宠物」+ 描述 + 刷新/创建/唤醒动作组 →
 * 宠物列表卡片（动画 idle 头像 + 名称 + 描述 + 选择/已选）→ 自定义宠物区
 * （导入 Codex 宠物 ZIP 包，列表语义与内置一致 + 删除）。
 * 数据经 window.zcode.petOverlay 桥直达 main 进程控制器。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Trash2, Upload } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.js";
import { Button } from "@/components/ui/button.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { DshPetSettingsSection } from "@/settings/DshPetSettingsSection.js";
import type { CreateTaskOptions } from "@/app-shell/types.js";

interface PetConfig {
  enabled: boolean;
  petId: string;
  sizePx: number;
}

interface CustomPetEntry {
  id: string;
  displayName: string;
  description: string;
}

/** ui 包单独 typecheck 拿不到 desktop renderer 的完整 window.zcode 声明，本地窄类型。 */
type PetBridgeWindow = Window & {
  zcode?: {
    selectFile?: () => Promise<string | null>;
    petOverlay?: {
      getConfig(): Promise<PetConfig>;
      setConfig(patch: Partial<PetConfig>): Promise<PetConfig>;
      toggle(): Promise<PetConfig>;
      onConfig(callback: (config: PetConfig) => void): () => void;
      setState(state: string, attentionCount?: number, source?: string): void;
      installHatchPetSkill(): Promise<string>;
      listCustomPets(): Promise<CustomPetEntry[]>;
      prepareCustomPetZipImport(zipPath: string): Promise<
        | {
            manifest: {
              displayName: string;
              description: string;
              suggestedId: string;
              declaredRows: number;
            };
            spriteBase64: string;
            spriteMime: string;
          }
        | { error: string }
      >;
      commitCustomPetImport(input: {
        displayName: string;
        description: string;
        suggestedId: string;
        rows: number;
        pngBase64: string;
      }): Promise<{ id: string } | { error: string }>;
      importCustomPetZip(zipPath: string): Promise<{ id: string } | { error: string }>;
      deleteCustomPet(petId: string): Promise<void>;
      getCustomSpriteDataUrl(petId: string): Promise<string | null>;
    };
  };
};

/** 官方宠物清单（文案逐字取自 Codex app.asar 的 N7e 表）。 */
const OFFICIAL_PETS: Array<{ id: string; displayName: string; description: string }> = [
  { id: "codex", displayName: "Codex", description: "The original Codex companion." },
  {
    id: "dewey",
    displayName: "Dewey",
    description: "A calm companion for focused workspace days",
  },
  { id: "fireball", displayName: "Fireball", description: "Hot path energy for fast iteration." },
  {
    id: "hoots",
    displayName: "Hoots",
    description: "A sharp-eyed owl for polished work in a blink.",
  },
  { id: "rocky", displayName: "Rocky", description: "A steady rock when the diff gets large." },
  { id: "seedy", displayName: "Seedy", description: "Small green shoots for new ideas." },
  { id: "stacky", displayName: "Stacky", description: "A balanced stack for deep work." },
  { id: "bsod", displayName: "BSOD", description: "A tiny blue-screen gremlin." },
  { id: "null-signal", displayName: "Null Signal", description: "Quiet signal from the void." },
];

const SPRITE_COLUMNS = 8;
const SPRITE_ROWS = 11;
const CELL_ASPECT = 208 / 192;
const IDLE_DURATION_SLOWDOWN = 6;

/** 列表头像：循环播放 idle 帧（官方 idle ×6 慢速，与悬浮窗一致）。 */
function PetAvatarSprite({
  petId,
  sizePx,
  spriteSrc,
}: {
  petId: string;
  sizePx: number;
  spriteSrc?: string | null;
}) {
  const frameRef = useRef(0);
  const elementRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const draw = (column: number): void => {
      element.style.backgroundPosition = `${(column / (SPRITE_COLUMNS - 1)) * 100}% 0%`;
    };
    if (spriteSrc) {
      element.style.backgroundImage = `url("${spriteSrc}")`;
    } else {
      element.style.backgroundImage = `url(pets/${petId}.png)`;
    }
    element.style.backgroundSize = `${SPRITE_COLUMNS * 100}% ${SPRITE_ROWS * 100}%`;
    element.style.backgroundRepeat = "no-repeat";
    element.style.imageRendering = "pixelated";
    element.style.width = `${sizePx}px`;
    element.style.height = `${Math.round(sizePx * CELL_ASPECT)}px`;
    draw(0);
    if (reducedMotion) return;
    const idleDurations = [280, 110, 110, 140, 140, 320].map((ms) => ms * IDLE_DURATION_SLOWDOWN);
    let timer: number | null = null;
    const tick = (): void => {
      frameRef.current = (frameRef.current + 1) % idleDurations.length;
      draw(frameRef.current);
      timer = window.setTimeout(tick, idleDurations[frameRef.current]);
    };
    timer = window.setTimeout(tick, idleDurations[0]);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [petId, sizePx, spriteSrc]);

  return <div ref={elementRef} aria-hidden="true" className="shrink-0" />;
}

export function PetsSettingsSection({
  onCreateTask,
}: {
  onCreateTask?: (request?: CreateTaskOptions) => void;
} = {}) {
  const { intl } = useZCodeIntl();
  const bridge =
    typeof window !== "undefined" ? (window as PetBridgeWindow).zcode?.petOverlay : undefined;
  const [config, setConfig] = useState<PetConfig | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [customPets, setCustomPets] = useState<CustomPetEntry[]>([]);
  const [customSprites, setCustomSprites] = useState<Record<string, string>>({});
  const [importError, setImportError] = useState<string | null>(null);

  // 主配置：读写 + 广播订阅。
  useEffect(() => {
    if (!bridge) return;
    let disposed = false;
    void bridge
      .getConfig()
      .then((value) => {
        if (disposed) return;
        setConfig(value);
      })
      .catch(() => undefined);
    const unsubscribe = bridge.onConfig((next) => {
      setConfig(next);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [bridge]);

  // 自定义宠物清单 + dataURL 头像（refreshTick 由导入/删除触发重扫）。
  useEffect(() => {
    if (!bridge) return;
    let disposed = false;
    void (async () => {
      try {
        const pets = await bridge.listCustomPets();
        if (disposed) return;
        setCustomPets(pets);
        const sprites: Record<string, string> = {};
        for (const pet of pets) {
          const dataUrl = await bridge.getCustomSpriteDataUrl(pet.id);
          if (dataUrl) sprites[pet.id] = dataUrl;
        }
        if (!disposed) setCustomSprites(sprites);
      } catch {
        // 列表加载失败不阻断页面。
      }
    })();
    return () => {
      disposed = true;
    };
  }, [bridge, refreshTick]);

  const save = useCallback(
    (patch: Partial<PetConfig>): void => {
      if (!bridge) return;
      void bridge
        .setConfig(patch)
        .then((next) => setConfig(next))
        .catch(() => undefined);
    },
    [bridge],
  );

  const importZip = async (): Promise<void> => {
    try {
      const zipPath = await (window as PetBridgeWindow).zcode?.selectFile?.();
      if (!zipPath) return;
      const prepared = await petBridge.prepareCustomPetZipImport(zipPath);
      if ("error" in prepared) {
        setImportError(prepared.error);
        return;
      }
      // 渲染层解码精灵（WebP/PNG 走 Chromium Image），canvas 转 PNG 落盘——
      // 与内置九张全 PNG 同一解码基线，规避 nativeImage 不支持 WebP 的限制。
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("image-not-decodable"));
        img.src = `data:${prepared.spriteMime};base64,${prepared.spriteBase64}`;
      });
      if (image.naturalWidth % SPRITE_COLUMNS !== 0) {
        setImportError("width-not-divisible-by-8");
        return;
      }
      const cellWidth = image.naturalWidth / SPRITE_COLUMNS;
      const cellHeight = Math.round((cellWidth * 208) / 192);
      const rows = Math.round(image.naturalHeight / cellHeight);
      if (rows !== 9 && rows !== 11) {
        setImportError("height-not-matching-grid");
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setImportError("canvas-unavailable");
        return;
      }
      ctx.drawImage(image, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      const committed = await petBridge.commitCustomPetImport({
        displayName: prepared.manifest.displayName,
        description: prepared.manifest.description,
        suggestedId: prepared.manifest.suggestedId,
        rows,
        pngBase64: dataUrl.slice(dataUrl.indexOf(",") + 1),
      });
      if ("error" in committed) {
        setImportError(committed.error);
        return;
      }
      setImportError(null);
      setRefreshTick((tick) => tick + 1);
      save({ petId: committed.id, enabled: true });
    } catch {
      setImportError("image-not-decodable");
    }
  };

  const deletePet = (petId: string): void => {
    void petBridge.deleteCustomPet(petId).then(() => {
      setRefreshTick((tick) => tick + 1);
    });
  };

  if (!bridge || !config) {
    return null;
  }
  // 闭包内使用的非空别名（TS narrow 不跨函数边界）。
  const petBridge = bridge;

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h3 className="text-ui-lg font-semibold text-foreground">
          {intl.formatMessage({ id: "settings.pets.pageTitle" })}
        </h3>
      </div>

      <Tabs defaultValue="codex" className="gap-6">
        <TabsList variant="line" className="self-start">
          <TabsTrigger value="codex">
            {intl.formatMessage({ id: "settings.pets.tab.codex" })}
          </TabsTrigger>
          <TabsTrigger value="dsh">
            {intl.formatMessage({ id: "settings.pets.tab.dsh" })}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="codex" className="space-y-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-ui-base font-semibold text-foreground">
                  {intl.formatMessage({ id: "settings.pets.pick.title" })}
                </h4>
                <p className="mt-1 text-ui-base leading-6 text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.pets.pick.description" })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={intl.formatMessage({ id: "settings.pets.refresh" })}
                      onClick={() => setRefreshTick((tick) => tick + 1)}
                    >
                      <RefreshCw className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{intl.formatMessage({ id: "settings.pets.refresh" })}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onCreateTask?.({ initialPrompt: "$hatch-pet" })}
                    >
                      {intl.formatMessage({ id: "settings.pets.create" })}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {intl.formatMessage({ id: "settings.pets.create.tooltip" })}
                  </TooltipContent>
                </Tooltip>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void petBridge.toggle().then((next) => setConfig(next));
                  }}
                >
                  {intl.formatMessage({
                    id: config.enabled ? "settings.pets.tuckAway" : "settings.pets.wakePet",
                  })}
                </Button>
              </div>
            </div>

            <Card className="border border-border bg-card py-0 shadow-none">
              <CardContent className="divide-y divide-border px-0 py-0">
                {OFFICIAL_PETS.map((pet) => {
                  const selected = config.petId === pet.id;
                  return (
                    <div key={pet.id} className="flex items-center gap-4 px-5 py-4">
                      <PetAvatarSprite petId={pet.id} sizePx={48} />
                      <div className="min-w-0 flex-1">
                        <div className="text-ui-base font-medium text-foreground">
                          {pet.displayName}
                        </div>
                        <div className="mt-0.5 text-ui-sm text-foreground-subtle">
                          {pet.description}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={selected}
                        onClick={() => save({ petId: pet.id, enabled: true })}
                      >
                        {intl.formatMessage({
                          id: selected ? "settings.pets.selected" : "settings.pets.select",
                        })}
                      </Button>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-ui-base font-semibold text-foreground">
                {intl.formatMessage({ id: "settings.pets.custom.title" })}
              </h4>
              <Button type="button" variant="outline" size="sm" onClick={() => void importZip()}>
                <Upload className="size-4" />
                {intl.formatMessage({ id: "settings.pets.custom.import" })}
              </Button>
            </div>
            {importError ? (
              <p className="text-ui-sm text-destructive">
                {intl.formatMessage({ id: "settings.pets.custom.importError" })} ({importError})
              </p>
            ) : null}
            <Card className="border border-border bg-card py-0 shadow-none">
              <CardContent className="divide-y divide-border px-0 py-0">
                {customPets.length === 0 ? (
                  <p className="px-5 py-6 text-ui-sm text-foreground-subtle">
                    {intl.formatMessage({ id: "settings.pets.custom.empty" })}
                  </p>
                ) : (
                  customPets.map((pet) => {
                    const selected = config.petId === pet.id;
                    return (
                      <div key={pet.id} className="flex items-center gap-4 px-5 py-4">
                        <PetAvatarSprite
                          petId={pet.id}
                          sizePx={48}
                          spriteSrc={customSprites[pet.id] ?? null}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-ui-base font-medium text-foreground">
                            {pet.displayName}
                          </div>
                          <div className="mt-0.5 text-ui-sm text-foreground-subtle">
                            {pet.description}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={intl.formatMessage({ id: "settings.pets.custom.delete" })}
                          onClick={() => deletePet(pet.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={selected}
                          onClick={() => save({ petId: pet.id, enabled: true })}
                        >
                          {intl.formatMessage({
                            id: selected ? "settings.pets.selected" : "settings.pets.select",
                          })}
                        </Button>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>

          <p className="text-ui-sm leading-5 text-foreground-subtle">
            {intl.formatMessage({ id: "settings.pet.hint" })}
          </p>
        </TabsContent>

        {/* 第二套宠物系统：DSH 桌宠，独立悬浮窗，与 Codex 精灵图宠物并存。 */}
        <TabsContent value="dsh" className="space-y-6">
          <DshPetSettingsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
