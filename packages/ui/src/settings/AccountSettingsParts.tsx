/**
 * 账号管理页的展示件（从 AccountSettingsSection 拆出，控制单文件行数）。
 *
 * 这里只放纯展示/纯格式化：徽标、头像、族级控件块、领取结果面板与状态文案。
 * 任何需要读服务或改状态的东西都留在 AccountSettingsSection 里。
 */
import { useState } from "react";
import type { MarketingClaimAllAccountResult } from "@/lib/marketingClaimAll.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import {
  ProviderAccountRotationControl,
  ProviderProxyBatchActions,
} from "./model-provider-section/ProviderAccountBinding.js";

const PROVIDER_LABEL: Record<string, string> = {
  zai: "Z.AI",
  bigmodel: "BigModel",
};

function providerBadgeClass(provider: string): string {
  if (provider === "zai") return "bg-blue-500/10 text-blue-600";
  if (provider === "bigmodel") return "bg-purple-500/10 text-purple-600";
  return "bg-surface text-foreground-subtle";
}

export function ProviderBadge({ provider }: { provider: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${providerBadgeClass(provider)}`}
    >
      {PROVIDER_LABEL[provider] ?? provider}
    </span>
  );
}

/** 头像只需要这三个字段；用窄接口避免和 AccountSettingsSection 的 AccountEntry 相互依赖。 */
export interface AccountAvatarSource {
  displayName: string;
  username: string;
  avatarUrl?: string;
}

export function AccountAvatar({ account }: { account: AccountAvatarSource }) {
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

/**
 * 族级出口/轮询控件（zai / bigmodel）。
 *
 * 一个 family 下的多个账号共享同一份轮询游标与出口绑定，因此这两个控件按 family 渲染一次，
 * 而不是塞进每一行。单账号家族控件内部本来也会判空（`accounts.length < 2` 不渲染），
 * 这里再按本列表的账号数过一遍，避免出现只有一个标题的空块。
 *
 * 两个族的控件形状完全一致，各占一张卡片会把账号列表往下推很长一段，所以合并成一张卡片、
 * 用 tab 切换：未选中的族只留一个名字，不再各占一份纵向空间。默认选中账号数更多的族
 * （通常就是当前在用的那个），避免打开页面先看到空块。
 */
export function AccountFamilyControls({ accounts }: { accounts: readonly { provider: string }[] }) {
  const families = [...new Set(accounts.map((account) => account.provider))].filter(
    (provider) => accounts.filter((account) => account.provider === provider).length >= 2,
  );
  const [active, setActive] = useState<string | null>(null);
  if (families.length === 0) {
    return null;
  }
  const selected =
    active && families.includes(active)
      ? active
      : [...families].sort(
          (a, b) =>
            accounts.filter((account) => account.provider === b).length -
            accounts.filter((account) => account.provider === a).length,
        )[0]!;

  if (families.length === 1) {
    return (
      <div className="space-y-2 rounded-lg border border-border p-3">
        <div className="text-ui-base font-medium text-foreground">
          {PROVIDER_LABEL[selected] ?? selected}
        </div>
        <ProviderProxyBatchActions providerId={selected} />
        <ProviderAccountRotationControl providerId={selected} />
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <Tabs value={selected} onValueChange={setActive}>
        <TabsList className="h-7">
          {families.map((provider) => (
            <TabsTrigger key={provider} value={provider} className="px-3 text-ui-sm">
              {PROVIDER_LABEL[provider] ?? provider}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <ProviderProxyBatchActions providerId={selected} />
      <ProviderAccountRotationControl providerId={selected} />
    </div>
  );
}

/** 文案映射只需要 formatMessage；写成窄接口避免把 react-intl 的完整 IntlShape 拖进签名。 */
interface ClaimStatusIntl {
  formatMessage(descriptor: { id: string }): string;
}

/** 领取结果的文案映射；单账号与一键领取共用同一套状态词。 */
export function claimStatusLabel(
  intl: ClaimStatusIntl,
  result: MarketingClaimAllAccountResult,
): string {
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
}

/** 一键领取的逐账号结果面板。 */
export function ClaimAllResultsPanel({
  results,
}: {
  results: readonly MarketingClaimAllAccountResult[];
}) {
  const { intl } = useXCodeIntl();
  return (
    <ul className="flex flex-col gap-1.5 border-t border-border pt-3 text-sm">
      {results.map((result) => (
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
              {claimStatusLabel(intl, result)}
            </span>
          </div>
          {result.message && (result.status === "failed" || result.status === "already-claimed") ? (
            <div className="truncate text-xs text-muted-foreground">{result.message}</div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
