import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useServices } from "@/hooks/useServices.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import type { IProxyPoolService, ProxyProviderBindingView } from "@zcode/services";

/**
 * 账号级代理绑定选择器（内嵌到供应商账号行）。
 *
 * 读取当前供应商的代理绑定视图，显示「跟随策略 / 用某条代理」下拉。
 * 改动走 saveAccountBinding（只改本账号的 accountBindings，不动策略与其他账号）。
 * 供应商未启用代理、或池里没有条目时，不渲染（静默）。
 */
export function ProviderAccountBinding({
  providerId,
  requestProfile,
  accountId,
}: {
  providerId: string;
  requestProfile?: string;
  accountId: string;
}) {
  const { intl } = useXCodeIntl();
  const services = useServices();
  const service: IProxyPoolService | undefined = services.proxyPoolService;

  const [view, setView] = useState<ProxyProviderBindingView | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!service) {
      setLoaded(true);
      return;
    }
    try {
      const next = await service.getProviderBinding(providerId);
      setView(next);
    } catch {
      setView(null);
    } finally {
      setLoaded(true);
    }
  }, [service, providerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const binding = view?.binding;
  const enabled = binding?.enabled ?? false;
  const pools = (binding?.entries ?? []).filter((entry) => entry.isActive);
  // 账号当前绑定的条目 id；未绑定则走策略（accountBindings 里没有该账号）。
  const boundEntryId = view?.accounts.find((account) => account.id === accountId)?.boundEntryId;

  if (!service || !loaded || !enabled || pools.length === 0) {
    return null;
  }

  return (
    <div className="mt-1 flex items-center gap-2 text-ui-sm text-foreground-subtle">
      <span>{intl.formatMessage({ id: "settings.proxyPool.accountBindings" })}</span>
      <Select
        value={boundEntryId ?? "__follow__"}
        onValueChange={(value) => {
          void service
            .saveAccountBinding(providerId, accountId, value === "__follow__" ? null : value)
            .then((next) => setView(next))
            .catch(() => undefined);
        }}
      >
        <SelectTrigger className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__follow__">
            {intl.formatMessage({ id: "settings.proxyPool.accountFollowStrategy" })}
          </SelectItem>
          {pools.map((pool) => (
            <SelectItem key={pool.id} value={pool.id}>
              {pool.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
