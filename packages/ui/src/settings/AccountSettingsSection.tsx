import { useCallback, useEffect, useState } from "react";
import { Gift, Loader2Icon, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useServices } from "@/hooks/useServices.js";
import { useXCodeStore } from "@/store/StoreProvider.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard } from "@/settings/SettingsPageParts.js";
import {
  claimMarketingForAllAccounts,
  type MarketingClaimAllAccountResult,
} from "@/lib/marketingClaimAll.js";
import type { MarketingCaptchaConfig, MarketingClaimPlanResponse, MarketingTouchResponse } from "@zcode/shared";

/** 与 services OAuthAccountEntry 对齐的展示结构（UI 侧本地声明，避免跨包类型耦合）。 */
interface AccountEntry {
  provider: string;
  identity: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
}

/** @zcode/services 的 dist 类型尚未包含新增的账号接口，运行时已存在，这里局部断言以过编译。 */
interface OAuthAccountService {
  getAccounts(): Promise<AccountEntry[]>;
  getActiveAccount(): Promise<AccountEntry | null>;
  switchAccount(accountRef: string): Promise<AccountEntry | null>;
  logoutAccount(accountRef: string): Promise<void>;
  removeAccount(accountRef: string): Promise<void>;
}

/** 一键领取所需的最小 coding-plan 服务面（同 useMarketingTouchCampaign 的局部断言模式）。 */
interface CodingPlanClaimCapableService {
  getCaptchaConfig(): Promise<MarketingCaptchaConfig | null>;
  claimManualPlan(input: {
    planId: string;
    captchaVerifyParam?: string;
    captchaRegion?: string;
    accountRef?: string;
  }): Promise<MarketingClaimPlanResponse>;
  getManualClaimPlanPlans(input: {
    accountRef: string;
  }): Promise<{
    plans: Array<{ planId?: string; name?: string; status?: string; endsAt?: number | string | null }>;
  }>;
}

interface MarketingTouchQueryCapableService {
  query(input: { locale: string; accountRef?: string }): Promise<MarketingTouchResponse>;
}

const PROVIDER_LABEL: Record<string, string> = {
  zai: "Z.AI",
  bigmodel: "BigModel",
};

function providerBadgeClass(provider: string): string {
  if (provider === "zai") return "bg-blue-500/10 text-blue-600";
  if (provider === "bigmodel") return "bg-purple-500/10 text-purple-600";
  return "bg-surface text-foreground-subtle";
}

function ProviderBadge({ provider }: { provider: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${providerBadgeClass(provider)}`}
    >
      {PROVIDER_LABEL[provider] ?? provider}
    </span>
  );
}

function AccountAvatar({ account }: { account: AccountEntry }) {
  if (account.avatarUrl) {
    return (
      <img
        src={account.avatarUrl}
        alt=""
        aria-hidden="true"
        className="size-10 shrink-0 rounded-full object-cover ring-1 ring-border"
      />
    );
  }
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-ui-base font-semibold text-foreground ring-1 ring-border">
      {(account.displayName || account.username || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

export function AccountSettingsSection({
  onOpenLogin,
}: {
  onLogin?: () => void;
  onOpenLogin?: () => void;
  onLogout?: () => void;
}) {
  const { intl, locale } = useXCodeIntl();
  const { oauthService, codingPlanSubscriptionService, marketingTouchService } = useServices();
  const setUser = useXCodeStore((state) => state.setUser);
  const svc = oauthService as unknown as OAuthAccountService;
  const claimService = codingPlanSubscriptionService as unknown as
    | CodingPlanClaimCapableService
    | undefined;
  const touchService = marketingTouchService as unknown as
    | MarketingTouchQueryCapableService
    | undefined;
  const [accounts, setAccounts] = useState<AccountEntry[]>([]);
  const [activeAccount, setActiveAccount] = useState<AccountEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [claimAllRunning, setClaimAllRunning] = useState(false);
  const [claimAllProgress, setClaimAllProgress] = useState<{ done: number; total: number } | null>(null);
  const [claimAllResults, setClaimAllResults] = useState<MarketingClaimAllAccountResult[] | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await svc.getAccounts();
      const active = await svc.getActiveAccount();
      setAccounts(list);
      setActiveAccount(active);
    } finally {
      setLoading(false);
    }
  }, [svc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeAccountRef = activeAccount
    ? `${activeAccount.provider}:${activeAccount.identity}`
    : null;

  const handleSwitch = async (accountRef: string) => {
    const entry = await svc.switchAccount(accountRef);
    // 更新全局 user，让左下角/侧栏不再判未登录。
    if (entry) {
      setUser({
        id: entry.identity,
        username: entry.username,
        displayName: entry.displayName,
        ...(entry.avatarUrl ? { avatarUrl: entry.avatarUrl } : {}),
      });
    }
    // 切号由 node.ts 触发 account source 刷新，provider 视图/套餐通过 onDidChange 自动更新。
    await refresh();
  };

  const handleLogout = async (accountRef: string) => {
    await svc.logoutAccount(accountRef);
    await refresh();
    const active = await svc.getActiveAccount();
    if (active) {
      setUser({
        id: active.identity,
        username: active.username,
        displayName: active.displayName,
        ...(active.avatarUrl ? { avatarUrl: active.avatarUrl } : {}),
      });
    } else {
      setUser(null);
    }
  };

  const handleRemoveAccount = async (accountRef: string) => {
    await svc.removeAccount(accountRef);
    await refresh();
    const active = await svc.getActiveAccount();
    if (active) {
      setUser({
        id: active.identity,
        username: active.username,
        displayName: active.displayName,
        ...(active.avatarUrl ? { avatarUrl: active.avatarUrl } : {}),
      });
    } else {
      setUser(null);
    }
  };

  const hasAccounts = accounts.length > 0;

  /** 一键领取：按各账号 per-account 凭据直领（不切换激活账号），完成后汇总结果。 */
  const handleClaimAll = async () => {
    if (claimAllRunning || !claimService || !touchService) return;
    setClaimAllRunning(true);
    setClaimAllResults(null);
    setClaimAllProgress({ done: 0, total: accounts.length });
    try {
      const results = await claimMarketingForAllAccounts({
        listAccounts: () => svc.getAccounts(),
        queryTouch: (accountRef) => touchService.query({ locale, accountRef }),
        getCaptchaConfig: () => claimService.getCaptchaConfig(),
        claimManualPlan: (input) => claimService.claimManualPlan(input),
        getManualClaimPlanPlans: (input) => claimService.getManualClaimPlanPlans(input),
        locale,
        messages: {
          captchaFailed: intl.formatMessage({ id: "marketing.captchaFailed" }),
          captchaLoadFailed: intl.formatMessage({ id: "marketing.captchaLoadFailed" }),
          claimFailed: intl.formatMessage({ id: "marketing.claimFailed" }),
        },
        onProgress: (done, total) => setClaimAllProgress({ done, total }),
      });
      setClaimAllResults(results);
    } finally {
      setClaimAllRunning(false);
      setClaimAllProgress(null);
    }
  };

  const claimAllStatusLabel = (result: MarketingClaimAllAccountResult): string => {
    switch (result.status) {
      case "claimed":
        return intl.formatMessage({ id: "settings.accounts.claimAll.claimed" });
      case "already-claimed":
        return intl.formatMessage({ id: "settings.accounts.claimAll.alreadyClaimed" });
      case "no-campaign":
        return intl.formatMessage({ id: "settings.accounts.claimAll.noCampaign" });
      default:
        return intl.formatMessage({ id: "settings.accounts.claimAll.failed" });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-foreground-subtle">
          {intl.formatMessage({ id: "settings.accounts.description" })}
        </p>
        <Button size="default" onClick={onOpenLogin}>
          {intl.formatMessage({ id: "settings.accounts.add" })}
        </Button>
      </div>
      <SettingsGroupCard>
        <div className="flex flex-col gap-4 px-6 py-5">

        {loading && !hasAccounts ? (
          <div className="flex items-center justify-center rounded-xl border border-dashed py-10 text-sm text-muted-foreground">
            {intl.formatMessage({ id: "settings.accounts.loading" })}
          </div>
        ) : !hasAccounts ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-10 text-center">
            <span className="text-sm text-muted-foreground">
              {intl.formatMessage({ id: "settings.accounts.empty" })}
            </span>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {accounts.map((account) => {
              const ref = `${account.provider}:${account.identity}`;
              const isActive = ref === activeAccountRef;
              return (
                <li
                  key={ref}
                  className="flex items-center gap-4 rounded-xl border bg-card p-4 shadow-sm"
                >
                  <AccountAvatar account={account} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{account.displayName}</span>
                      <ProviderBadge provider={account.provider} />
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {account.username}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={intl.formatMessage({ id: "settings.accounts.delete" })}
                      onClick={() => void handleRemoveAccount(ref)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                    {isActive ? (
                      <span className="shrink-0 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                        {intl.formatMessage({ id: "settings.accounts.active" })}
                      </span>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => void handleSwitch(ref)}>
                        {intl.formatMessage({ id: "settings.accounts.switch" })}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {hasAccounts && (
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Button
              variant="outline"
              disabled={claimAllRunning || !claimService || !touchService}
              onClick={() => void handleClaimAll()}
            >
              {claimAllRunning ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <Gift className="size-3.5" />
              )}
              {claimAllRunning && claimAllProgress
                ? intl.formatMessage(
                    { id: "settings.accounts.claimAll.running" },
                    { done: claimAllProgress.done, total: claimAllProgress.total },
                  )
                : intl.formatMessage({ id: "settings.accounts.claimAll" })}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (activeAccountRef) void handleLogout(activeAccountRef);
              }}
            >
              {intl.formatMessage({ id: "settings.accounts.logout" })}
            </Button>
          </div>
        )}

        {claimAllResults ? (
          <ul className="flex flex-col gap-1.5 border-t border-border pt-3 text-sm">
            {claimAllResults.map((result) => (
              <li key={result.accountRef} className="flex min-w-0 flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{result.displayName}</span>
                  <ProviderBadge provider={result.provider} />
                  <span
                    className={
                      result.status === "claimed"
                        ? "ml-auto shrink-0 text-success"
                        : result.status === "failed"
                          ? "ml-auto shrink-0 text-destructive"
                          : "ml-auto shrink-0 text-muted-foreground"
                    }
                  >
                    {claimAllStatusLabel(result)}
                  </span>
                </div>
                {result.message && (result.status === "failed" || result.status === "already-claimed") ? (
                  <div className="truncate text-xs text-muted-foreground">{result.message}</div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        </div>
      </SettingsGroupCard>
    </div>
  );
}
