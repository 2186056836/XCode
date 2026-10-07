import { createHash } from "node:crypto";
import { unzipSync } from "fflate";

/**
 * 官方 marketing bundle hero 是一个 zip（index.html + 若干引用 js/css）。官方客户端在
 * host 侧把 zip 下载、校验 sha256、解包，并把 entry 里引用的相对资源内联成一份自包含
 * HTML，再作为可解析 URL（data URL）交给 renderer 的 sandbox iframe 加载。
 *
 * 这里复刻该管线（只读缓存，不落盘）：返回 `data:text/html;base64,...`。
 */
export interface MarketingBundleSpec {
  url: string;
  entry: string;
  sha256: string;
  /**
   * 剥离官方 bundle 里的 `claim-indicator`（「领取」文字胶囊）。
   * banner 卡片保留 true 视觉的一部分；弹窗（点击后的 dialog/popup）走 true。
   * 同一 zip 的两份渲染共用 sha256，用这个 flag 区分缓存条目。
   */
  stripClaimIndicator?: boolean;
}

function sanitizeHeroHtml(html: string): string {
  // 1) regex 剥离单个 `<g id="claim-indicator" ...>...</g>`（一层嵌套，官方 SVG 只有一层）
  let cleaned = html.replace(/<g\b[^>]*\bid=["']claim-indicator["'][^>]*>[\s\S]*?<\/g>/gi, "");
  // 2) 注入 CSS，无论该元素来自内联 HTML 还是 bundle JS 动态创建，ID 选择器都能覆盖它
  const hideStyle = '<style>#claim-indicator{display:none!important}</style>';
  if (!cleaned.includes("<head")) return cleaned.replace("</body>", hideStyle + "</body>");
  return cleaned.replace("<head>", "<head>" + hideStyle);
}

const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
const cache = new Map<string, Promise<string>>();

/** 把 entry HTML 中引用 zip 内文件的相对资源内联，产出自包含 HTML。 */
function inlineAssets(html: string, files: Record<string, Uint8Array>): string {
  // <script src="x"></script> -> <script>…</script>
  html = html.replace(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (_m, src) => {
    const normalized = normalizeAssetPath(src);
    const data = files[normalized] ?? files[src];
    if (data) {
      const text = Buffer.from(data).toString("utf8");
      return `<script>${text}</script>`;
    }
    return _m;
  });
  // <link rel="stylesheet" href="x"> -> <style>…</style>
  html = html.replace(/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi, (_m, href) => {
    const normalized = normalizeAssetPath(href);
    const data = files[normalized] ?? files[href];
    if (data) {
      const text = Buffer.from(data).toString("utf8");
      return `<style>${text}</style>`;
    }
    return _m;
  });
  return html;
}

function normalizeAssetPath(p: string): string {
  return p.replace(/^\.\//, "").replace(/^\//, "");
}

function assertSafeEntryName(name: string): void {
  if (!name || name.includes("..") || /^[A-Za-z]:/.test(name) || name.startsWith("/") || name.includes("\\")) {
    throw new Error("marketing_bundle_unsafe_entry");
  }
}

export async function prepareMarketingBundle(spec: MarketingBundleSpec): Promise<string> {
  const key = `${spec.sha256}|${spec.stripClaimIndicator ? "strip" : "raw"}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const pending = (async () => {
    if (!/^https?:$/.test(new URL(spec.url).protocol)) {
      throw new Error("marketing_bundle_source");
    }
    const res = await fetch(spec.url, {
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok || !res.body) throw new Error("marketing_bundle_download");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BUNDLE_BYTES) throw new Error("marketing_bundle_size");

    const digest = createHash("sha256").update(buf).digest("hex");
    if (digest !== spec.sha256) throw new Error("marketing_bundle_integrity");

    const files = unzipSync(new Uint8Array(buf)) as unknown as Record<string, Uint8Array>;
    const entry = spec.entry || "index.html";
    assertSafeEntryName(entry);
    const entryBytes = files[entry] ?? files[`./${entry}`];
    if (!entryBytes) throw new Error("marketing_bundle_entry");

    const html = inlineAssets(Buffer.from(entryBytes).toString("utf8"), files);
    // 剥离官方 bundle 领取指示器（`<g id="claim-indicator">` 或同名 JS 动态节点）
    const finalHtml = spec.stripClaimIndicator ? sanitizeHeroHtml(html) : html;
    return `data:text/html;base64,${Buffer.from(finalHtml, "utf8").toString("base64")}`;
  })();

  cache.set(key, pending);
  try {
    return await pending;
  } catch (e) {
    cache.delete(key); // 失败不缓存，允许下次重试
    throw e;
  }
}
