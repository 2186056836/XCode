/* eslint-disable react-hooks/rules-of-hooks -- 本节用受控表单 + 本地编辑态，无自定义 hook 顺序问题。 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2, Pencil, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Switch } from "@/components/ui/switch.js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.js";
import { useServices } from "@/hooks/useServices.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { PoolEditor } from "./ProxyPoolEditor.js";
import type {
  IProxyPoolService,
  ProxyPoolState,
  ProxyPoolTestResult,
} from "@zcode/services";

/**
 * 代理池配置：**只维护可复用的代理条目**（对齐 9router 的 proxy-pools 页）。
 *
 * 这里不出现任何「哪个供应商 / 哪个账号用哪个池」——绑定的单位是**单条连接**，
 * 入口在「模型设置」里对应供应商的连接行上（见 ProviderAccountBinding）。
 * 把供应商开关放在本页会让同一件事有两个入口，语义也和 9router 有出入。
 *
 * 池与全局「HTTP 代理」的关系在解析侧决定：
 * - 连接绑定了池 → 该连接的请求（模型、上游模型列表、登录/签到）只走池，全局代理被排除；
 * - 连接未绑定 → 出口跟随全局代理状态（全局配了就走全局，没配直连）。
 */

type PoolDraft = {
  id?: string;
  name: string;
  proxyUrl: string;
  noProxy: string;
  isActive: boolean;
  strictProxy: boolean;
};

const EMPTY_DRAFT: PoolDraft = {
  name: "",
  proxyUrl: "",
  noProxy: "",
  isActive: true,
  strictProxy: false,
};

function isValidProxyUrl(url: string): boolean {
  if (!url) return false;
  if (/[\n\r`$]/.test(url)) return false;
  try {
    const parsed = new URL(url);
    const allowed = ["http:", "https:", "socks4:", "socks4a:", "socks5:", "socks5h:"];
    return allowed.includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function ProxyPoolSettingsSection() {
  const { intl } = useXCodeIntl();
  const services = useServices();
  const proxyPoolService: IProxyPoolService | undefined = services.proxyPoolService;

  const [state, setState] = useState<ProxyPoolState | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState<PoolDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PoolDraft | null>(null);
  const [testing, setTesting] = useState<Record<string, "idle" | "running">>({});
  const [testResults, setTestResults] = useState<Record<string, ProxyPoolTestResult>>({});

  const reload = useCallback(async () => {
    if (!proxyPoolService) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      setState(await proxyPoolService.getState());
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [proxyPoolService]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const applyState = useCallback((next: ProxyPoolState) => {
    setState(next);
  }, []);

  const openCreate = useCallback(() => {
    setDraft({ ...EMPTY_DRAFT });
  }, []);

  const openEdit = useCallback((pool: ProxyPoolState["pools"][number]) => {
    setDraft({
      id: pool.id,
      name: pool.name,
      proxyUrl: pool.proxyUrl,
      noProxy: pool.noProxy ?? "",
      isActive: pool.isActive,
      strictProxy: pool.strictProxy === true,
    });
  }, []);

  const saveDraft = useCallback(async () => {
    if (!proxyPoolService || !draft) return;
    if (!draft.name.trim()) {
      setErrorMsg(intl.formatMessage({ id: "settings.proxyPool.nameRequired" }));
      return;
    }
    if (!isValidProxyUrl(draft.proxyUrl.trim())) {
      setErrorMsg(intl.formatMessage({ id: "settings.proxyPool.proxyUrlRequired" }));
      return;
    }
    setSaving(true);
    try {
      const next = await proxyPoolService.savePool({
        id: draft.id,
        name: draft.name.trim(),
        proxyUrl: draft.proxyUrl.trim(),
        noProxy: draft.noProxy.trim() || undefined,
        isActive: draft.isActive,
        strictProxy: draft.strictProxy,
      });
      applyState(next);
      setDraft(null);
    } catch (error) {
      setErrorMsg(
        intl.formatMessage(
          { id: "settings.proxyPool.saveFailed" },
          { error: error instanceof Error ? error.message : String(error) },
        ),
      );
    } finally {
      setSaving(false);
    }
  }, [proxyPoolService, draft, intl, applyState]);

  const confirmDelete = useCallback(async () => {
    if (!proxyPoolService || !deleteTarget?.id) return;
    setSaving(true);
    try {
      const next = await proxyPoolService.deletePool(deleteTarget.id);
      applyState(next);
      setDeleteTarget(null);
    } catch (error) {
      setErrorMsg(
        intl.formatMessage(
          { id: "settings.proxyPool.saveFailed" },
          { error: error instanceof Error ? error.message : String(error) },
        ),
      );
    } finally {
      setSaving(false);
    }
  }, [proxyPoolService, deleteTarget, intl, applyState]);

  const testPool = useCallback(
    async (poolId: string, proxyUrl: string) => {
      if (!proxyPoolService) return;
      setTesting((prev) => ({ ...prev, [poolId]: "running" }));
      try {
        const result = await proxyPoolService.testPool({ poolId, proxyUrl });
        setTestResults((prev) => ({ ...prev, [poolId]: result }));
      } catch (error) {
        setTestResults((prev) => ({
          ...prev,
          [poolId]: { ok: false, error: error instanceof Error ? error.message : String(error) },
        }));
      } finally {
        setTesting((prev) => ({ ...prev, [poolId]: "idle" }));
      }
    },
    [proxyPoolService],
  );

  if (!proxyPoolService) {
    return (
      <div className="rounded-lg border border-border p-4 text-ui-sm text-foreground-subtle">
        {intl.formatMessage({ id: "settings.proxyPool.unavailable" })}
      </div>
    );
  }

  const pools = state?.pools ?? [];

  return (
    <div className="space-y-6 text-ui-sm">
      {/* 代理池条目 */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-ui-base font-medium text-foreground">
              {intl.formatMessage({ id: "settings.proxyPool.poolsHeading" })}
            </h3>
            <p className="text-foreground-subtle">
              {intl.formatMessage({ id: "settings.proxyPool.poolsDescription" })}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={openCreate}>
            <Plus className="size-3.5" aria-hidden="true" />
            {intl.formatMessage({ id: "settings.proxyPool.addPool" })}
          </Button>
        </div>

        {loading && !state ? (
          <div className="flex items-center gap-2 text-foreground-subtle">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            {intl.formatMessage({ id: "settings.proxyPool.testing" })}
          </div>
        ) : errorMsg && !state ? (
          <p className="text-destructive" role="alert">
            {errorMsg}
          </p>
        ) : pools.length === 0 ? (
          <p className="text-foreground-subtle">
            {intl.formatMessage({ id: "settings.proxyPool.emptyPools" })}
          </p>
        ) : (
          <div className="space-y-2">
            {pools.map((pool) => {
              const result = testResults[pool.id];
              return (
                <div
                  key={pool.id}
                  className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5"
                >
                  <Switch
                    checked={pool.isActive}
                    onCheckedChange={(checked) => {
                      void proxyPoolService
                        .setPoolActive(pool.id, checked)
                        .then(applyState)
                        .catch((e) =>
                          setErrorMsg(
                            intl.formatMessage(
                              { id: "settings.proxyPool.saveFailed" },
                              { error: e instanceof Error ? e.message : String(e) },
                            ),
                          ),
                        );
                    }}
                    aria-label={intl.formatMessage({ id: "settings.proxyPool.enabled" })}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-foreground">{pool.name}</span>
                      <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-foreground-subtle">
                        {pool.type}
                      </span>
                      {!pool.isActive ? (
                        <span className="text-foreground-subtle">
                          {intl.formatMessage({ id: "settings.proxyPool.disabled" })}
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate font-mono text-foreground-subtle">{pool.proxyUrl}</div>
                    {pool.noProxy ? (
                      <div className="truncate text-foreground-subtle">
                        {intl.formatMessage({ id: "settings.proxyPool.noProxy" })}:{" "}
                        <span className="font-mono">{pool.noProxy}</span>
                      </div>
                    ) : null}
                    {pool.strictProxy ? (
                      <div className="text-foreground-subtle">
                        {intl.formatMessage({ id: "settings.proxyPool.strictOn" })}
                      </div>
                    ) : null}
                    {result ? (
                      <div
                        className={
                          result.ok
                            ? "text-foreground-subtle"
                            : "text-destructive"
                        }
                      >
                        {result.ok
                          ? intl.formatMessage(
                              { id: "settings.proxyPool.testOk" },
                              {
                                ms: String(result.elapsedMs ?? 0),
                                status: String(result.status ?? "-"),
                                // 探针回显出口 IP 时追加展示：只报「连通」看不出走的是哪条线路。
                                ip: result.exitIp
                                  ? intl.formatMessage(
                                      { id: "settings.proxyPool.testOkExitIp" },
                                      { ip: result.exitIp },
                                    )
                                  : "",
                              },
                            )
                          : intl.formatMessage(
                              { id: "settings.proxyPool.testFailed" },
                              { error: result.error ?? "-" },
                            )}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={testing[pool.id] === "running"}
                      onClick={() => void testPool(pool.id, pool.proxyUrl)}
                      aria-label={intl.formatMessage({ id: "settings.proxyPool.test" })}
                    >
                      {testing[pool.id] === "running" ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <RefreshCw className="size-3.5" aria-hidden="true" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openEdit(pool)}
                      aria-label={intl.formatMessage({ id: "settings.proxyPool.edit" })}
                    >
                      <Pencil className="size-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        setDeleteTarget({ ...pool, noProxy: pool.noProxy ?? "", strictProxy: pool.strictProxy === true })
                      }
                      aria-label={intl.formatMessage({ id: "settings.proxyPool.delete" })}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p className="text-foreground-subtle">
        {intl.formatMessage({ id: "settings.proxyPool.bindingHint" })}
      </p>

      {/* 编辑弹窗 */}
      {draft ? (
        <PoolEditor
          draft={draft}
          saving={saving}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={() => void saveDraft()}
          intl={intl}
        />
      ) : null}

      {/* 删除确认 */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({ id: "settings.proxyPool.deleteConfirmTitle" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({ id: "settings.proxyPool.deleteConfirmDescription" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {intl.formatMessage({ id: "settings.proxyPool.cancel" })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : null}
              {intl.formatMessage({ id: "settings.proxyPool.delete" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
