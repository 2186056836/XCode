import type { ReactNode } from "react";
import { cn } from "@/components/lib/utils.js";
import appLogo from "@/assets/app-logo.png";

interface RootStartupLoadingProps {
  label: string;
  children?: ReactNode;
  busy?: boolean;
}

export function RootStartupLoading({ label, children, busy = true }: RootStartupLoadingProps) {
  return (
    <div
      // Web 端全局 html/body/#root 为 Electron 透明背景让路，React 接管后会替换 HTML 启动壳。
      // 这里必须由阻塞态自身承接主题背景，否则远控链接会在 Root 恢复期间继续露出浏览器白底。
      className="flex h-full min-h-dvh flex-col items-center justify-center gap-6 bg-background text-foreground"
      role="status"
      aria-busy={busy}
      aria-label={label}
      data-testid="root-startup-loading"
    >
      <XCodeStartupLogoBadge />
      {children}
    </div>
  );
}

/** 初始化与引导共用品牌图标，保持底色、描边、圆角和标志比例一致。 */
export function XCodeStartupLogoBadge({ animated = true }: { animated?: boolean }) {
  return (
    <div className="relative flex size-24 items-center justify-center rounded-3xl shadow-xl/20 before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:border before:border-[rgba(255,255,255,0.1)] before:content-['']">
      {/* XCode fork：品牌图标改为用户提供的 X 位图资产（替代旧 Z 形内联 SVG）；
          呼吸动画由 CSS keyframes 承接（原 SVG SMIL animate：延迟 3s、周期 1.8s、1→0.4→1）。 */}
      <img
        src={appLogo}
        alt=""
        aria-hidden="true"
        className={cn(
          "size-24 rounded-3xl object-cover",
          animated && "app-startup-logo-breathe",
        )}
      />
    </div>
  );
}
