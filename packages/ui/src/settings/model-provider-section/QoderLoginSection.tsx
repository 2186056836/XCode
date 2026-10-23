/* oxlint-disable max-lines -- 登录+账号列表+身份头管理集中，拆分会让身份 head 写入分散。 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Copy,
  Crown,
  ExternalLink,
  Gift,
  Info,
  Loader2Icon,
  LogIn,
  RefreshCw,
  Trash2,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";
import type { QoderCheckinStats } from "@zcode/services";
import { AccountQuotaInline, AccountQuotaSummaryLine, useAccountQuota } from "./ProviderQuotaSection.js";
import {
  ProviderAccountBinding,
  ProviderAccountRotationControl,
  ProviderProxyBatchActions,
} from "./ProviderAccountBinding.js";
import { AccountPaginationBar, useAccountPagination } from "./AccountPagination.js";
import { AutoCheckinSettings, type AutoCheckinRow } from "./AutoCheckinSettings.js";
import { TECHNICAL_INPUT_ATTRIBUTES } from "@/lib/technicalInputAttributes.js";
import { generateId } from "./constants.js";

/**
 * XCode fork：Qoder 登录区（自定义设备流：PKCE + nonce + machine_id），
 * 渲染在供应商详情模型列表上方。双模式：
 *  - OAuth：浏览器打开 selectAccounts 授权页 → 轮询 deviceToken（`dt-...`，约 30 天）
 *    → 账号入列表并激活 → 激活令牌写入供应商 overlay（access.apiKey + 内部身份头）。
 *  - API Key：粘贴 PAT（`pt-...`，qoder.com 的 account/integrations 页可取），
 *    执行链运行时自动交换 job token。
 * 令牌过期（约 30 天）后回到登录态重新走流程；refresh 端点对本流程 403，无自动刷新。
 */

type LoginPhase =
  | { kind: "idle" }
  | { kind: "opening" }
  | {
      kind: "waiting";
      nonce: string;
      verificationUri: string;
      codeVerifier: string;
      machineIdHint: string;
      /** 登录前从 mi-token 接口取的设备三件套，一号一绑。 */
      machineToken?: string;
      machineType?: string;
      machineCode?: string;
    }
  | { kind: "saving" };

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

/** 批量签到的忙碌标记 key（区别于具体账号 id）。 */
const CHECKIN_ALL_KEY = "__all__";

/**
 * 已移除功能的遗留 key：「注入 Qoder IDE 身份」开关曾把该头写进个人层 headers。
 * 现在只剩清理职责——见到就摘掉，别让它继续跟着配置走。
 */
const LEGACY_QODER_PERSONA_HEADER = "x-qoder-inject-persona";

/**
 * 取已写入 overlay 的 machineId。PAT 登录时若之前走过 OAuth 登录就复用它——
 * 设备指纹由 machineId 确定性派生，换一个等于换一台设备。
 */
function previousMachineId(personalConfig: unknown): string {
  const headers = (personalConfig as { api?: { headers?: Record<string, string> } } | undefined)?.api
    ?.headers;
  if (!headers) return "";
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "x-qoder-internal-machine-id") return value;
  }
  return "";
}

interface AccountRow {
  /** 账号标识（上行 Cosy-User）。 */
  id: string;
  displayName: string;
  email?: string;
  /** 设备标识：machineId 与官方 machine-info 三件套。 */
  machineId?: string;
  machineToken?: string;
  machineType?: string;
  machineCode?: string;
  expiresAt: number;
  active: boolean;
}

export function QoderLoginSection({
  providerId,
  region,
  name,
}: {
  providerId: string;
  region: "cn" | "intl";
  name: string;
}) {
  const { intl } = useXCodeIntl();
  const platform = useOptionalPlatform();
  const { providerSettingsService } = useServices();
  const [phase, setPhase] = useState<LoginPhase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<readonly AccountRow[]>([]);
  const accountPage = useAccountPagination(accounts);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  /** PRO 激活结果回显（非空即展示在账号区下方）。 */
const [proMessage, setProMessage] = useState<string>("");
  /** 账号标识/设备标识详情弹窗。 */
  const [detailAccount, setDetailAccount] = useState<AccountRow | null>(null);
  /** 各账号的 PRO 状态（accountId → isPro），用于按钮态。 */
  const [proFlags, setProFlags] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  /** 签到中标记：账号 id 或 "__all__"（本区批量）。 */
  const [checkinBusyId, setCheckinBusyId] = useState<string | null>(null);
  /** 签到结果回显：账号 id → 消息；"__all__" → 批量汇总。 */
  const [checkinMessages, setCheckinMessages] = useState<Readonly<Record<string, string>>>(
    () => ({}),
  );
  /** 各账号本地签到统计（accountId → 连续/累计天数与积分）。 */
  const [checkinStatsMap, setCheckinStatsMap] = useState<ReadonlyMap<string, QoderCheckinStats>>(
    () => new Map(),
  );
  /** 每账号自动签到设置（随账号列表刷新）。 */
  const [autoCheckinRows, setAutoCheckinRows] = useState<readonly AutoCheckinRow[]>([]);
  const [autoCheckinSavingId, setAutoCheckinSavingId] = useState<string | null>(null);
  /** 本区账号额度（剩余/总额），按 accountId 索引；账号行内联展示。 */
  const accountQuota = useAccountQuota({ family: "qoder", region });
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
      const result = await providerSettingsService.qoderListAccounts(region);
      setAccounts(result.accounts);
      // 并行查各账号的 PRO 状态：查询走 Bearer-only 端点，不触发设备复核，
      // 可以安全地在每次列表刷新时执行。失败按"非 PRO"处理，不阻断列表。
      const flags = await Promise.all(
        result.accounts.map(async (account) => {
          try {
            const status = await providerSettingsService.qoderQueryProStatus(region, account.id);
            return [account.id, status.isPro] as const;
          } catch {
            return [account.id, false] as const;
          }
        }),
      );
      setProFlags(new Map(flags));
      // 并行拉本地签到统计（纯本地历史，不上行任何请求），失败按无统计处理。
      const statsEntries = await Promise.all(
        result.accounts.map(async (account) => {
          try {
            const stats = await providerSettingsService.qoderCheckinStats({ region, accountId: account.id });
            return [account.id, stats] as const;
          } catch {
            return [account.id, null] as const;
          }
        }),
      );
      const statsMap = new Map<string, QoderCheckinStats>();
      for (const [accountId, stats] of statsEntries) {
        if (stats) statsMap.set(accountId, stats);
      }
      setCheckinStatsMap(statsMap);
      // 自动签到设置与签到统计同源刷新；失败不阻断账号列表。
      try {
        setAutoCheckinRows(await providerSettingsService.qoderListAutoCheckin(region));
      } catch (autoCheckinError) {
        logger.warn("[QoderLogin] 拉取自动签到设置失败", autoCheckinError);
      }
    } catch (listError) {
      logger.warn("[QoderLogin] 拉取账号列表失败", listError);
    }
  }, [providerSettingsService, region]);

  const writeOverlay = useCallback(
    async (accessToken: string, userId: string, machineId: string) => {
      // 令牌 + 内部身份（userId/machineId）写进 provider headers，执行链
      // 按 requestProfile=qoder 读取并用于 COSY 签名；这些内部头在发往
      // 上游前会被剥掉。
      const current = await providerSettingsService.getView();
      const provider = current.providers.find((item) => item.providerId === providerId);
      const previous = provider?.personalConfig;
      const baseHeaders =
        (previous?.api?.headers as Record<string, string> | undefined) ?? {};
      await providerSettingsService.savePersonalProviderOverlay(providerId, {
        ...previous,
        access: { type: "api-key", apiKey: accessToken },
        api: {
          ...(previous?.api ?? {}),
          headers: {
            ...baseHeaders,
            "X-Qoder-Internal-User-Id": userId,
            "X-Qoder-Internal-Machine-Id": machineId,
          },
        },
      });
    },
    [providerId, providerSettingsService],
  );

  /** 清空 overlay 中的令牌与身份头（删除最后一个账号时调用）。 */
  const clearOverlay = useCallback(async () => {
    const current = await providerSettingsService.getView();
    const provider = current.providers.find((item) => item.providerId === providerId);
    const previous = provider?.personalConfig;
    const baseHeaders = { ...((previous?.api?.headers as Record<string, string> | undefined) ?? {}) };
    for (const key of Object.keys(baseHeaders)) {
      const lowered = key.toLowerCase();
      if (
        lowered === "x-qoder-internal-user-id" ||
        lowered === "x-qoder-internal-machine-id"
      ) {
        delete baseHeaders[key];
      }
    }
    await providerSettingsService.savePersonalProviderOverlay(providerId, {
      ...previous,
      access: { type: "api-key", apiKey: "" },
      api: { ...(previous?.api ?? {}), headers: baseHeaders },
    });
  }, [providerId, providerSettingsService]);

  useEffect(() => {
    if (phase.kind === "idle") void refreshAccounts();
  }, [phase, refreshAccounts]);

  // 清理已移除功能的遗留配置：早期版本提供过「注入 Qoder IDE 身份」开关，
  // 把 X-Qoder-Inject-Persona 写进个人层 headers。功能已删，残留的键在这里
  // 一次性摘掉并写回（只在真的存在时写，不会反复触发）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const current = await providerSettingsService.getView();
        const provider = current.providers.find((item) => item.providerId === providerId);
        const previous = provider?.personalConfig;
        const headers = (previous?.api?.headers ?? {}) as Record<string, string>;
        const staleKeys = Object.keys(headers).filter(
          (key) => key.toLowerCase() === LEGACY_QODER_PERSONA_HEADER,
        );
        if (staleKeys.length === 0 || cancelled) return;
        const cleaned = { ...headers };
        for (const key of staleKeys) delete cleaned[key];
        await providerSettingsService.savePersonalProviderOverlay(providerId, {
          ...previous,
          api: { ...(previous?.api ?? {}), headers: cleaned },
        });
      } catch (cleanupError) {
        logger.warn("[QoderLogin] 清理遗留 persona 开关失败", cleanupError);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [providerId, providerSettingsService]);

  const startLogin = useCallback(async () => {
    setError(null);
    setPhase({ kind: "opening" });
    try {
      const session = await providerSettingsService.qoderBeginLogin(region);
      const authUrl = session.verificationUri;
      if (platform) platform.openExternal(authUrl);
      else window.open(authUrl, "_blank", "noopener");
      setPhase({
        kind: "waiting",
        nonce: session.nonce,
        verificationUri: authUrl,
        codeVerifier: session.codeVerifier,
        machineIdHint: session.machineIdHint || "",
        ...(session.machineToken
          ? {
              machineToken: session.machineToken,
              machineType: session.machineType,
              machineCode: session.machineCode,
            }
          : {}),
      });
      const startedAt = Date.now();
      stopPolling();
      pollTimerRef.current = setInterval(async () => {
        if (phaseRef.current.kind !== "waiting") return;
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          stopPolling();
          setPhase({ kind: "idle" });
          setError(intl.formatMessage({ id: "settings.qoder.loginTimeout" }));
          return;
        }
        const current = phaseRef.current;
        if (current.kind !== "waiting") return;
        const result = await providerSettingsService.qoderPollLogin(
          region,
          current.nonce,
          current.codeVerifier,
          // 一并传给 host，让登录成功的账号把 machineId 持久化下来。
          current.machineIdHint || undefined,
          // 设备三件套随会话一起带下去，让该账号一号一绑。
          {
            machineToken: current.machineToken,
            machineType: current.machineType,
            machineCode: current.machineCode,
          },
        );
        if (result.status === "pending") return;
        stopPolling();
        if (result.status === "ok") {
          setPhase({ kind: "saving" });
          try {
            // 登录不自动切换当前账号：host 仅在"无激活账号"时激活新账号。
            // 这里把**激活账号**镜像进 overlay——首次登录即新账号；已有多账号
            // 时原激活账号原样保留，切换交给用户手动操作。
            const view = await providerSettingsService.qoderListAccounts(region);
            const active = view.accounts.find((a) => a.active) ?? null;
            if (active) {
              await writeOverlay(active.accessToken, active.id, active.machineId ?? "");
            }
            await refreshAccounts();
            setPhase({ kind: "idle" });
          } catch (saveError) {
            logger.warn("[QoderLogin] 写入令牌失败", saveError);
            setPhase({ kind: "idle" });
            setError(saveError instanceof Error ? saveError.message : String(saveError));
          }
          return;
        }
        setPhase({ kind: "idle" });
        setError(result.message);
      }, POLL_INTERVAL_MS);
      timeoutRef.current = setTimeout(
        () => {
          stopPolling();
          setPhase({ kind: "idle" });
          setError(intl.formatMessage({ id: "settings.qoder.loginTimeout" }));
        },
        POLL_TIMEOUT_MS + POLL_INTERVAL_MS,
      );
    } catch (loginError) {
      logger.warn("[QoderLogin] 发起登录失败", loginError);
      setPhase({ kind: "idle" });
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    }
  }, [intl, platform, providerSettingsService, refreshAccounts, region, stopPolling, writeOverlay]);

  const switchAccount = useCallback(
    async (id: string) => {
      setSwitchingId(id);
      setError(null);
      try {
const account = await providerSettingsService.qoderSwitchAccount(region, id);
if (account) {
          // machineId 必须取账号持久化的值：Qoder 设备指纹（Cosy-Machineid及其
          // 派生的 machinecode/hostname/IP）由 machineId 确定性导出，丢失会导致
          // 每次请求都换一套设备身份——比稳定的旧指纹更像伪造客户端。
          await writeOverlay(account.accessToken, id, account.machineId ?? "");
        }
        await refreshAccounts();
      } catch (switchError) {
        logger.warn("[QoderLogin] 切换账号失败", switchError);
        setError(switchError instanceof Error ? switchError.message : String(switchError));
      }
      setSwitchingId(null);
    },
    [providerSettingsService, refreshAccounts, region, writeOverlay],
  );

  const removeAccount = useCallback(
    async (id: string) => {
      setSwitchingId(id);
      setError(null);
      try {
        const result = await providerSettingsService.qoderRemoveAccount(region, id);
        if (result.activeAccessToken) {
          const view = await providerSettingsService.qoderListAccounts(region);
          const active = view.accounts.find((a) => a.active);
          await writeOverlay(result.activeAccessToken, active?.id ?? "", active?.machineId ?? "");
        } else {
          // 删空后必须显式撤销 overlay：否则账号列表已空，但 personal config
          // 里仍留着刚删账号的令牌，执行链还会拿它发请求——凭据未撤销。
          await clearOverlay();
        }
        await refreshAccounts();
      } catch (removeError) {
        logger.warn("[QoderLogin] 删除账号失败", removeError);
        setError(removeError instanceof Error ? removeError.message : String(removeError));
      }
      setSwitchingId(null);
    },
    [clearOverlay, providerSettingsService, refreshAccounts, region, writeOverlay],
  );

  /**
   * 激活 PRO。machineToken 由 mi-token 接口下发（账号已缓存的优先），
   * 用户无需手输。
   */
  const startProActivation = useCallback(
    async (accountId: string) => {
      setError(null);
      setProMessage("");
      setSwitchingId(accountId);
      try {
        const result = await providerSettingsService.qoderActivatePro(region, accountId);
        if (result.ok) {
          setProMessage(
            intl.formatMessage({ id: "settings.qoder.proActivated" }, { message: result.message }),
          );
          logger.info("[QoderLogin] PRO 激活成功", { userType: result.userType });
          await refreshAccounts();
        } else {
          setProMessage(
            intl.formatMessage({ id: "settings.qoder.proFailed" }, { message: result.message }),
          );
        }
      } catch (activateError) {
        logger.warn("[QoderLogin] PRO 激活失败", activateError);
        setError(activateError instanceof Error ? activateError.message : String(activateError));
      }
      setSwitchingId(null);
    },
    [intl, providerSettingsService, refreshAccounts, region],
  );

  /**
   * 单账号签到：走 host 的 campaigns→claim 权威流程（账号绑定的真实
   * machinetoken 一并上行），完成后刷新本地统计展示。
   */
  const runCheckin = useCallback(
    async (accountId: string) => {
      setCheckinBusyId(accountId);
      setError(null);
      try {
        const result = await providerSettingsService.qoderCheckin({ region, accountId });
        setCheckinMessages((prev) => ({ ...prev, [accountId]: result.message }));
        const stats = await providerSettingsService.qoderCheckinStats({ region, accountId });
        setCheckinStatsMap((prev) => new Map(prev).set(accountId, stats));
      } catch (checkinError) {
        logger.warn("[QoderLogin] 签到失败", checkinError);
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
   * 批量签到：只扫本区已登录账号（cn/intl 两个供应商区各自独立，
   * host 仍按账号区域分流；服务层默认扫全区，这里按当前区收敛，避免
   * 在 CN 区里把国际号一起签掉）。
   */
  const runCheckinAll = useCallback(async () => {
    setCheckinBusyId(CHECKIN_ALL_KEY);
    setError(null);
    try {
      const { results } = await providerSettingsService.qoderCheckinAll({ regions: [region] });
      const nextMessages: Record<string, string> = {};
      let claimed = 0;
      let already = 0;
      let noCampaign = 0;
      for (const result of results) {
        nextMessages[result.accountId] = result.message;
        if (result.status === "claimed") claimed += 1;
        else if (result.status === "already_claimed") already += 1;
        else if (result.status === "no_campaign") noCampaign += 1;
      }
      nextMessages[CHECKIN_ALL_KEY] = intl.formatMessage(
        { id: "settings.qoder.checkinBatchSummary" },
        { claimed: String(claimed), already: String(already), noCampaign: String(noCampaign) },
      );
      setCheckinMessages((prev) => ({ ...prev, ...nextMessages }));
      await refreshAccounts();
    } catch (checkinError) {
      logger.warn("[QoderLogin] 批量签到失败", checkinError);
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
      // 先本地回显，失败时由 refresh 拉回真实值。
      setAutoCheckinRows((prev) =>
        prev.map((row) => (row.accountId === accountId ? { ...row, enabled } : row)),
      );
      try {
        await providerSettingsService.qoderUpdateAutoCheckin(region, accountId, { enabled });
      } catch (saveError) {
        logger.warn("[QoderLogin] 保存自动签到开关失败", saveError);
        await refreshAccounts();
      }
      setAutoCheckinSavingId(null);
    },
    [providerSettingsService, refreshAccounts, region],
  );

  /** 修改某账号的自动签到时间（host 先校验 HH:MM 再落盘）。 */
  const changeAutoCheckinTime = useCallback(
    async (accountId: string, time: string) => {
      setAutoCheckinSavingId(accountId);
      setAutoCheckinRows((prev) =>
        prev.map((row) => (row.accountId === accountId ? { ...row, time } : row)),
      );
      try {
        await providerSettingsService.qoderUpdateAutoCheckin(region, accountId, { time });
      } catch (saveError) {
        logger.warn("[QoderLogin] 保存自动签到时间失败", saveError);
        await refreshAccounts();
      }
      setAutoCheckinSavingId(null);
    },
    [providerSettingsService, refreshAccounts, region],
  );

  const saveApiKey = useCallback(async () => {
    const token = apiKeyInput.trim();
    if (!token) return;
    setApiKeySaving(true);
    setError(null);
    try {
      // PAT/设备令牌都写进overlay。PAT（pt-）没有可预知的 userId——它在执行链
      // 运行时换成 job token 后才从 userinfo 取回，所以这里留空而不是编一个；
      // dt-/jt- 则必须带 userId，缺失说明凭证没配全。
      const isPat = token.startsWith("pt-");
      // machineId 必须在此固化：设备指纹（Cosy-Machineid 及其派生的 machinecode /
      // hostname / clientip）由它确定性导出，留空会让签名层退化成逐请求随机——
      // 同一个账号每次请求都像换了一台机器。
      if (!isPat) {
        await writeOverlay(token, "", generateId());
      } else {
        // 仍需写 headers：执行链靠 headers 判断"已配置身份"，且机器指纹要从
        // machineId 派生。PAT 的 userId 由运行时补，这里固化 machineId。
        const current = await providerSettingsService.getView();
        const provider = current.providers.find((item) => item.providerId === providerId);
        const previous = provider?.personalConfig;
        const baseHeaders = (previous?.api?.headers as Record<string, string> | undefined) ?? {};
        await providerSettingsService.savePersonalProviderOverlay(providerId, {
          ...previous,
          access: { type: "api-key", apiKey: token },
          api: {
            ...(previous?.api ?? {}),
            headers: {
              ...baseHeaders,
              "X-Qoder-Internal-Machine-Id":
                previousMachineId(provider?.personalConfig) || generateId(),
            },
          },
        });
      }
      setApiKeyInput("");
      await refreshAccounts();
    } catch (saveError) {
      logger.warn("[QoderLogin] 写入 API Key 失败", saveError);
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    }
    setApiKeySaving(false);
  }, [apiKeyInput, providerId, providerSettingsService, refreshAccounts]);

  const copyAuthUrl = useCallback(async (authUrl: string) => {
    try {
      await navigator.clipboard.writeText(authUrl);
    } catch {
      // 剪贴板失败静默。
    }
  }, []);

  const waiting = phase.kind === "waiting";
  const busy = phase.kind === "opening" || phase.kind === "saving";

  const formatExpiry = useCallback(
    (expiresAt: number) => {
      const remainingMs = expiresAt - Date.now();
      if (remainingMs <= 0) {
        return intl.formatMessage({ id: "settings.qoder.accountExpired" });
      }
      const days = Math.floor(remainingMs / 86_400_000);
      return intl.formatMessage({ id: "settings.qoder.accountExpiresDays" }, { days: String(days) });
    },
    [intl],
  );

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="text-ui-base font-medium text-foreground">
        {intl.formatMessage({ id: "settings.qoder.title" }, { name })}
      </div>
      <p className="text-ui-sm text-foreground-subtle">
        {intl.formatMessage({ id: "settings.qoder.description" }, { name })}
      </p>

      {/* 批量代理池分配：多账号时才有意义，组件内部判空（< 2 个账号不渲染）。 */}
      <ProviderProxyBatchActions providerId={providerId} />
      {/* 账号轮询：fill-first / round-robin + sticky，对齐 9router。 */}
      <ProviderAccountRotationControl providerId={providerId} />

      {accounts.length > 0 ? (
        <div className="space-y-1.5">
          {accountPage.pageItems.map((account) => {
            const checkinStats = checkinStatsMap.get(account.id);
            const checkinMessage = checkinMessages[account.id];
            return (
            <div
              key={account.id}
              className="space-y-1 rounded-lg border border-border px-2.5 py-2"
            >
              <div className="flex items-center gap-2">
                <UserRound aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-ui-sm text-foreground">
                    {account.displayName}
                    {account.email ? (
                      <span className="ml-1.5 text-foreground-subtle">· {account.email}</span>
                    ) : null}
                    {account.active ? (
                      <span className="ml-1.5 text-foreground-subtle">
                        {intl.formatMessage({ id: "settings.qoder.active" })}
                      </span>
                    ) : null}
                  </div>
                </div>
                {!account.active ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={switchingId !== null || busy || waiting || checkinBusyId !== null}
                    onClick={() => void switchAccount(account.id)}
                  >
                    {switchingId === account.id ? (
                      <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      intl.formatMessage({ id: "settings.qoder.switch" })
                    )}
                  </Button>
                ) : null}
                {/* 每日签到（campaigns 权威流程）：已领取同样可点，服务端幂等。 */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={switchingId !== null || busy || waiting || checkinBusyId !== null}
                  onClick={() => void runCheckin(account.id)}
                >
                  {checkinBusyId === account.id ? (
                    <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Gift className="size-3.5" aria-hidden="true" />
                  )}
                  {intl.formatMessage({ id: "settings.qoder.checkin" })}
                </Button>
                {/* 已 PRO 的账号显示「已激活 PRO」并禁用——重复领取无意义。 */}
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={
                      proFlags.get(account.id) === true || switchingId !== null || busy || waiting
                    }
                    onClick={() => void startProActivation(account.id)}
                >
                  {switchingId === account.id ? (
                    <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Crown className="size-3.5" aria-hidden="true" />
                  )}
                  {intl.formatMessage({
                    id:
                      proFlags.get(account.id) === true
                        ? "settings.qoder.proActivatedBadge"
                        : "settings.qoder.activatePro",
                  })}
                </Button>
              {/* 账号详情：令牌有效期 + 账号/设备标识（低频信息集中在此）。 */}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={intl.formatMessage({ id: "settings.qoder.accountDetail" })}
                disabled={switchingId !== null || busy || waiting}
                onClick={() => setDetailAccount(account)}
              >
                <Info aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={intl.formatMessage({ id: "settings.qoder.remove" })}
                disabled={switchingId !== null || busy || waiting || checkinBusyId !== null}
                onClick={() => void removeAccount(account.id)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
              </div>
              {/* 令牌过期时间是低频信息，移入账号详情；行内只留额度。
                  额度块放在**卡片整宽**的一行（不再挤在 flex-1 左列里）：左列宽度会随右侧
                  按钮数量（「使用」只对非当前账号出现）变化，额度条跟着伸缩就没法跨账号对比了。 */}
              {accountQuota.byAccountId.get(account.id) ? (
                <div className="pl-6 text-ui-sm text-foreground-subtle">
                  <AccountQuotaInline snapshot={accountQuota.byAccountId.get(account.id)} />
                </div>
              ) : null}
              {/* 账号级代理绑定：只在该供应商启用代理且池有条目时渲染（组件内部判空）。 */}
              <div className="pl-6">
                <ProviderAccountBinding providerId={providerId} accountId={account.id} />
              </div>
              {/* 本地签到统计（连续/累计天数与积分，按活动窗口记账）。 */}
              {checkinStats && checkinStats.totalClaimDays > 0 ? (
                <div className="pl-6 text-ui-sm text-foreground-subtle">
                  {intl.formatMessage(
                    { id: "settings.qoder.checkinStats" },
                    {
                      streak: String(checkinStats.streakDays),
                      total: String(checkinStats.totalClaimDays),
                      credits: String(checkinStats.totalRewardCredits),
                    },
                  )}
                </div>
              ) : null}
              {/* 本次签到结果回显（含窗口提示与统计后缀）。 */}
              {checkinMessage ? (
                <div className="pl-6 text-ui-sm text-foreground-subtle" role="status">
                  {checkinMessage}
                </div>
              ) : null}
            </div>
            );
          })}
          {accountPage.needsPagination ? (
            <AccountPaginationBar
              page={accountPage.page}
              totalPages={accountPage.totalPages}
              pageSize={accountPage.pageSize}
              onChange={accountPage.setPage}
              onPageSizeChange={accountPage.setPageSize}
            />
          ) : null}
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
            {intl.formatMessage({ id: "settings.qoder.checkinAll" })}
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
      <AutoCheckinSettings
        intlKeyPrefix="settings.qoder"
        rows={autoCheckinRows}
        savingAccountId={autoCheckinSavingId}
        onToggle={(accountId, enabled) => void toggleAutoCheckin(accountId, enabled)}
        onChangeTime={(accountId, time) => void changeAutoCheckinTime(accountId, time)}
      />

      {proMessage ? (
        <p className="text-ui-sm text-foreground-subtle" role="status">
          {proMessage}
        </p>
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
            id: waiting ? "settings.qoder.waiting" : "settings.qoder.login",
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
          {intl.formatMessage({ id: "settings.qoder.apiKeyTitle" })}
        </summary>
        <div className="mt-2 flex gap-2">
          <Input
            {...TECHNICAL_INPUT_ATTRIBUTES}
            type="password"
            size="lg"
            value={apiKeyInput}
            placeholder={intl.formatMessage({ id: "settings.qoder.apiKeyPlaceholder" })}
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
            {intl.formatMessage({ id: "settings.qoder.apiKeySave" })}
          </Button>
        </div>
      </details>

      {/* 账号标识 / 设备标识详情 */}
      <Dialog
        open={detailAccount !== null}
        onOpenChange={(next) => {
          if (!next) setDetailAccount(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {intl.formatMessage({ id: "settings.qoder.accountDetail" })}
            </DialogTitle>
          </DialogHeader>
          {detailAccount ? (
            <div className="space-y-3 text-ui-sm">
              <div>
                <div className="text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.qoder.detailDisplayName" })}
                </div>
                <div className="break-all text-foreground">{detailAccount.displayName}</div>
              </div>
              <div>
                <div className="text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.qoder.detailUserId" })}
                </div>
                <code className="block break-all font-mono text-foreground">
                  {detailAccount.id}
                </code>
              </div>
              {/* 令牌有效期：原来挂在账号行副标题，信息密度低且每行都重复，
                  移到详情里按需查看。 */}
              <div>
                <div className="text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.qoder.detailTokenExpiry" })}
                </div>
                <div className="text-foreground">{formatExpiry(detailAccount.expiresAt)}</div>
              </div>
              <div className="border-t border-border pt-3">
                <div className="mb-1.5 text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.qoder.detailDeviceIdentity" })}
                </div>
                <div className="space-y-1.5">
                  {(
                    [
                      ["machineId", detailAccount.machineId],
                      ["machineToken", detailAccount.machineToken],
                      ["machineType", detailAccount.machineType],
                      ["machineCode", detailAccount.machineCode],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <div className="font-mono text-foreground-subtle">{label}</div>
                      <code className="block break-all font-mono text-foreground">
                        {value || intl.formatMessage({ id: "settings.qoder.detailEmpty" })}
                      </code>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={waiting}
        onOpenChange={(next) => {
          if (!next) {
            stopPolling();
            setPhase({ kind: "idle" });
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{intl.formatMessage({ id: "settings.qoder.modalTitle" }, { name })}</DialogTitle>
          </DialogHeader>
          <p className="text-center text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "settings.qoder.modalVisit" })}
          </p>
          {phase.kind === "waiting" ? (
            <>
              <div className="rounded-lg bg-muted p-3 text-center">
                <div className="mb-1 text-ui-sm text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.qoder.modalUserCode" })}
                </div>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all text-ui-sm">{phase.verificationUri}</code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={intl.formatMessage({ id: "settings.qoder.copy" })}
                    onClick={() => void copyAuthUrl(phase.verificationUri)}
                  >
                    <Copy aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="default"
                    onClick={() =>
                      platform
                        ? platform.openExternal(phase.verificationUri)
                        : window.open(phase.verificationUri, "_blank", "noopener")
                    }
                  >
                    <ExternalLink data-icon="inline-start" aria-hidden="true" />
                    {intl.formatMessage({ id: "settings.qoder.open" })}
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-center gap-2 py-4 text-ui-base text-foreground-subtle">
                <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                {intl.formatMessage({ id: "settings.qoder.modalWaiting" })}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
