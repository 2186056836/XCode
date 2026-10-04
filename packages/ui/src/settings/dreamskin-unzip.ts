/**
 * DreamSkin ZIP 主题包解包（renderer 侧，零依赖）。
 *
 * Electron/Chromium 提供 DecompressionStream("deflate-raw")，足以解开
 * 标准 ZIP（STORE + DEFLATE 两种压缩，DreamSkin 包只用这两种）。
 * 只解出导入器需要的四类文件，其余条目跳过；上限沿用 DreamSkin 契约
 * （32 条目）与单文件 16MB 校验。
 */

const MAX_ENTRIES = 32;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;

export interface UnzippedSkinFiles {
  themeJson: string;
  themeCssPresent: boolean;
  /** theme.css 原文。Codex 的渲染真相全在这段 Safe CSS 里（面的 alpha/圆角/阴影），
   *  导入时必须原文携带，否则主题的 5% 半透面会被引擎默认蒙层整块替换。 */
  themeCss?: string;
  manifest?: string;
  // 字段名与 convertDreamSkinTheme 的入参保持一致：改名会让背景图在转换阶段静默丢失。
  backgroundImage?: { dataUrl: string; bytes: number; mediaType: string };
}

const BACKGROUND_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

function mediaTypeOf(entryName: string): string | null {
  const ext = entryName.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return null;
}

/** central directory 里单个文件头（局部解析，不走完整 ZIP 结构状态机）。 */
interface ZipEntryHeader {
  name: string;
  compressedSize: number;
  method: number;
  localHeaderOffset: number;
}

function readZipEntries(buffer: ArrayBuffer): ZipEntryHeader[] {
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  // EOCD 从尾部找（注释最长 65535 字节）。
  let eocdOffset = -1;
  const scanStart = Math.max(0, view.byteLength - 66_000);
  for (let i = view.byteLength - 22; i >= scanStart; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("ZIP end-of-central-directory not found");
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const entries: ZipEntryHeader[] = [];
  let offset = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break; // central dir 签名
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength));
    entries.push({ name, compressedSize, method, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([compressed as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * 解包 DreamSkin 主题包 ZIP。支持文件位于根目录或唯一一层主题子目录。
 * 抛错消息即用户可见失败原因（i18n 由调用方包裹）。
 */
export async function unzipDreamSkinTheme(zipBytes: ArrayBuffer): Promise<UnzippedSkinFiles> {
  const entries = readZipEntries(zipBytes);
  if (entries.length === 0) throw new Error("ZIP is empty");
  if (entries.length > MAX_ENTRIES) throw new Error("ZIP has too many entries");

  // 唯一一层主题目录归一：取所有条目的公共前缀目录。
  const dirPrefix = (() => {
    const names = entries.map((entry) => entry.name);
    if (!names.every((name) => name.includes("/"))) return "";
    const firstSegments = names.map((name) => name.split("/")[0]);
    if (new Set(firstSegments).size !== 1) return "";
    return `${firstSegments[0]}/`;
  })();

  const wanted = (name: string): string | null => {
    const rel = name.startsWith(dirPrefix) ? name.slice(dirPrefix.length) : name;
    if (rel.includes("/")) return null; // 深层条目不在契约内
    if (rel === "theme.json") return "themeJson";
    if (rel === "theme.css") return "themeCss";
    if (rel === "manifest.json") return "manifest";
    if (BACKGROUND_EXTENSIONS.has(rel.split(".").pop()?.toLowerCase() ?? "")) return "background";
    return null;
  };

  const result: UnzippedSkinFiles = { themeJson: "", themeCssPresent: false };
  const view = new DataView(zipBytes);
  const decoder = new TextDecoder();

  for (const entry of entries) {
    const kind = wanted(entry.name);
    if (!kind) continue;
    if (entry.compressedSize > MAX_ENTRY_BYTES) throw new Error(`entry too large: ${entry.name}`);

    const headerOffset = entry.localHeaderOffset;
    if (view.getUint32(headerOffset, true) !== 0x04034b50) {
      throw new Error(`invalid local header: ${entry.name}`);
    }
    const nameLength = view.getUint16(headerOffset + 26, true);
    const extraLength = view.getUint16(headerOffset + 28, true);
    const dataOffset = headerOffset + 30 + nameLength + extraLength;
    const compressed = new Uint8Array(zipBytes, dataOffset, entry.compressedSize);
    // DreamSkin 包不会用 zip64/加密；STORE(0) 与 DEFLATE(8) 之外的拒绝。
    const raw =
      entry.method === 0
        ? compressed
        : entry.method === 8
          ? await inflateRaw(compressed)
          : (() => {
              throw new Error(`unsupported compression: ${entry.name}`);
            })();

    if (kind === "themeJson") result.themeJson = decoder.decode(raw);
    else if (kind === "themeCss") {
      const css = decoder.decode(raw);
      result.themeCssPresent = css.trim().length > 0;
      result.themeCss = css;
    } else if (kind === "manifest") result.manifest = decoder.decode(raw);
    else if (kind === "background") {
      const mediaType = mediaTypeOf(entry.name) ?? "application/octet-stream";
      result.backgroundImage = {
        dataUrl: `data:${mediaType};base64,${base64FromBytes(raw)}`,
        bytes: raw.byteLength,
        mediaType,
      };
    }
  }
  return result;
}
