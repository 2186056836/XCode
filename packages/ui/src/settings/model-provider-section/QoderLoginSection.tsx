import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Crown, ExternalLink, Info, Loader2Icon, LogIn, RefreshCw, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";
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
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  /** PRO 激活结果回显（非空即展示在账号区下方）。 */
const [proMessage, setProMessage] = useState<string>("");
  /** 账号标识/设备标识详情弹窗。 */
  const [detailAccount, setDetailAccount] = useState<AccountRow | null>(null);
  /** 是否注入官方 IDE 身份 persona（默认关闭）。 */
  const [injectPersona, setInjectPersona] = useState(false);
  const [personaSaving, setPersonaSaving] = useState(false);
  /** 各账号的 PRO 状态（accountId → isPro），用于按钮态。 */
  const [proFlags, setProFlags] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
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

  // 读取 persona 开关的持久化值（写在 provider headers，与内部身份头同通道）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const current = await providerSettingsService.getView();
        const provider = current.providers.find((item) => item.providerId === providerId);
        const headers = (provider?.personalConfig?.api?.headers ?? {}) as Record<string, string>;
        for (const [key, value] of Object.entries(headers)) {
          const lowered = key.toLowerCase();
          if (lowered === "x-qoder-inject-persona") {
            const normalized = String(value).trim().toLowerCase();
            if (!cancelled) setInjectPersona(normalized === "1" || normalized === "true");
            continue;
          }
        }
      } catch (readError) {
        logger.warn("[QoderLogin] 读取 persona 开关失败", readError);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [providerId, providerSettingsService]);

  const togglePersona = useCallback(
    async (next: boolean) => {
      setPersonaSaving(true);
      setError(null);
      // 乐观更新，失败时回滚
      setInjectPersona(next);
      try {
        const current = await providerSettingsService.getView();
        const provider = current.providers.find((item) => item.providerId === providerId);
        const previous = provider?.personalConfig;
        const baseHeaders = (previous?.api?.headers as Record<string, string> | undefined) ?? {};
        const headers = { ...baseHeaders };
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === "x-qoder-inject-persona") delete headers[key];
        }
        if (next) headers["X-Qoder-Inject-Persona"] = "true";
        await providerSettingsService.savePersonalProviderOverlay(providerId, {
          ...previous,
          api: { ...(previous?.api ?? {}), headers },
        });
      } catch (saveError) {
        logger.warn("[QoderLogin] 保存 persona 开关失败", saveError);
        setInjectPersona(!next);
        setError(saveError instanceof Error ? saveError.message : String(saveError));
      }
      setPersonaSaving(false);
    },
    [providerId, providerSettingsService],
  );

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

      {accounts.length > 0 ? (
        <div className="space-y-1.5">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2"
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
                      {intl.formatMessage({ id: "settings.qoder.active" })}
                    </span>
                  ) : null}
                </div>
                <div className="text-ui-sm text-foreground-subtle">{formatExpiry(account.expiresAt)}</div>
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
                    intl.formatMessage({ id: "settings.qoder.switch" })
                  )}
                </Button>
              ) : null}
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
              {/* 账号详情按钮暂时隐藏：调试用途，需要时恢复此块
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
              */}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={intl.formatMessage({ id: "settings.qoder.remove" })}
                disabled={switchingId !== null || busy || waiting}
                onClick={() => void removeAccount(account.id)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}

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

      <label className="flex cursor-pointer items-start gap-2 text-ui-sm text-foreground-subtle">
        <Checkbox
          className="mt-0.5"
          checked={injectPersona}
          disabled={busy || waiting || personaSaving}
          onCheckedChange={(checked) => void togglePersona(checked === true)}
        />
        <span>
          {intl.formatMessage({ id: "settings.qoder.personaTitle" })}
          <span className="block text-foreground-subtle">
            {intl.formatMessage({ id: "settings.qoder.personaHint" })}
          </span>
        </span>
      </label>

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
