import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Switch } from "@/components/ui/switch.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import type { ProxyPoolEntry, ProviderProxyStrategy } from "@zcode/shared";
import type {
  ProxyProviderBindingSaveInput,
  ProxyProviderBindingView,
} from "@zcode/services";

type Intl = ReturnType<typeof import("@/i18n/IntlProvider.js").useXCodeIntl>["intl"];

interface Props {
  provider: ProxyProviderBindingView;
  pools: ProxyPoolEntry[];
  onSave: (input: ProxyProviderBindingSaveInput) => Promise<void>;
  intl: Intl;
}

/**
 * 单个供应商的代理绑定卡。
 *
 * - 开关：启用/关闭供应商级代理；
 * - 策略：固定（第一条）/ 轮询 / 随机；
 * - 多账号供应商（qoder / codebuddy）额外展示账号绑定列表，未指定绑定的账号跟随策略。
 */
export function ProviderBindingCard({ provider, pools, onSave, intl }: Props) {
  const binding = provider.binding;
  const enabled = binding?.enabled ?? false;
  const strategy = binding?.strategy ?? "round-robin";
  const entryIds = binding?.entryIds ?? [];
  const accountBindings = binding?.accountBindings ?? {};

  const activePools = pools.filter((pool) => pool.isActive);

  // 编辑态：本地缓存，点「保存」统一提交
  const setBinding = (patch: Partial<ProxyProviderBindingSaveInput>) => {
    void onSave({
      enabled,
      strategy,
      entryIds,
      accountBindings,
      ...patch,
    }).catch(() => {
      // onSave 失败在父级展示；这里保持 UI 不闪
    });
  };

  const toggleEntry = (entryId: string) => {
    const has = entryIds.includes(entryId);
    const next = has ? entryIds.filter((id) => id !== entryId) : [...entryIds, entryId];
    setBinding({ entryIds: next });
  };

  const setStrategy = (next: ProviderProxyStrategy) => {
    setBinding({ strategy: next });
  };

  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-foreground">{provider.providerName}</div>
          <div className="text-foreground-subtle">{provider.providerId}</div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-foreground-subtle">
            {intl.formatMessage({ id: "settings.proxyPool.providerUseProxy" })}
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => setBinding({ enabled: checked })}
            />
          </label>
        </div>
      </div>

      {enabled ? (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-foreground-subtle">
              {intl.formatMessage({ id: "settings.proxyPool.providerStrategy" })}
            </span>
            <Select value={strategy} onValueChange={(v) => setStrategy(v as ProviderProxyStrategy)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">
                  {intl.formatMessage({ id: "settings.proxyPool.strategyFixed" })}
                </SelectItem>
                <SelectItem value="round-robin">
                  {intl.formatMessage({ id: "settings.proxyPool.strategyRoundRobin" })}
                </SelectItem>
                <SelectItem value="random">
                  {intl.formatMessage({ id: "settings.proxyPool.strategyRandom" })}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {activePools.length > 0 ? (
            <div className="space-y-1">
              <div className="text-foreground-subtle">
                {intl.formatMessage({ id: "settings.proxyPool.providerEntries" })}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {activePools.map((pool) => {
                  const selected = entryIds.includes(pool.id);
                  return (
                    <button
                      key={pool.id}
                      type="button"
                      onClick={() => toggleEntry(pool.id)}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        selected
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-foreground-subtle hover:border-foreground-subtle"
                      }`}
                    >
                      {pool.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-foreground-subtle">
              {intl.formatMessage({ id: "settings.proxyPool.providerEntriesEmpty" })}
            </p>
          )}

          {provider.accounts.length > 0 ? (
            <div className="space-y-1 border-t border-border pt-2">
              <div className="text-foreground-subtle">
                {intl.formatMessage({ id: "settings.proxyPool.accountBindings" })}
              </div>
              <p className="text-foreground-subtle">
                {intl.formatMessage({ id: "settings.proxyPool.accountBindingsDescription" })}
              </p>
              <div className="space-y-1.5">
                {provider.accounts.map((account) => {
                  const bound = accountBindings[account.id];
                  return (
                    <div
                      key={account.id}
                      className="flex items-center justify-between gap-2 text-ui-sm"
                    >
                      <span className="truncate text-foreground">
                        {account.displayName}
                        {account.active ? (
                          <span className="ml-1 text-foreground-subtle">
                            {intl.formatMessage({ id: "settings.qoder.active" })}
                          </span>
                        ) : null}
                      </span>
                      <Select
                        value={bound ?? "__follow__"}
                        onValueChange={(v) => {
                          const next = { ...accountBindings };
                          if (v === "__follow__" || !v) delete next[account.id];
                          else next[account.id] = v;
                          setBinding({ accountBindings: next });
                        }}
                      >
                        <SelectTrigger className="w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__follow__">
                            {intl.formatMessage({ id: "settings.proxyPool.accountFollowStrategy" })}
                          </SelectItem>
                          {activePools.map((pool) => (
                            <SelectItem key={pool.id} value={pool.id}>
                              {pool.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
