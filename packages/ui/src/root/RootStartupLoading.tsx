import type { ReactNode } from "react";
import { cn } from "@/components/lib/utils.js";

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
    <div className="relative flex size-24 items-center justify-center rounded-3xl bg-[linear-gradient(180deg,#000000_0%,#151718_100%)] text-[#ffffff] shadow-xl/20 before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:border before:border-[rgba(255,255,255,0.1)] before:content-['']">
      {/* 品牌 X：自 app-logo 抠出的白色空心 X 矢量化而来（同空态水印）。内联 SVG
          吃 currentColor（此处容器 text-[#ffffff]，黑渐变底上白标），
          fill-rule=evenodd 保留右撇空心；呼吸动画由 CSS keyframes 承接。 */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 300 300"
        fill="none"
        className={cn("h-auto w-12 shrink-0 text-current", animated && "app-startup-logo-breathe")}
        aria-hidden="true"
        focusable="false"
      >
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M0 0 L112.8 132.1 L0 299.1 L96.3 299.1 L165.1 197.2 L254.1 298.2 L290.8 299.1 L185.3 168.8 L299.1 0 L205.5 0 L129.4 109.2 L38.5 2.8 Z M251.4 23.9 L87.2 270.6 L48.6 275.2 L215.6 25.7 Z"
        />
      </svg>
    </div>
  );
}
