import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, Loader2Icon, LogIn, RefreshCw, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";
import { TECHNICAL_INPUT_ATTRIBUTES } from "@/lib/technicalInputAttributes.js";

/**
 * XCode fork：CodeBuddy（其他登录型供应商）登录区，渲染在供应商详情模型列表上方。
 *
 * 双模式 + 多账号（对齐 9router Connect 弹窗）：
 *  - OAuth：host 获取 state+authUrl → **系统浏览器**授权（platform.openExternal）
 *    → 每 5s 轮询 → 账号入列表并激活 → 激活令牌写入供应商 overlay 的 access.apiKey。
 *  - API Key：直接粘贴访问令牌，写入同一位置。
 * 账号列表支持切换（写对应令牌进 overlay）与删除（删激活账号时自动回落剩余账号）。
 */

type LoginPhase =
  | { kind: "idle" }
  | { kind: "opening" }
  | { kind: "waiting"; authUrl: string; state: string }
  | { kind: "saving" };

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

interface AccountRow {
  id: string;
  displayName: string;
  expiresAt: number;
  active: boolean;
  accessToken: string;
}

export function CodeBuddyLoginSection({
  providerId,
  region,
}: {
  providerId: string;
  region: "cn" | "intl";
}) {
  const { intl } = useXCodeIntl();
  const platform = usePlatform();
  const { providerSettingsService } = useServices();
  const [phase, setPhase] = useState<LoginPhase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<readonly AccountRow[]>([]);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
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
      platform.openExternal(session.authUrl);
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
        {intl.formatMessage({ id: "settings.codebuddy.title" })}
      </div>
      <p className="text-ui-sm text-foreground-subtle">
        {intl.formatMessage({ id: "settings.codebuddy.description" })}
      </p>

      {/* 账号列表（多账号：切换/删除） */}
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
                  {account.active ? (
                    <span className="ml-1.5 text-foreground-subtle">
                      {intl.formatMessage({ id: "settings.codebuddy.active" })}
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
                    intl.formatMessage({ id: "settings.codebuddy.switch" })
                  )}
                </Button>
              ) : null}
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
            </div>
          ))}
        </div>
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

      {/* 对齐 9router 的 Connect CodeBuddy 弹窗：登录 URL + 复制/打开 + 等待授权。 */}
      <Dialog open={waiting} onOpenChange={(next) => { if (!next) { stopPolling(); setPhase({ kind: "idle" }); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{intl.formatMessage({ id: "settings.codebuddy.modalTitle" })}</DialogTitle>
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
                    onClick={() => platform.openExternal(phase.authUrl)}
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
