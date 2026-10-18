/* oxlint-disable max-lines -- 双区登录 UI+账号列表集中，拆分会让双区差异逻辑重复。 */
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, Gift, Info, Loader2Icon, LogIn, RefreshCw, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { Switch } from "@/components/ui/switch.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";
import { TECHNICAL_INPUT_ATTRIBUTES } from "@/lib/technicalInputAttributes.js";
import type { CodeBuddyCheckinStats } from "@zcode/services";
import { AccountQuotaInline, AccountQuotaSummaryLine, useAccountQuota } from "./ProviderQuotaSection.js";
import {
  ProviderAccountBinding,
  ProviderAccountRotationControl,
  ProviderProxyBatchActions,
} from "./ProviderAccountBinding.js";

/**
 * XCode fork：CodeBuddy（其他登录型供应商）登录区，渲染在供应商详情模型列表上方。
 *
 * 双模式 + 多账号（对齐 9router Connect 弹窗）：
 *  - OAuth：host 获取 state+authUrl → **系统浏览器**授权（platform.openExternal）
 *    → 每 5s 轮询 → 账号入列表并激活 → 激活令牌写入供应商 overlay 的 access.apiKey。
 *  - API Key：直接粘贴访问令牌，写入同一位置。
 * 账号列表支持切换（写对应令牌进 overlay）与删除（删激活账号时自动回落剩余账号）。
 *
 * XCode fork：签到（billing meter 流程，见 codebuddyCheckin.ts）——每账号
 * 「签到」按钮 + 批量「全部签到」+ 本地累计统计回显；另提供每账号自动签到
 * 设置（开关 + HH:MM，半点粒度选项），到点由 host 侧调度器自动领取。
 */

type LoginPhase =
  | { kind: "idle" }
  | { kind: "opening" }
  | { kind: "waiting"; authUrl: string; state: string }
  | { kind: "saving" };

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

/** 批量签到结果回显用的聚合键（不对应任何账号）。 */
const CHECKIN_ALL_KEY = "__all__";

/** 半点粒度的小时:分钟选项（0:00 / 0:30 / … / 23:30），与 host 侧选项一致。 */
const AUTO_CHECKIN_TIME_OPTIONS: readonly string[] = Array.from(
  { length: 48 },
  (_, index) =>
    `${`${Math.floor(index / 2)}`.padStart(2, "0")}:${index % 2 === 0 ? "00" : "30"}`,
);

interface AutoCheckinSettingRow {
  accountId: string;
  accountName: string;
  enabled: boolean;
  time: string;
}

interface AccountRow {
  id: string;
  displayName: string;
  email?: string;
  expiresAt: number;
  active: boolean;
  accessToken: string;
}

export function CodeBuddyLoginSection({
  providerId,
  region,
  name,
}: {
  providerId: string;
  region: "cn" | "intl";
  /** 供应商显示名（CN 带 CN 后缀，Intl 不带），登录区文案按其插值。 */
  name: string;
}) {
  const { intl } = useXCodeIntl();
  // 设置页不在 PlatformProvider 内时回退 window.open（Electron 下开新窗口）。
  const platform = useOptionalPlatform();
  const { providerSettingsService } = useServices();
  const [phase, setPhase] = useState<LoginPhase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<readonly AccountRow[]>([]);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  /** 签到忙碌标记：账号 id 或 CHECKIN_ALL_KEY（批量）。 */
  const [checkinBusyId, setCheckinBusyId] = useState<string | null>(null);
  /** 签到结果回显：账号 id / CHECKIN_ALL_KEY → 文案。 */
  const [checkinMessages, setCheckinMessages] = useState<Record<string, string>>({});
  /** 各账号本地签到统计（accountId → 累计天数等；只读，不上行）。 */
  const [checkinStatsMap, setCheckinStatsMap] = useState<ReadonlyMap<string, CodeBuddyCheckinStats>>(
    () => new Map(),
  );
  /** 每账号自动签到设置（随账号列表刷新）。 */
  const [autoCheckinRows, setAutoCheckinRows] = useState<readonly AutoCheckinSettingRow[]>([]);
  const [autoCheckinSavingId, setAutoCheckinSavingId] = useState<string | null>(null);
  /** 账号详情弹窗（令牌有效期等低频信息）。 */
  const [detailAccount, setDetailAccount] = useState<AccountRow | null>(null);
  /** 本区账号额度（剩余/总额），按 accountId 索引；账号行内联展示。 */
  const accountQuota = useAccountQuota({ family: "codebuddy", region });
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseRef = useRef<LoginPhase>(phase);
  phaseRef.current = phase;

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const refreshAccounts = useCallback(async () => {
    try {
      const result = await providerSettingsService.codebuddyListAccounts(region);
      setAccounts(result.accounts);
      // 并行拉本地签到统计（纯本地历史，不上行任何请求）与自动签到设置；
      // 失败按"无统计/默认关闭"处理，不阻断账号列表。
      const [statsEntries, autoCheckin] = await Promise.all([
        Promise.all(
          result.accounts.map(async (account) => {
            try {
              const stats = await providerSettingsService.codebuddyCheckinStats({
                region,
                accountId: account.id,
              });
              return [account.id, stats] as const;
            } catch {
              return [account.id, null] as const;
            }
          }),
        ),
        providerSettingsService.codebuddyListAutoCheckin(region).catch(() => [] as AutoCheckinSettingRow[]),
      ]);
      const statsMap = new Map<string, CodeBuddyCheckinStats>();
      for (const [accountId, stats] of statsEntries) {
        if (stats) statsMap.set(accountId, stats);
      }
      setCheckinStatsMap(statsMap);
      setAutoCheckinRows(autoCheckin);
      return result;
    } catch (listError) {
      logger.warn("[CodeBuddyLogin] 拉取账号列表失败", listError);
      return null;
    }
  }, [providerSettingsService, region]);

  const writeAccessToken = useCallback(
    async (accessToken: string) => {
      // 激活账号的令牌写入供应商 personal overlay 的 access.apiKey，
      // 执行链按普通 openai-compatible Bearer 发送。
      const current = await providerSettingsService.getView();
      const provider = current.providers.find((item) => item.providerId === providerId);
      const previous = provider?.personalConfig;
      await providerSettingsService.savePersonalProviderOverlay(providerId, {
        ...previous,
        access: { type: "api-key", apiKey: accessToken },
      });
    },
    [providerId, providerSettingsService],
  );

  useEffect(() => {
    if (phase.kind === "idle") void refreshAccounts();
  }, [phase, refreshAccounts]);

  const startLogin = useCallback(async () => {
    setError(null);
    setPhase({ kind: "opening" });
    try {
      const session = await providerSettingsService.codebuddyBeginLogin(region);
      // 系统浏览器打开（对齐官方登录；渲染端 window.open 会落在内嵌环境）。
      if (platform) platform.openExternal(session.authUrl);
      else window.open(session.authUrl, "_blank", "noopener");
      setPhase({ kind: "waiting", authUrl: session.authUrl, state: session.state });
      const startedAt = Date.now();
      stopPolling();
      pollTimerRef.current = setInterval(async () => {
        if (phaseRef.current.kind !== "waiting") return;
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          stopPolling();
          setPhase({ kind: "idle" });
          setError(intl.formatMessage({ id: "settings.codebuddy.loginTimeout" }));
          return;
        }
        const result = await providerSettingsService.codebuddyPollLogin(region, session.state);
        if (result.status === "pending") return;
        stopPolling();
        if (result.status === "ok") {
          setPhase({ kind: "saving" });
          try {
            await writeAccessToken(result.accessToken);
            await refreshAccounts();
            setPhase({ kind: "idle" });
          } catch (saveError) {
            logger.warn("[CodeBuddyLogin] 写入访问令牌失败", saveError);
            setPhase({ kind: "idle" });
            setError(saveError instanceof Error ? saveError.message : String(saveError));
          }
          return;
        }
        setPhase({ kind: "idle" });
        setError(result.message);
      }, POLL_INTERVAL_MS);
      timeoutRef.current = setTimeout(() => {
        stopPolling();
        setPhase({ kind: "idle" });
        setError(intl.formatMessage({ id: "settings.codebuddy.loginTimeout" }));
      }, POLL_TIMEOUT_MS + POLL_INTERVAL_MS);
    } catch (loginError) {
      logger.warn("[CodeBuddyLogin] 发起登录失败", loginError);
      setPhase({ kind: "idle" });
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    }
  }, [intl, platform, providerSettingsService, region, refreshAccounts, stopPolling, writeAccessToken]);

  const switchAccount = useCallback(
    async (id: string) => {
      setSwitchingId(id);
      setError(null);
      try {
        const account = await providerSettingsService.codebuddySwitchAccount(region, id);
        if (account) await writeAccessToken(account.accessToken);
        await refreshAccounts();
      } catch (switchError) {
        logger.warn("[CodeBuddyLogin] 切换账号失败", switchError);
        setError(switchError instanceof Error ? switchError.message : String(switchError));
      }
      setSwitchingId(null);
    },
    [providerSettingsService, refreshAccounts, writeAccessToken],
  );

  const removeAccount = useCallback(
    async (id: string) => {
      setSwitchingId(id);
      setError(null);
      try {
        const result = await providerSettingsService.codebuddyRemoveAccount(region, id);
        if (result.activeAccessToken) await writeAccessToken(result.activeAccessToken);
        await refreshAccounts();
      } catch (removeError) {
        logger.warn("[CodeBuddyLogin] 删除账号失败", removeError);
        setError(removeError instanceof Error ? removeError.message : String(removeError));
      }
      setSwitchingId(null);
    },
    [providerSettingsService, refreshAccounts, writeAccessToken],
  );

  const saveApiKey = useCallback(async () => {
    const token = apiKeyInput.trim();
    if (!token) return;
    setApiKeySaving(true);
    setError(null);
    try {
      await writeAccessToken(token);
      setApiKeyInput("");
    } catch (saveError) {
      logger.warn("[CodeBuddyLogin] 写入 API Key 失败", saveError);
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    }
    setApiKeySaving(false);
  }, [apiKeyInput, providerSettingsService, writeAccessToken]);

  const copyAuthUrl = useCallback(async (authUrl: string) => {
    try {
      await navigator.clipboard.writeText(authUrl);
    } catch {
      // 剪贴板失败静默（用户可手选复制）。
    }
  }, []);

  /**
   * 单账号签到：走 host 的 billing meter 流程（状态查询 → daily-checkin 领取），
   * 完成后刷新本地统计与自动签到行（领取成功后当天本地账本已记）。
   */
  const runCheckin = useCallback(
    async (accountId: string) => {
      setCheckinBusyId(accountId);
      setError(null);
      try {
        const result = await providerSettingsService.codebuddyCheckin({ region, accountId });
        setCheckinMessages((prev) => ({ ...prev, [accountId]: result.message }));
        const stats = await providerSettingsService.codebuddyCheckinStats({ region, accountId });
        setCheckinStatsMap((prev) => new Map(prev).set(accountId, stats));
      } catch (checkinError) {
        logger.warn("[CodeBuddyLogin] 签到失败", checkinError);
        setCheckinMessages((prev) => ({
          ...prev,
          [accountId]:
            checkinError instanceof Error ? checkinError.message : String(checkinError),
        }));
      }
      setCheckinBusyId(null);
    },
    [providerSettingsService, region],
  );

  /**
   * 批量签到：只扫本区已登录账号（cn/intl 两个供应商区各自独立；host 侧
   * 并发 4 分片执行，UI 只按当前区收敛，避免在 CN 区把国际号一起签掉）。
   */
  const runCheckinAll = useCallback(async () => {
    setCheckinBusyId(CHECKIN_ALL_KEY);
    setError(null);
    try {
      const { results } = await providerSettingsService.codebuddyCheckinAll({ regions: [region] });
      const nextMessages: Record<string, string> = {};
      let claimed = 0;
      let already = 0;
      let noActivity = 0;
      let failed = 0;
      for (const result of results) {
        nextMessages[result.accountId] = result.message;
        if (result.status === "claimed") claimed += 1;
        else if (result.status === "already") already += 1;
        else if (result.status === "no_activity") noActivity += 1;
        else failed += 1;
      }
      nextMessages[CHECKIN_ALL_KEY] = intl.formatMessage(
        { id: "settings.codebuddy.checkinBatchSummary" },
        {
          claimed: String(claimed),
          already: String(already),
          noActivity: String(noActivity),
          failed: String(failed),
        },
      );
      setCheckinMessages((prev) => ({ ...prev, ...nextMessages }));
      await refreshAccounts();
    } catch (checkinError) {
      logger.warn("[CodeBuddyLogin] 批量签到失败", checkinError);
      setCheckinMessages((prev) => ({
        ...prev,
        [CHECKIN_ALL_KEY]:
          checkinError instanceof Error ? checkinError.message : String(checkinError),
      }));
    }
    setCheckinBusyId(null);
  }, [intl, providerSettingsService, refreshAccounts, region]);

  /** 切换某账号的自动签到开关（局部更新，host 落盘）。 */
  const toggleAutoCheckin = useCallback(
    async (accountId: string, enabled: boolean) => {
      setAutoCheckinSavingId(accountId);
      setError(null);
      // 乐观更新，失败回滚。
      setAutoCheckinRows((prev) =>
        prev.map((row) => (row.accountId === accountId ? { ...row, enabled } : row)),
      );
      try {
        await providerSettingsService.codebuddyUpdateAutoCheckin(region, accountId, { enabled });
      } catch (saveError) {
        logger.warn("[CodeBuddyLogin] 保存自动签到开关失败", saveError);
        setAutoCheckinRows((prev) =>
          prev.map((row) => (row.accountId === accountId ? { ...row, enabled: !enabled } : row)),
        );
        setError(
          saveError instanceof Error ? saveError.message : String(saveError),
        );
      }
      setAutoCheckinSavingId(null);
    },
    [providerSettingsService, region],
  );

  /** 修改某账号的自动签到时间（host 先校验 HH:MM 再落盘）。 */
  const changeAutoCheckinTime = useCallback(
    async (accountId: string, time: string) => {
      setAutoCheckinSavingId(accountId);
      setError(null);
      try {
        const next = await providerSettingsService.codebuddyUpdateAutoCheckin(region, accountId, {
          time,
        });
        setAutoCheckinRows((prev) =>
          prev.map((row) => (row.accountId === accountId ? { ...row, ...next } : row)),
        );
      } catch (saveError) {
        logger.warn("[CodeBuddyLogin] 保存自动签到时间失败", saveError);
        setError(
          saveError instanceof Error ? saveError.message : String(saveError),
        );
      }
      setAutoCheckinSavingId(null);
    },
    [providerSettingsService, region],
  );

  const waiting = phase.kind === "waiting";
  const busy = phase.kind === "opening" || phase.kind === "saving";

  const formatExpiry = useCallback(
    (expiresAt: number) => {
      const remainingMs = expiresAt - Date.now();
      if (remainingMs <= 0) {
        return intl.formatMessage({ id: "settings.codebuddy.accountExpired" });
      }
      const hours = Math.floor(remainingMs / 3_600_000);
      if (hours < 48) {
        return intl.formatMessage({ id: "settings.codebuddy.accountExpiresIn" }, { hours: String(hours) });
      }
      const days = Math.floor(hours / 24);
      return intl.formatMessage({ id: "settings.codebuddy.accountExpiresDays" }, { days: String(days) });
    },
    [intl],
  );

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="text-ui-base font-medium text-foreground">
        {intl.formatMessage({ id: "settings.codebuddy.title" }, { name })}
      </div>
      <p className="text-ui-sm text-foreground-subtle">
        {intl.formatMessage({ id: "settings.codebuddy.description" }, { name })}
      </p>

      {/* 批量代理池分配：多账号时才有意义，组件内部判空（< 2 个账号不渲染）。 */}
      <ProviderProxyBatchActions providerId={providerId} />
      {/* 账号轮询：fill-first / round-robin + sticky，对齐 9router。 */}
      <ProviderAccountRotationControl providerId={providerId} />

      {/* 账号列表（多账号：切换/删除） */}
      {accounts.length > 0 ? (
        <div className="space-y-1.5">
          {accounts.map((account) => (
            <Fragment key={account.id}>
            {/* 卡片允许换行：额度块在自己的整宽行里，不再受右侧按钮组宽度影响（见下方注释）。 */}
            <div
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-2.5 py-2"
            >
              <UserRound aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-ui-sm text-foreground">
                  {account.displayName}
                  {account.email ? (
                    <span className="ml-1.5 text-foreground-subtle">· {account.email}</span>
                  ) : null}
                  {account.active ? (
                    <span className="ml-1.5 text-foreground-subtle">
                      {intl.formatMessage({ id: "settings.codebuddy.active" })}
                    </span>
                  ) : null}
                </div>
              </div>
              {!account.active ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={switchingId !== null || busy || waiting}
                  onClick={() => void switchAccount(account.id)}
                >
                  {switchingId === account.id ? (
                    <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    intl.formatMessage({ id: "settings.codebuddy.switch" })
                  )}
                </Button>
              ) : null}
              {/* 每日签到（billing meter 领取，host 侧执行）。 */}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={checkinBusyId !== null || switchingId !== null || busy || waiting}
                onClick={() => void runCheckin(account.id)}
              >
                {checkinBusyId === account.id ? (
                  <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Gift className="size-3.5" aria-hidden="true" />
                )}
                {intl.formatMessage({ id: "settings.codebuddy.checkin" })}
              </Button>
              {/* 账号详情：令牌有效期等低频信息集中在此，避免账号行堆叠。 */}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={intl.formatMessage({ id: "settings.codebuddy.accountDetail" })}
                disabled={switchingId !== null || busy || waiting}
                onClick={() => setDetailAccount(account)}
              >
                <Info aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={intl.formatMessage({ id: "settings.codebuddy.remove" })}
                disabled={switchingId !== null || busy || waiting}
                onClick={() => void removeAccount(account.id)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
              {/* 令牌过期时间是低频信息，移入账号详情；行内只留额度。
                  额度块用 w-full 独占一整行：左列的宽度会随右侧按钮数量变化（「使用」
                  只对非当前账号出现，无「使用」的账号行整整一截更宽），额度条留在左列里
                  就会跟着伸缩，多个账号之间无法对比。 */}
              {accountQuota.byAccountId.get(account.id) ? (
                <div className="w-full pl-6 text-ui-sm text-foreground-subtle">
                  <AccountQuotaInline snapshot={accountQuota.byAccountId.get(account.id)} />
                </div>
              ) : null}
              {/* 账号级代理绑定：只在该供应商启用代理且池有条目时渲染（组件内部判空）。 */}
              <div className="w-full pl-6">
                <ProviderAccountBinding providerId={providerId} accountId={account.id} />
              </div>
            </div>
            {/* 本地累计签到统计（只读本地账本，不上行）。 */}
            {(() => {
              const stats = checkinStatsMap.get(account.id);
              if (!stats || stats.totalClaimDays <= 0) return null;
              return (
                <div className="pl-6 text-ui-sm text-foreground-subtle">
                  {intl.formatMessage(
                    { id: "settings.codebuddy.checkinStats" },
                    { days: String(stats.totalClaimDays) },
                  )}
                </div>
              );
            })()}
            {/* 本次签到结果回显（含失败原因，原样透传上游信息）。 */}
            {checkinMessages[account.id] ? (
              <div className="pl-6 text-ui-sm text-foreground-subtle" role="status">
                {checkinMessages[account.id]}
              </div>
            ) : null}
            </Fragment>
          ))}
        </div>
      ) : null}

      {/* 批量签到（当前区域全部账号）与汇总。 */}
      {accounts.length > 0 ? (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || waiting || checkinBusyId !== null}
            onClick={() => void runCheckinAll()}
          >
            {checkinBusyId === CHECKIN_ALL_KEY ? (
              <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Gift className="size-3.5" aria-hidden="true" />
            )}
            {intl.formatMessage({ id: "settings.codebuddy.checkinAll" })}
          </Button>
          {checkinMessages[CHECKIN_ALL_KEY] ? (
            <span className="text-ui-sm text-foreground-subtle" role="status">
              {checkinMessages[CHECKIN_ALL_KEY]}
            </span>
          ) : null}
          {/* 本区额度汇总（账号数/总额/平均/最小/最大），与批量签到同属整区操作。 */}
          <span className="ml-auto">
            <AccountQuotaSummaryLine summary={accountQuota.summary} loading={accountQuota.loading} />
          </span>
        </div>
      ) : null}

      {/* 自动签到设置：每账号独立开关 + HH:MM（半点粒度），host 侧调度。 */}
      {autoCheckinRows.length > 0 ? (
        <details className="text-ui-sm text-foreground-subtle">
          <summary className="cursor-pointer select-none">
            {intl.formatMessage({ id: "settings.codebuddy.autoCheckinTitle" })}
          </summary>
          <p className="mt-2">{intl.formatMessage({ id: "settings.codebuddy.autoCheckinHint" })}</p>
          <div className="mt-2 space-y-1.5">
            {autoCheckinRows.map((row) => (
              <div
                key={row.accountId}
                className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-foreground">{row.accountName}</span>
                <Switch
                  checked={row.enabled}
                  disabled={autoCheckinSavingId !== null}
                  onCheckedChange={(next) => void toggleAutoCheckin(row.accountId, next)}
                  aria-label={intl.formatMessage(
                    { id: "settings.codebuddy.autoCheckinToggle" },
                    { name: row.accountName },
                  )}
                />
                <Select
                  value={row.time}
                  disabled={!row.enabled || autoCheckinSavingId !== null}
                  onValueChange={(next) => void changeAutoCheckinTime(row.accountId, next)}
                >
                  <SelectTrigger size="sm" className="w-24 justify-between">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {AUTO_CHECKIN_TIME_OPTIONS.map((time) => (
                      <SelectItem key={time} value={time}>
                        {time}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="default"
          disabled={busy || waiting}
          onClick={() => void startLogin()}
        >
          {waiting ? (
            <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <LogIn data-icon="inline-start" aria-hidden="true" />
          )}
          {intl.formatMessage({
            id: waiting ? "settings.codebuddy.waiting" : "settings.codebuddy.login",
          })}
        </Button>
      </div>
      {error ? (
        <p className="text-ui-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <details className="text-ui-sm text-foreground-subtle">
        <summary className="cursor-pointer select-none">
          {intl.formatMessage({ id: "settings.codebuddy.apiKeyTitle" })}
        </summary>
        <div className="mt-2 flex gap-2">
          <Input
            {...TECHNICAL_INPUT_ATTRIBUTES}
            type="password"
            size="lg"
            value={apiKeyInput}
            placeholder={intl.formatMessage({ id: "settings.codebuddy.apiKeyPlaceholder" })}
            disabled={busy || apiKeySaving || waiting}
            onChange={(event) => setApiKeyInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && apiKeyInput.trim()) void saveApiKey();
            }}
          />
          <Button
            type="button"
            size="default"
            disabled={!apiKeyInput.trim() || busy || apiKeySaving || waiting}
            onClick={() => void saveApiKey()}
          >
            {apiKeySaving ? (
              <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw data-icon="inline-start" aria-hidden="true" />
            )}
            {intl.formatMessage({ id: "settings.codebuddy.apiKeySave" })}
          </Button>
        </div>
      </details>

      {/* 账号详情：令牌有效期等低频信息（与 Qoder 侧同形态）。 */}
      <Dialog
        open={detailAccount !== null}
        onOpenChange={(next) => {
          if (!next) setDetailAccount(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {intl.formatMessage({ id: "settings.codebuddy.accountDetail" })}
            </DialogTitle>
          </DialogHeader>
          {detailAccount ? (
            <div className="space-y-3 text-ui-sm">
              <div>
                <div className="text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.codebuddy.detailDisplayName" })}
                </div>
                <div className="break-all text-foreground">{detailAccount.displayName}</div>
              </div>
              {detailAccount.email ? (
                <div>
                  <div className="text-foreground-subtle">
                    {intl.formatMessage({ id: "settings.codebuddy.detailEmail" })}
                  </div>
                  <div className="break-all text-foreground">{detailAccount.email}</div>
                </div>
              ) : null}
              <div>
                <div className="text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.codebuddy.detailUserId" })}
                </div>
                <code className="block break-all font-mono text-foreground">
                  {detailAccount.id}
                </code>
              </div>
              <div>
                <div className="text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.codebuddy.detailTokenExpiry" })}
                </div>
                <div className="text-foreground">{formatExpiry(detailAccount.expiresAt)}</div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* 对齐 9router 的 Connect CodeBuddy 弹窗：登录 URL + 复制/打开 + 等待授权。 */}
      <Dialog open={waiting} onOpenChange={(next) => { if (!next) { stopPolling(); setPhase({ kind: "idle" }); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{intl.formatMessage({ id: "settings.codebuddy.modalTitle" }, { name })}</DialogTitle>
          </DialogHeader>
          <p className="text-center text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "settings.codebuddy.modalVisit" })}
          </p>
          {phase.kind === "waiting" ? (
            <>
              <div className="rounded-lg bg-muted p-3 text-center">
                <div className="mb-1 text-ui-sm text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.codebuddy.modalLoginUrl" })}
                </div>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all text-ui-sm">{phase.authUrl}</code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={intl.formatMessage({ id: "settings.codebuddy.copy" })}
                    onClick={() => void copyAuthUrl(phase.authUrl)}
                  >
                    <Copy aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="default"
                    onClick={() =>
                      platform
                        ? platform.openExternal(phase.authUrl)
                        : window.open(phase.authUrl, "_blank", "noopener")
                    }
                  >
                    <ExternalLink data-icon="inline-start" aria-hidden="true" />
                    {intl.formatMessage({ id: "settings.codebuddy.open" })}
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-center gap-2 py-4 text-ui-base text-foreground-subtle">
                <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                {intl.formatMessage({ id: "settings.codebuddy.modalWaiting" })}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
