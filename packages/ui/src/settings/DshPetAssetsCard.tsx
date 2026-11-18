/**
 * 「素材包」卡片：完整桌宠素材的按需下载。
 *
 * 内置只有 8 个核心动作。其余 98 个动作、27 张表情包和个人设字体改为逐文件
 * 按需下载——上游整包约 60 MB，本机到 codeload 与加速镜像实测只有 30–50 KB/s，
 * 整包要 20–30 分钟，用户等不起。按需模式下单个动作约 450 KB，十秒级完成，
 * 没播放过的动作永远不下载。
 *
 * 卡片提供两件事：
 *  1. 一键下载（把剩余动作 + 表情包 + 字体一次下完，可取消、可中断续传）；
 *  2. 进度与镜像来源展示，让用户知道在等什么、走的是哪个源。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Card, CardContent } from "@/components/ui/card.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";

interface AssetsStatus {
  installed: boolean;
  counts: { webm: number; memes: number; font: boolean };
  totals: { webm: number; memes: number; font: number };
  dir: string;
  lastMirror?: string | null;
}

interface AssetsProgress {
  name: string;
  loaded: number;
  total: number;
  done: number;
  target: number;
  mirror?: string;
}

interface ProbeResult {
  label: string;
  template: string;
  bytesPerSecond: number;
  latencyMs: number;
  error?: string;
}

interface AssetsBridge {
  status(): Promise<AssetsStatus>;
  probe(): Promise<ProbeResult[]>;
  download(): Promise<{
    ok: boolean;
    counts?: { webm: number; memes: number; font: boolean };
    downloaded?: { webm: number; memes: number };
    error?: string;
  }>;
  cancel(): Promise<{ ok: boolean }>;
  uninstall(): Promise<{ ok: boolean }>;
  onProgress(callback: (progress: AssetsProgress) => void): () => void;
}

function resolveBridge(): AssetsBridge | null {
  // preload 把桌宠桥挂在 window.zcode.dshPetOverlay（与 getConfig/setConfig 同域）。
  // web/standalone 没有这套 IPC，返回 null 让整张卡不渲染。
  const bridge = (
    window as unknown as { zcode?: { dshPetOverlay?: { assets?: AssetsBridge } } }
  ).zcode?.dshPetOverlay?.assets;
  return bridge ?? null;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "—";
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function DshPetAssetsCard(): React.JSX.Element | null {
  const { intl } = useZCodeIntl();
  const t = useCallback(
    (id: string, values?: Record<string, string | number>) =>
      intl.formatMessage({ id: `settings.dshPet.assets.${id}` }, values),
    [intl],
  );

  /**
   * 桥不能在首次渲染时就定死。
   *
   * preload 的 contextBridge 在文档早期注入，但设置页可能先于它完成首帧；
   * 用 `useState(() => resolveBridge())` 会把「此刻还没有」永久缓存成 null，
   * 整张卡再也不出现。这里用 state + effect 重试到桥可用为止。
   */
  const [bridge, setBridge] = useState<AssetsBridge | null>(null);
  const [status, setStatus] = useState<AssetsStatus | null>(null);
  const [progress, setProgress] = useState<AssetsProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [probes, setProbes] = useState<ProbeResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const tryAttach = (): void => {
      if (!mountedRef.current) return;
      const found = resolveBridge();
      if (found) {
        setBridge(found);
        return;
      }
      // 60 次 × 100ms ≈ 6 秒：足够覆盖 preload 注入与首个 Host 连接。
      attempts += 1;
      if (attempts < 60) timer = setTimeout(tryAttach, 100);
    };
    tryAttach();
    return () => {
      mountedRef.current = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!bridge) return;
    try {
      const next = await bridge.status();
      if (mountedRef.current) setStatus(next);
    } catch (cause) {
      logger.warn("[dsh-pet] assets status failed", { error: String(cause) });
    }
  }, [bridge]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!bridge) return;
    return bridge.onProgress((next) => {
      if (!mountedRef.current) return;
      setProgress(next);
      // 每完成一个文件就刷新计数，用户能看到 12/106 这样的进展。
      if (next.done > 0) void refresh();
    });
  }, [bridge, refresh]);

  // 镜像测速是只读探测，进页面就跑一次，让「自动选最优」可验证。
  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    void bridge
      .probe()
      .then((result) => {
        if (!cancelled && mountedRef.current) setProbes(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const runDownload = useCallback(async () => {
    if (!bridge || busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const result = await bridge.download();
      if (!mountedRef.current) return;
      if (result.ok) {
        setNote(
          t("done", {
            webm: result.counts?.webm ?? 0,
            memes: result.counts?.memes ?? 0,
          }),
        );
        await refresh();
      } else if (result.error === "cancelled") {
        setNote(t("cancelled"));
      } else {
        setError(result.error ?? t("failed"));
      }
    } catch (cause) {
      if (mountedRef.current) setError(String(cause));
    } finally {
      if (mountedRef.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  }, [bridge, busy, refresh, t]);

  const runCancel = useCallback(async () => {
    await bridge?.cancel().catch(() => undefined);
  }, [bridge]);

  const runUninstall = useCallback(async () => {
    if (!bridge || busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await bridge.uninstall();
      if (mountedRef.current) {
        setNote(t("removed"));
        await refresh();
      }
    } catch (cause) {
      if (mountedRef.current) setError(String(cause));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [bridge, busy, refresh, t]);

  // web/standalone 没有这套 IPC：整张卡不渲染，避免给出点了没反应的按钮。
  if (!bridge) return null;

  const counts = status?.counts;
  const totals = status?.totals;
  const webmRatio =
    counts && totals && totals.webm > 0 ? Math.min(1, counts.webm / totals.webm) : 0;
  const complete = Boolean(counts && totals && counts.webm >= totals.webm);
  const usableProbes = (probes ?? []).filter((p) => !p.error);

  return (
    <Card className="border border-border bg-card py-0 shadow-none">
      <CardContent className="flex flex-col gap-3 px-4 py-3">
        <div className="flex flex-col gap-1">
          <span className="text-ui-base font-semibold text-foreground">{t("title")}</span>
          <span className="text-ui-xs text-foreground-subtle">{t("hint")}</span>
        </div>

        <div className="flex flex-col gap-1 text-ui-sm">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="shrink-0 text-foreground-subtle">{t("state")}：</span>
            <span className={complete ? "text-foreground" : "text-foreground-subtle"}>
              {complete
                ? t("stateComplete")
                : counts && counts.webm > 0
                  ? t("statePartial", { webm: counts.webm, total: totals?.webm ?? 0 })
                  : t("stateBundled")}
            </span>
          </div>
          {counts && totals ? (
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="shrink-0 text-foreground-subtle">{t("contents")}：</span>
              <span className="text-foreground">
                {t("contentsValue", {
                  webm: `${counts.webm}/${totals.webm}`,
                  memes: `${counts.memes}/${totals.memes}`,
                  font: counts.font ? t("fontYes") : t("fontNo"),
                })}
              </span>
            </div>
          ) : null}
          {counts && totals ? (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${Math.max(2, Math.round(webmRatio * 100))}%` }}
              />
            </div>
          ) : null}
          {status?.dir ? (
            <div className="flex min-w-0 flex-wrap items-baseline gap-2">
              <span className="shrink-0 text-foreground-subtle">{t("dir")}：</span>
              <code className="min-w-0 select-text break-all font-mono text-ui-xs text-foreground">
                {status.dir}
              </code>
            </div>
          ) : null}
        </div>

        {progress ? (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-ui-xs text-foreground-subtle">
              <span className="min-w-0 truncate">
                {t("downloading", { name: progress.name })}
                {progress.mirror ? ` · ${progress.mirror}` : ""}
              </span>
              <span className="shrink-0">
                {progress.target > 0 ? `${progress.done}/${progress.target}` : ""}
                {progress.total > 0
                  ? ` · ${formatBytes(progress.loaded)}/${formatBytes(progress.total)}`
                  : ""}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200"
                style={{
                  width: `${
                    progress.target > 0
                      ? Math.max(
                          2,
                          Math.min(
                            100,
                            Math.round(((progress.done + 0.5) / progress.target) * 100),
                          ),
                        )
                      : 2
                  }%`,
                }}
              />
            </div>
          </div>
        ) : null}

        {usableProbes.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="text-ui-xs text-foreground-subtle">{t("mirrors")}</span>
            <div className="flex flex-col gap-0.5">
              {usableProbes.slice(0, 4).map((p, index) => (
                <div
                  key={p.template}
                  className="flex flex-wrap items-baseline gap-2 text-ui-xs text-foreground-subtle"
                >
                  <span className={index === 0 ? "text-foreground" : undefined}>
                    {index === 0 ? `★ ${p.label}` : p.label}
                  </span>
                  <span>{formatSpeed(p.bytesPerSecond)}</span>
                  {Number.isFinite(p.latencyMs) ? <span>{p.latencyMs}ms</span> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {busy ? (
            <Button type="button" variant="outline" onClick={() => void runCancel()}>
              {t("cancel")}
            </Button>
          ) : null}
          <Button type="button" disabled={busy || complete} onClick={() => void runDownload()}>
            {complete
              ? t("allCached")
              : counts && counts.webm > 0
                ? t("resume", { count: Math.max(0, (totals?.webm ?? 0) - counts.webm) })
                : t("download")}
          </Button>
          {counts && counts.webm > 0 && !busy ? (
            <Button type="button" variant="outline" onClick={() => void runUninstall()}>
              {t("remove")}
            </Button>
          ) : null}
        </div>

        {note ? <span className="text-ui-sm text-foreground-subtle">{note}</span> : null}
        {error ? <span className="text-ui-sm text-destructive">{error}</span> : null}
        <p className="text-ui-xs text-foreground-subtle">{t("note")}</p>
      </CardContent>
    </Card>
  );
}
