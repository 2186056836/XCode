/**
 * DSH 桌宠对话弹窗（1:1 移植自上游 src/shared/chat/*）：
 * 一条自适应输入框 + 上传/截屏两枚图标按钮 + 可选图片预览，回车发送、Esc 或点外关闭。
 * 回复不看这里——发送成功后弹窗关闭，回复由主进程推回并以气泡展示（上游 /state say 语义）。
 */
import { CHAT_CSS, CHAT_H_PAD, CHAT_MAX_W, CHAT_MIN_W } from "../shared/dshPetChatUi.js";

/** 随消息发送的一张图片：`data` 是规范 base64（不带 data: 前缀）。 */
export interface ChatAttachment {
  mediaType: string;
  data: string;
}

export interface ChatDialogMount {
  el: HTMLElement;
  close: () => void;
}

export interface ChatDialogOptions {
  /** 弹窗落点（视口坐标）；超出 clamp 矩形自动夹回。 */
  x: number;
  y: number;
  /** 允许占用的矩形；缺省 = 整个视口。 */
  clamp?: { x: number; y: number; w: number; h: number };
  /** 发送：成功即关闭弹窗，回复走气泡。失败返回原因，弹窗留在原地显式提示。 */
  onSend: (text: string, attachment?: ChatAttachment) => Promise<{ ok: boolean; message?: string }>;
  /** 截屏实现（桌面端走主进程的 desktopCapturer）；缺省 = 按钮提示当前环境不支持。 */
  capture?: () => Promise<EncodedImage>;
  onClose?: () => void;
  /** 打开时就带着的图片（拖拽落到宠物身上走的这条）；缺省 = 空弹窗。 */
  initialImage?: File;
}

/** 提示自动收起的时间（ms）。 */
const HINT_MS = 2200;
/** 单张图片的字节上限（解码后）。 */
const IMAGE_MAX_BYTES = 640 * 1024;
/** 长边上限。 */
const IMAGE_MAX_SIDE = 2048;
/** 质量阶梯：从高到低，第一档进预算就停。 */
const IMAGE_QUALITIES = [0.85, 0.75, 0.65, 0.55] as const;
/** 预览缩略图的长边（像素）。 */
const PREVIEW_SIDE = 96;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
const IMAGE_ACCEPT = IMAGE_TYPES.join(",");

type PetImageMediaType = (typeof IMAGE_TYPES)[number];

const IMAGE_EXT: Record<string, PetImageMediaType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

function imageMediaTypeOf(file: File): PetImageMediaType | undefined {
  const declared = String(file.type || "").toLowerCase();
  if ((IMAGE_TYPES as readonly string[]).includes(declared)) return declared as PetImageMediaType;
  const ext = String(file.name || "").split(".").pop()?.toLowerCase();
  return ext === undefined ? undefined : IMAGE_EXT[ext];
}

function isImageFile(file: File): boolean {
  return imageMediaTypeOf(file) !== undefined;
}

function attachmentBytes(base64: string): number {
  const pad = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - pad;
}

function targetSize(
  width: number,
  height: number,
  maxSide = IMAGE_MAX_SIDE,
): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export interface EncodedImage {
  base64: string;
  mediaType: PetImageMediaType;
  previewUrl: string;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("这个文件读不出来"));
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      if (!url) {
        reject(new Error("这个文件读不出来"));
        return;
      }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("这个文件解不出图片"));
      img.src = url;
    };
    reader.readAsDataURL(file);
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(bin);
}

function drawToCanvas(source: CanvasImageSource, size: { width: number; height: number }): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext("2d")?.drawImage(source, 0, 0, size.width, size.height);
  return canvas;
}

function previewOf(source: CanvasImageSource, width: number, height: number): string {
  return drawToCanvas(source, targetSize(width, height, PREVIEW_SIDE)).toDataURL("image/jpeg", 0.72);
}

function encodeCanvas(canvas: HTMLCanvasElement): EncodedImage {
  const { width, height } = canvas;
  const previewUrl = previewOf(canvas, width, height);
  const floor = IMAGE_QUALITIES[IMAGE_QUALITIES.length - 1];
  for (const quality of IMAGE_QUALITIES) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    if (attachmentBytes(base64) <= IMAGE_MAX_BYTES || quality === floor) {
      return { base64, mediaType: "image/jpeg", previewUrl };
    }
  }
  throw new Error("无法压到预算内");
}

/** 原图够小就原样发送（不重编码：JPEG 再压一次会掉画质，动图也能保住）。 */
async function encodeImageFile(file: File): Promise<EncodedImage> {
  const mediaType = imageMediaTypeOf(file);
  if (!mediaType) throw new Error("不是可发送的图片");
  const img = await loadImage(file);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  const raw = new Uint8Array(await file.arrayBuffer());
  if (raw.length <= IMAGE_MAX_BYTES && Math.max(width, height) <= IMAGE_MAX_SIDE) {
    return { base64: bytesToBase64(raw), mediaType, previewUrl: previewOf(img, width, height) };
  }
  return encodeCanvas(drawToCanvas(img, targetSize(width, height)));
}

const ICON_ATTRS = {
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.8",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true",
} as const;

function svgNode(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node as SVGElement;
}

/** 图片图标：外框 + 太阳 + 山脊。 */
function pictureIcon(size = 16): SVGElement {
  const svg = svgNode("svg", { viewBox: "0 0 24 24", width: String(size), height: String(size), ...ICON_ATTRS });
  svg.append(
    svgNode("rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }),
    svgNode("circle", { cx: "8.5", cy: "8.5", r: "1.5" }),
    svgNode("path", { d: "M21 15l-5-5L5 21" }),
  );
  return svg;
}

/** 相机图标：机身 + 镜头。 */
function cameraIcon(size = 16): SVGElement {
  const svg = svgNode("svg", { viewBox: "0 0 24 24", width: String(size), height: String(size), ...ICON_ATTRS });
  svg.append(
    svgNode("path", { d: "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" }),
    svgNode("circle", { cx: "12", cy: "13", r: "4" }),
  );
  return svg;
}

let chatCssInjected = false;
function injectChatCss(): void {
  if (chatCssInjected) return;
  chatCssInjected = true;
  const tag = document.createElement("style");
  tag.textContent = CHAT_CSS;
  document.head.appendChild(tag);
}

/** 造一枚图标按钮（图标 + 无障碍标签）。 */
function iconButton(title: string, icon: SVGElement): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dsh-pet-chat-btn";
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.appendChild(icon);
  return btn;
}

/** 输入框宽度随文本自适应：宽度按测量值，封顶后由高度接住折行。 */
function enableAutoResize(input: HTMLTextAreaElement, root: HTMLElement): () => void {
  let measureCtx: CanvasRenderingContext2D | null = null;
  const resize = (): void => {
    const ctx =
      measureCtx ?? (measureCtx = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D);
    ctx.font = getComputedStyle(input).font;
    const textW = ctx.measureText(input.value || " ").width;
    const w = Math.max(CHAT_MIN_W, Math.min(Math.ceil(textW + CHAT_H_PAD), CHAT_MAX_W));
    root.style.width = `${w}px`;
    input.style.height = "auto";
    input.style.height = `${Math.max(input.scrollHeight, 22)}px`;
  };
  input.addEventListener("input", resize);
  return resize;
}

/** 挂载对话弹窗（上游 mountChatDialog 的桌面等价实现）。 */
export function mountChatDialog(opts: ChatDialogOptions): ChatDialogMount {
  injectChatCss();
  const { x, y, onSend, onClose } = opts;
  const c =
    opts.clamp && Number.isFinite(opts.clamp.x + opts.clamp.y + opts.clamp.w + opts.clamp.h)
      ? opts.clamp
      : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };

  const root = document.createElement("div");
  root.className = "dsh-pet-chat";

  const input = document.createElement("textarea");
  input.className = "dsh-pet-chat-input";
  input.placeholder = "说点什么…";
  input.maxLength = 2000;
  input.rows = 1;

  const err = document.createElement("div");
  err.className = "dsh-pet-chat-err";
  err.style.display = "none";

  const hint = document.createElement("div");
  hint.className = "dsh-pet-chat-hint";
  let hintTimer = 0;
  const flash = (text: string): void => {
    hint.textContent = text;
    hint.style.display = "block";
    window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => {
      hint.style.display = "none";
    }, HINT_MS);
  };

  const pickBtn = iconButton("上传图片", pictureIcon());
  const shotBtn = iconButton("截取当前屏幕", cameraIcon());
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = IMAGE_ACCEPT;
  fileInput.style.display = "none";

  const attach = document.createElement("div");
  attach.className = "dsh-pet-chat-attach";
  const thumb = document.createElement("img");
  thumb.className = "dsh-pet-chat-thumb";
  thumb.alt = "已选图片";
  const attachX = document.createElement("button");
  attachX.type = "button";
  attachX.className = "dsh-pet-chat-attach-x";
  attachX.textContent = "✕";
  attachX.title = "移除图片";
  attachX.setAttribute("aria-label", "移除图片");
  attach.append(thumb, attachX);

  const actions = document.createElement("div");
  actions.className = "dsh-pet-chat-actions";
  actions.append(pickBtn, shotBtn, fileInput, attach);

  root.append(input, actions, hint, err);
  document.body.appendChild(root);

  let attachment: ChatAttachment | undefined;
  let encoding = false;
  const clearAttach = (): void => {
    attachment = undefined;
    attach.dataset.on = "0";
    thumb.removeAttribute("src");
    fileInput.value = "";
  };
  const setImageFile = async (file: File): Promise<boolean> => {
    if (!isImageFile(file)) {
      flash("只支持 PNG / JPEG / WebP / GIF");
      return false;
    }
    encoding = true;
    pickBtn.disabled = true;
    try {
      const encoded = await encodeImageFile(file);
      if (!root.isConnected) return false;
      attachment = { mediaType: encoded.mediaType, data: encoded.base64 };
      thumb.src = encoded.previewUrl;
      attach.dataset.on = "1";
      return true;
    } catch (e) {
      flash(`读图失败：${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      encoding = false;
      pickBtn.disabled = false;
    }
  };

  pickBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) void setImageFile(file);
  });
  attachX.addEventListener("click", clearAttach);
  // 粘贴图片：截图工具通常先把图放剪贴板，Ctrl+V 比「存盘再选文件」少两步。
  root.addEventListener("paste", (event) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file && isImageFile(file)) {
        event.preventDefault();
        void setImageFile(file);
        return;
      }
    }
  });
  // 截屏：有实现就抓一帧（与上传走同一条预算编码）；没有就说明当前环境不支持。
  let capturing = false;
  if (opts.capture) {
    const capture = opts.capture;
    shotBtn.addEventListener("click", () => {
      if (capturing) return;
      capturing = true;
      shotBtn.disabled = true;
      void capture()
        .then((encoded) => {
          if (!root.isConnected) return false;
          attachment = { mediaType: encoded.mediaType, data: encoded.base64 };
          thumb.src = encoded.previewUrl;
          attach.dataset.on = "1";
          return true;
        })
        .catch((e: unknown) => flash(`截屏失败：${e instanceof Error ? e.message : String(e)}`))
        .finally(() => {
          capturing = false;
          shotBtn.disabled = false;
        });
    });
  } else {
    shotBtn.addEventListener("click", () => flash("当前环境不支持截屏，先用上传试试"));
  };

  let closed = false;
  let sending = false;
  const doSend = (): void => {
    if (closed || sending) return;
    if (encoding || capturing) {
      flash("图片还在处理，稍等一下");
      return;
    }
    const text = input.value.trim();
    if (!text) return;
    sending = true;
    input.disabled = true;
    void onSend(text, attachment)
      .then((state) => {
        if (state.ok) {
          close();
          return;
        }
        err.textContent = `对话失败：${state.message ?? "请稍后再试"}`;
        err.style.display = "block";
      })
      .catch((e: unknown) => {
        err.textContent = `对话异常：${e instanceof Error ? e.message : String(e)}`;
        err.style.display = "block";
      })
      .finally(() => {
        sending = false;
        input.disabled = false;
        if (!closed) input.focus();
      });
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      doSend();
    }
  });

  /** 以 (x,y) 落点，超出 clamp 矩形夹回（先量后定位）。 */
  const place = (): void => {
    const rect = root.getBoundingClientRect();
    root.style.left = `${Math.max(c.x + 4, Math.min(x, c.x + c.w - rect.width - 4))}px`;
    root.style.top = `${Math.max(c.y + 4, Math.min(y, c.y + c.h - rect.height - 4))}px`;
  };

  let detach: (() => void) | null = null;
  let closeRef = (): void => {};
  function close(): void {
    if (closed) return;
    closed = true;
    detach?.();
    window.clearTimeout(hintTimer);
    root.remove();
    onClose?.();
  }
  closeRef = close;

  const onDown = (event: MouseEvent): void => {
    if (closed || root.contains(event.target as Node)) return;
    closeRef();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") closeRef();
  };
  // 延迟注册：避免打开弹窗的这次 pointerdown 立刻把它关掉。
  window.setTimeout(() => {
    if (closed) return;
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    detach = () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, 0);

  const resizeInput = enableAutoResize(input, root);
  resizeInput();
  place();
  if (opts.initialImage) void setImageFile(opts.initialImage);
  input.focus();
  return { el: root, close };
}
