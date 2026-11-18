import { useCallback, useEffect, useRef, useState } from "react";
import { Gift, Loader2Icon, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeStore } from "@/store/StoreProvider.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard } from "@/settings/SettingsPageParts.js";
import {
  AccountAvatar,
  AccountFamilyControls,
  ClaimAllResultsPanel,
  ProviderBadge,
  claimStatusLabel,
} from "@/settings/AccountSettingsParts.js";
import {
  claimMarketingForAccount,
  claimMarketingForAllAccounts,
  type MarketingClaimAllAccountResult,
} from "@/lib/marketingClaimAll.js";
import { ProviderAccountBinding } from "./model-provider-section/ProviderAccountBinding.js";
import { AutoCheckinSettings } from "./model-provider-section/AutoCheckinSettings.js";
import { AccountPaginationBar, useAccountPagination } from "./model-provider-section/AccountPagination.js";
import type {
  MarketingCaptchaConfig,
  MarketingClaimPlanResponse,
  MarketingTouchSnapshot,
} from "@zcode/shared";

/** 账号分组显示顺序；Z.AI 在前与供应商页顺序一致。 */
const PROVIDER_ORDER = ["zai", "bigmodel"];
const PROVIDER_GROUP_LABEL: Record<string, string> = { zai: "Z.AI", bigmodel: "BigModel" };

/** 与 services OAuthAccountEntry 对齐的展示结构（UI 侧本地声明，避免跨包类型耦合）。 */
interface AccountEntry {
  provider: string;
  identity: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  /** 本地 exp 判定的模型凭据过期标记；只作徽标提示，不阻断切换/领取。 */
  zcodeJwtExpired?: boolean;
  /** 用户自定义备注；空/缺席回落显示 username。 */
  remark?: string;
}

/** @zcode/services 的 dist 类型尚未包含新增的账号接口，运行时已存在，这里局部断言以过编译。 */
interface OAuthAccountService {
  getAccounts(): Promise<AccountEntry[]>;
  getActiveAccount(): Promise<AccountEntry | null>;
  switchAccount(accountRef: string): Promise<AccountEntry | null>;
  logoutAccount(accountRef: string): Promise<void>;
  removeAccount(accountRef: string): Promise<void>;
  updateAccountRemark(accountRef: string, remark: string): Promise<AccountEntry | null>;
  listAutoClaimSettings(): Promise<
    Array<{ accountRef: string; enabled: boolean; time: string }>
  >;
  updateAutoClaimSettings(
    accountRef: string,
    update: { enabled?: boolean; time?: string },
  ): Promise<{ enabled: boolean; time: string }>;
  listAutoActivity(): Promise<
    Array<{
      kind: "auto-checkin" | "auto-claim";
      accountRef: string;
      status: string;
      message?: string;
      at: string;
    }>
  >;
  updateAutoClaimSettingsBatch(
    accountRefs: string[],
    update: { enabled?: boolean; time?: string },
  ): Promise<{ accountRef: string; ok: boolean; error?: string }[]>;
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
  getManualClaimPlanPlans(input: { accountRef: string }): Promise<{
    plans: Array<{
      planId?: string;
      name?: string;
      status?: string;
      endsAt?: number | string | null;
    }>;
  }>;
}

interface MarketingTouchQueryCapableService {
  // host 的 query 走 parseMarketingTouchResponse，返回的是新 schema 快照
  // （deliveries 里动作在 banner/popup.buttons[].action，不是旧的 campaign.actions）。
  query(input: { locale: string; accountRef?: string }): Promise<MarketingTouchSnapshot>;
}

export function AccountSettingsSection({
  onOpenLogin,
}: {
  onLogin?: () => void;
  onOpenLogin?: () => void;
  onLogout?: () => void;
}) {
  const { intl, locale } = useZCodeIntl();
  const { oauthService, codingPlanSubscriptionService, marketingTouchService } = useServices();
  const setUser = useZCodeStore((state) => state.setUser);
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
  const [claimAllProgress, setClaimAllProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [claimAllResults, setClaimAllResults] = useState<MarketingClaimAllAccountResult[] | null>(
    null,
  );
  /** 单账号领取：当前运行中的 accountRef + 各账号最近一次结果。 */
  const [claimingRef, setClaimingRef] = useState<string | null>(null);
  const [claimOneResults, setClaimOneResults] = useState<
    Record<string, MarketingClaimAllAccountResult>
  >({});
  const [autoClaimRows, setAutoClaimRows] = useState<
    Array<{
      accountId: string;
      accountName: string;
      provider: string;
      enabled: boolean;
      time: string;
    }>
  >([]);
  const [autoClaimSavingId, setAutoClaimSavingId] = useState<string | null>(null);
  const [autoClaimBatchRunning, setAutoClaimBatchRunning] = useState(false);
  /** 自动领取面板跟随账号 Tab：只显示当前渠道（zai/bigmodel）的账号行。 */
  const [autoClaimTab, setAutoClaimTab] = useState<string>("zai");
  const [autoActivity, setAutoActivity] = useState<
    Array<{
      kind: string;
      accountRef: string;
      status: string;
      message?: string;
      at: string;
    }>
  >([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await svc.getAccounts();
      const active = await svc.getActiveAccount();
      setAccounts(list);
      setActiveAccount(active);
      try {
        const claimSettings = await svc.listAutoClaimSettings();
        setAutoClaimRows(
          claimSettings.map((row) => {
            const entry = list.find(
              (item) => `${item.provider}:${item.identity}` === row.accountRef,
            );
            return {
              accountId: row.accountRef,
              accountName: entry?.displayName ?? row.accountRef,
              provider: row.accountRef.slice(0, row.accountRef.indexOf(":")),
              enabled: row.enabled,
              time: row.time,
            };
          }),
        );
      } catch {
        // 自动领取设置拉取失败不阻断账号列表。
      }
      try {
        setAutoActivity(await svc.listAutoActivity());
      } catch {
        // 活动日志拉取失败同样不阻断。
      }
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

  /**
   * 单账号领取：与一键领取同一条 claimForAccount 链路，仅领该账号。
   * 验证码弹窗是全局互斥的 UI，因此任意领取进行中时其他领取按钮全部禁用。
   */
  /** 切换某账号的自动领取开关（局部更新，host 落盘）。 */
  const handleAutoClaimToggle = async (accountRef: string, enabled: boolean) => {
    setAutoClaimSavingId(accountRef);
    setAutoClaimRows((prev) =>
      prev.map((row) => (row.accountId === accountRef ? { ...row, enabled } : row)),
    );
    try {
      await svc.updateAutoClaimSettings(accountRef, { enabled });
    } catch {
      // 保存失败时回滚由下次 refresh 收敛。
    }
    setAutoClaimSavingId(null);
  };

  /** 修改某账号的自动领取时间（host 先校验 HH:MM 再落盘）。 */
  const handleAutoClaimTime = async (accountRef: string, time: string) => {
    setAutoClaimSavingId(accountRef);
    setAutoClaimRows((prev) =>
      prev.map((row) => (row.accountId === accountRef ? { ...row, time } : row)),
    );
    try {
      await svc.updateAutoClaimSettings(accountRef, { time });
    } catch {
      // 同上。
    }
    setAutoClaimSavingId(null);
  };

  /** 批量开启/关闭当前面板 Tab 的全部账号自动领取。 */
  const handleAutoClaimBatchToggle = async (enabled: boolean) => {
    const accountRefs = autoClaimRows
      .filter((row) => row.provider === autoClaimTab)
      .map((row) => row.accountId);
    if (accountRefs.length === 0) return;
    setAutoClaimBatchRunning(true);
    // 先本地全量回显（失败账号由 refresh 收敛回真实值）。
    setAutoClaimRows((prev) =>
      prev.map((row) =>
        accountRefs.includes(row.accountId) ? { ...row, enabled } : row,
      ),
    );
    try {
      await svc.updateAutoClaimSettingsBatch(accountRefs, { enabled });
    } catch {
      // 批量接口整体失败时由 refresh 收敛。
    }
    setAutoClaimBatchRunning(false);
  };

  const handleClaimOne = async (account: AccountEntry) => {
    const ref = `${account.provider}:${account.identity}`;
    if (claimingRef || claimAllRunning || !claimService || !touchService) return;
    setClaimingRef(ref);
    try {
      const result = await claimMarketingForAccount(
        {
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
        },
        { accountRef: ref, displayName: account.displayName, provider: account.provider },
      );
      setClaimOneResults((prev) => ({ ...prev, [ref]: result }));
    } catch (error) {
      setClaimOneResults((prev) => ({
        ...prev,
        [ref]: {
          accountRef: ref,
          displayName: account.displayName,
          provider: account.provider,
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        },
      }));
    } finally {
      setClaimingRef(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-foreground-subtle">
          {intl.formatMessage({ id: "settings.accounts.description" })}
        </p>
        <Button
          size="default"
          data-debug-onopenlogin={typeof onOpenLogin}
          onClick={
            onOpenLogin ??
            (() => {
              // 兜底不该发生：Root 未传 onOpenLogin 时按钮会静默失效。
              // 这里留一条可见痕迹，避免再出现「点了没反应也没报错」。
              console.error("[AccountSettingsSection] onOpenLogin is missing");
            })
          }
        >
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
            <AccountTabsBlock
              accounts={accounts}
              activeAccountRef={activeAccountRef}
              claimOneResults={claimOneResults}
              claimingRef={claimingRef}
              claimAllRunning={claimAllRunning}
              claimService={claimService}
              touchService={touchService}
              intl={intl}
              onSwitch={handleSwitch}
              onClaimOne={handleClaimOne}
              onRemove={handleRemoveAccount}
              onRemarkSave={(ref, value) =>
                svc
                  .updateAccountRemark(ref, value)
                  .then((next) => {
                    if (!next) return;
                    setAccounts((prev) =>
                      prev.map((entry) =>
                        `${entry.provider}:${entry.identity}` === ref
                          ? { ...entry, remark: next.remark }
                          : entry,
                      ),
                    );
                  })
                  .catch(() => undefined)
              }
            />
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

          {/* 自动领取（营销权益）：每账号独立开关 + HH:MM，host 侧调度；
              复用自动签到的折叠面板与交互。 */}
          <AutoCheckinSettings
            intlKeyPrefix="settings.accounts.autoClaim"
            rows={autoClaimRows.filter((row) => row.provider === autoClaimTab)}
            savingAccountId={autoClaimSavingId}
            onToggle={(accountId, enabled) => void handleAutoClaimToggle(accountId, enabled)}
            onChangeTime={(accountId, time) => void handleAutoClaimTime(accountId, time)}
            onBatchToggle={(enabled) => void handleAutoClaimBatchToggle(enabled)}
            batchRunning={autoClaimBatchRunning}
            headerExtra={
              <div role="tablist" className="flex items-center gap-1">
                {["zai", "bigmodel"].map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={tab === autoClaimTab}
                    className={
                      "rounded-md px-2 py-0.5 text-xs transition-colors " +
                      (tab === autoClaimTab
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:text-foreground")
                    }
                    onClick={() => setAutoClaimTab(tab)}
                  >
                    {PROVIDER_GROUP_LABEL[tab] ?? tab}
                  </button>
                ))}
              </div>
            }
          />

          {autoActivity.some((record) =>
            record.accountRef.startsWith(`${autoClaimTab}:`),
          ) ? (
            <div className="space-y-1 rounded-lg border border-border px-3 py-2 text-xs text-foreground-subtle">
              <div className="font-medium text-foreground">
                {intl.formatMessage({ id: "settings.accounts.autoActivity.title" })}
              </div>
              <ul className="space-y-0.5">
                {autoActivity
                  // 活动记录是全局的（qoder/codebuddy 签到 + zai/bigmodel 领取共用一份），
                  // 面板跟随当前 Tab 只显示本渠道账号的记录（accountRef 前缀 = 渠道 id）。
                  .filter((record) => record.accountRef.startsWith(`${autoClaimTab}:`))
                  .slice(0, 8)
                  .map((record) => (
                  <li key={`${record.kind}:${record.accountRef}`} className="flex gap-2">
                    <span className="shrink-0 text-muted-foreground">
                      {new Date(record.at).toLocaleString()}
                    </span>
                    <span className="shrink-0">
                      {record.kind === "auto-claim"
                        ? intl.formatMessage({ id: "settings.accounts.autoActivity.claim" })
                        : intl.formatMessage({ id: "settings.accounts.autoActivity.checkin" })}
                    </span>
                    <span className="min-w-0 truncate">{record.accountRef}</span>
                    <span
                      className={
                        "ml-auto shrink-0 " +
                        (record.status === "claimed"
                          ? "text-success"
                          : record.status === "failed"
                            ? "text-destructive"
                            : "text-muted-foreground")
                      }
                      title={record.message ?? ""}
                    >
                      {intl.formatMessage({
                        id: `settings.accounts.autoActivity.status.${record.status}`,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {claimAllResults ? <ClaimAllResultsPanel results={claimAllResults} /> : null}
        </div>
      </SettingsGroupCard>
    </div>
  );
}


/**
 * 账号卡片 + Tab 切换：Z.AI / BigModel 一个 Tab 一个渠道，选中哪个 Tab
 * 显示哪个渠道的账号（族控件 + 列表 + 分页都是当前 Tab 的）。
 * 每个渠道独立分页；族级出口/轮询控件跟随 Tab。
 */
function AccountTabsBlock({
  accounts,
  activeAccountRef,
  claimOneResults,
  claimingRef,
  claimAllRunning,
  claimService,
  touchService,
  intl,
  onSwitch,
  onClaimOne,
  onRemove,
  onRemarkSave,
}: {
  accounts: AccountEntry[];
  activeAccountRef: string | null;
  claimOneResults: Record<string, MarketingClaimAllAccountResult>;
  claimingRef: string | null;
  claimAllRunning: boolean;
  claimService: unknown;
  touchService: unknown;
  intl: ReturnType<typeof useZCodeIntl>["intl"];
  onSwitch: (accountRef: string) => Promise<void>;
  onClaimOne: (account: AccountEntry) => Promise<void>;
  onRemove: (accountRef: string) => Promise<void>;
  onRemarkSave: (accountRef: string, value: string) => void;
}) {
  const availableProviders = PROVIDER_ORDER.filter((provider) =>
    accounts.some((account) => account.provider === provider),
  );
  const [activeTab, setActiveTab] = useState<string>(availableProviders[0] ?? "zai");
  const provider = availableProviders.includes(activeTab) ? activeTab : availableProviders[0] ?? "zai";
  const providerAccounts = accounts.filter((account) => account.provider === provider);
  const page = useAccountPagination(providerAccounts);
  return (
    <section className="flex flex-col gap-3">
      {/* Tab 栏：Z.AI / BigModel；切换显示对应渠道的账号 */}
      <div role="tablist" className="flex items-center gap-1 border-b border-border">
        {availableProviders.map((tabProvider) => (
          <button
            key={tabProvider}
            type="button"
            role="tab"
            aria-selected={tabProvider === provider}
            className={
              "rounded-t-md px-3 py-1.5 text-sm transition-colors " +
              (tabProvider === provider
                ? "border-b-2 border-primary font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground")
            }
            onClick={() => setActiveTab(tabProvider)}
          >
            {PROVIDER_GROUP_LABEL[tabProvider] ?? tabProvider}
            <span className="ml-1.5 text-xs text-muted-foreground">
              {accounts.filter((account) => account.provider === tabProvider).length}
            </span>
          </button>
        ))}
      </div>
      <AccountFamilyControls accounts={providerAccounts} />
      <ul className="flex flex-col gap-3">
        {page.pageItems.map((account) => {
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
                <AccountRemark
                  username={account.username}
                  remark={account.remark}
                  onSave={(value) => onRemarkSave(ref, value)}
                />
                <ProviderAccountBinding providerId={account.provider} accountId={ref} />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {claimOneResults[ref] ? (
                  <span
                    className="max-w-36 truncate text-xs text-muted-foreground"
                    title={claimOneResults[ref].message ?? ""}
                  >
                    {claimStatusLabel(intl, claimOneResults[ref])}
                  </span>
                ) : null}
                {account.zcodeJwtExpired ? (
                  <span
                    className="shrink-0 rounded-full bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning"
                    title={intl.formatMessage({ id: "settings.accounts.expiredHint" })}
                  >
                    {intl.formatMessage({ id: "settings.accounts.expiredBadge" })}
                  </span>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={
                    claimingRef !== null ||
                    claimAllRunning ||
                    !claimService ||
                    !touchService
                  }
                  onClick={() => void onClaimOne(account)}
                >
                  {claimingRef === ref ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : (
                    <Gift className="size-3.5" />
                  )}
                  {intl.formatMessage({ id: "settings.accounts.claimOne" })}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={intl.formatMessage({ id: "settings.accounts.delete" })}
                  onClick={() => void onRemove(ref)}
                >
                  <Trash2 className="size-4" />
                </Button>
                {isActive ? (
                  <span className="shrink-0 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                    {intl.formatMessage({ id: "settings.accounts.active" })}
                  </span>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => void onSwitch(ref)}>
                    {intl.formatMessage({ id: "settings.accounts.switch" })}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {page.needsPagination ? (
        <AccountPaginationBar
          page={page.page}
          totalPages={page.totalPages}
          pageSize={page.pageSize}
          onChange={page.setPage}
          onPageSizeChange={page.setPageSize}
        />
      ) : null}
    </section>
  );
}

/**
 * 账号备注：双击进入编辑，回车/失焦保存，Esc 取消。
 *
 * 平时显示备注（无备注回落 username）。备注只改展示名，不影响凭据与切换。
 */
function AccountRemark({
  username,
  remark,
  onSave,
}: {
  username: string;
  remark?: string;
  onSave: (value: string) => void;
}) {
  const { intl } = useZCodeIntl();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(remark ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(remark ?? "");
      // 双击后聚焦并把光标移到末尾，方便在现有备注上追加。
      queueMicrotask(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(
          inputRef.current.value.length,
          inputRef.current.value.length,
        );
      });
    }
  }, [editing, remark]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed === (remark ?? "")) return;
    onSave(trimmed);
  };

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        placeholder={username}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setEditing(false);
          }
        }}
        className="h-6 max-w-48 text-xs"
      />
    );
  }

  return (
    <div
      className="max-w-48 cursor-text truncate text-xs text-muted-foreground"
      title={intl.formatMessage({ id: "settings.accounts.remarkHint" })}
      onDoubleClick={(event) => {
        event.preventDefault();
        setEditing(true);
      }}
    >
      {remark?.trim() || username}
    </div>
  );
}
