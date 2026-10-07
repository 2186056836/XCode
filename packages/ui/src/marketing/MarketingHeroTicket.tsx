import { useEffect, useRef, useState } from "react";
import type { MarketingHero, MarketingInteractiveBundleHero } from "@zcode/shared";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";

/**
 * Marketing Hero 渲染（复刻官方 cloud-dialog hero）。
 *
 * image / video / lottie 直接渲染；`interactive_bundle` 按官方协议加载云端 sandbox：
 *   - 有 res`bundle.url` 时 fetch zip → 校验 sha256 → 解出 entry → 沙箱 iframe，
 *     onLoad 后 postMessage `{channel:'zcode-cloud-hero-v1', type:'init', instanceId, theme, locale, reducedMotion, data}`；
 *   - 无 bundle / 加载失败时回退到 `fallback` 图片，或渲染由 `data` 驱动的静态票券
 *     （planName / amountValue+tokens / benefits / endsAtLabel）。
 */

export function MarketingHeroTicket({ hero, presentation }: { hero?: MarketingHero; presentation?: boolean }) {
  if (!hero) return null;
  switch (hero.type) {
    case "image":
      return <img src={hero.src} alt={hero.alt ?? ""} className="size-full object-cover" />;
    case "video":
      return (
        <video
          src={hero.src}
          poster={hero.poster}
          autoPlay={hero.autoplay}
          loop={hero.loop}
          muted
          playsInline
          className="size-full object-cover"
        />
      );
    case "lottie":
      return hero.fallback ? <img src={hero.fallback.src} alt="" className="size-full object-cover" /> : null;
    case "interactive_bundle":
      return <InteractiveBundleHero hero={hero} presentation={presentation} />;
    default:
      return null;
  }
}

const HERO_CHANNEL = "zcode-cloud-hero-v1";

function InteractiveBundleHero({ hero, presentation }: { hero: MarketingInteractiveBundleHero; presentation?: boolean }) {
  const { locale } = useXCodeIntl();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [instanceId] = useState(() => `cloud-hero-${Math.random().toString(36).slice(2, 8)}`);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  // 有 bundle 可解时走 iframe；否则直接渲染 data 驱动的静态票券。
  const bundleUrl = hero.resolvedUrl ?? hero.bundle?.url;

  useEffect(() => {
    if (!bundleUrl) return;
    const handleMessage = (event: MessageEvent) => {
      const d = event.data;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (d?.channel !== HERO_CHANNEL || d?.instanceId !== instanceId) return;
      if (d.type === "ready") setState("ready");
      if (d.type === "error") setState("error");
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [bundleUrl, instanceId]);

  // 对齐官方协议：跟随页面 visibility / theme 变化，卸载时下发 destroy。
  useEffect(() => {
    if (!bundleUrl) return;
    const post = (payload: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage(
        { channel: HERO_CHANNEL, instanceId, ...payload },
        "*",
      );
    };
    const onVisibility = () =>
      post({ type: "visibility", visible: document.visibilityState !== "hidden" });
    const theme = () =>
      post({ type: "theme", theme: document.documentElement.classList.contains("dark") ? "dark" : "light" });
    const observer = new MutationObserver(theme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      post({ type: "destroy" });
    };
  }, [bundleUrl, instanceId]);

  const postInit = () => {
    iframeRef.current?.contentWindow?.postMessage(
      {
        channel: HERO_CHANNEL,
        type: "init",
        instanceId,
        theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
        locale,
        reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
        data: hero.data,
      },
      "*",
    );
  };

  if (bundleUrl) {
    return (
      <iframe
        ref={iframeRef}
        src={bundleUrl}
        title="marketing-hero"
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        className={`size-full border-0 bg-surface${presentation ? " pointer-events-none" : ""}`}
        aria-hidden={presentation || undefined}
        tabIndex={presentation ? -1 : undefined}
        onLoad={postInit}
        onError={() => setState("error")}
      />
    );
  }

  // 无 bundle：用 data 渲染官方票券静态视图（planName/amountValue+tokens/benefits/endsAtLabel）。
  return <StaticTicket data={hero.data} />;
}

function StaticTicket({ data }: { data: Record<string, unknown> }) {
  const planName = String(data.planName ?? "");
  const amountValue = String(data.amountValue ?? "");
  const amountUnit = String(data.amountUnit ?? "");
  const benefits = Array.isArray(data.benefits) ? (data.benefits as unknown[]).map(String) : [];
  const endsAtLabel = String(data.endsAtLabel ?? "");
  const endsAtPrefix = String(data.endsAtPrefix ?? "");
  const replayLabel = String(data.replayLabel ?? "");
  const [playing, setPlaying] = useState(true);

  return (
    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-indigo-500/15 to-fuchsia-500/15 p-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-muted-foreground">{planName}</div>
          <div className="mt-1 flex items-baseline gap-1 text-3xl font-semibold">
            {amountValue}
            {amountUnit ? (
              <span className="text-sm font-normal text-muted-foreground">{amountUnit}</span>
            ) : null}
          </div>
        </div>
        <div className="rounded-full bg-white/15 px-3 py-1 text-xs text-muted-foreground">
          {endsAtPrefix} {endsAtLabel}
        </div>
      </div>
      {benefits.length > 0 ? (
        <ul className="mt-4 space-y-1.5">
          {benefits.map((benefit, index) => (
            <li key={index} className="flex items-center gap-2 text-sm">
              <span className={`size-1.5 rounded-full bg-emerald-500 ${playing ? "animate-pulse" : ""}`} />
              {benefit}
            </li>
          ))}
        </ul>
      ) : null}
      {replayLabel ? (
        <button
          type="button"
          className="mt-4 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-white/10"
          onClick={() => {
            setPlaying(false);
            window.setTimeout(() => setPlaying(true), 50);
          }}
        >
          {replayLabel}
        </button>
      ) : null}
    </div>
  );
}
