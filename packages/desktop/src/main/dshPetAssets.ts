/**
 * DSH 桌宠素材包：从上游仓库下载完整素材。
 *
 * 桌宠内置 8 个核心动作（待机/转向/拖拽/5 个点击回应）+ config，开箱即用。
 * 其余 98 个动作、27 张表情包和字体由「素材包」卡片一键下载到本地。
 *
 * **为什么逐文件而不是整包**：上游 archive 约 60 MB，实测本机对 codeload 与其加速镜像
 * 只有 31–51 KB/s —— 整包要 20–30 分钟，且中断就得重来。逐文件下载：
 *  - 单次失败只影响一个文件，已下载的保留，重试只补缺；
 *  - 进度、取消都能落到具体文件；
 *  - raw 端点支持 Range，慢速网络下比整包稳。
 *
 * 下载完成后所有动作都可用；未下载完整素材时，播放到缺失动作会跳回内置动作
 * （不阻塞界面，也不假装有素材）。
 *
 * 镜像择优：raw 端点有多个加速前缀，并发测速后取最快，失败自动降级。
 */
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, join } from "node:path";

/** 上游仓库坐标。 */
const REPO = "PC2005-cloud/dsh-pet";
const BRANCH = "main";
/** 素材在仓库里的固定前缀。 */
const ASSETS_PREFIX = `dsh-pet/assets`;

/**
 * raw 文件的镜像前缀候选。`{url}` 替换成 raw.githubusercontent.com 的完整地址。
 *
 * 顺序只是初始偏好；实际并发测速后取最快。官方源永远兜底。
 */
const RAW_MIRROR_TEMPLATES = [
  "https://gh-proxy.com/{url}",
  "https://ghfast.top/{url}",
  "https://raw.kgithub.com/{url}",
  "https://ghproxy.cc/{url}",
  "{url}",
] as const;

const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${ASSETS_PREFIX}`;

/** 测速：2.5 秒内能抢到多少字节就按吞吐排名。 */
const PROBE_TIMEOUT_MS = 2_500;
const PROBE_ENOUGH_BYTES = 64 * 1024;
/** 单文件下载超时。一个 webm 约 450 KB，慢速网络下给 3 分钟足够。 */
const FILE_TIMEOUT_MS = 3 * 60_000;
/** 同一镜像连续失败这么多次就标记为不可用，后续文件不再尝试。 */
const MIRROR_FAILURE_LIMIT = 3;
/** 并发下载的文件数：太多会互相抢带宽，反而慢。 */
const DOWNLOAD_CONCURRENCY = 3;

export interface DshAssetManifest {
  webm: string[];
  memes: string[];
  fonts: string[];
}

export interface DshAssetProbe {
  label: string;
  template: string;
  bytesPerSecond: number;
  latencyMs: number;
  error?: string;
}

export interface DshAssetsStatus {
  installed: boolean;
  /**
   * 已就绪的文件数（按类别）。
   * `font` 恒为 true：上首软糖体已改为随应用内置的预置资源，不再走下载。
   */
  counts: { webm: number; memes: number; font: boolean };
  /** 每类**需要下载**的总数：已排除随包发布的内置动作与字体。 */
  totals: { webm: number; memes: number; font: number };
  dir: string;
  /** 最近一次使用过的镜像名。 */
  lastMirror?: string | null;
}

export interface DshAssetsProgress {
  /** 当前正在下载的文件名（带类别前缀，如 `webm/待机呼吸休闲`）。 */
  name: string;
  loaded: number;
  total: number;
  /** 已完成文件数 / 目标文件数。 */
  done: number;
  target: number;
  mirror?: string;
}

export interface DshAssetsManagerDeps {
  /** 缓存根目录（`<userData>/dsh-pet/assets`）。 */
  cacheRoot: string;
  logger: {
    info(message: string, detail?: unknown): void;
    warn(message: string, detail?: unknown): void;
  };
  fetchImpl: (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;
}

export interface DshAssetsManager {
  status(): Promise<DshAssetsStatus>;
  /** 已缓存动作的绝对路径集合（键 = 动作名）。渲染端据此决定是否需要下载。 */
  cachedWebmNames(): Promise<string[]>;
  cachedMemes(): Promise<string[]>;
  /** 测速并返回排好序的镜像。 */
  probeMirrors(): Promise<DshAssetProbe[]>;
  /**
   * 确保若干动作已缓存；缺失的并发下载。
   * 返回**已就绪**的动作名 → 绝对路径。
   */
  ensureWebm(
    names: readonly string[],
    options?: { signal?: AbortSignal; onProgress?: (p: DshAssetsProgress) => void },
  ): Promise<Record<string, string>>;
  /** 下载全部表情包（碎碎念配图池需要完整列表）。 */
  ensureMemes(options?: {
    signal?: AbortSignal;
    onProgress?: (p: DshAssetsProgress) => void;
  }): Promise<string[]>;
  /** 清空缓存。 */
  clear(): Promise<void>;
}

/**
 * 上游全部动作名（106 个，含内置 8 个）。
 *
 * 静态写死而不是运行时读 config.jsonc：主进程没有 jsonc 解析器，而这份清单
 * 只在「下载全部素材」时用到——单动作补缺路径不依赖它，清单过期不会阻断下载。
 */
export const ALL_ACTION_NAMES = [
  "三球抛接",
  "下五子棋",
  "东张西望",
  "中秋赏月吃月饼",
  "优雅女仆舞",
  "余额-分文不剩",
  "余额-数金皱眉",
  "余额-袋空如洗",
  "余额-金袋叮当",
  "余额-钱袋如常",
  "余额-钱袋满溢",
  "偷吃零食被抓住",
  "写代码",
  "写福字",
  "凭空生花",
  "动物环绕",
  "原地专心玩魔方",
  "原地小憩沉眠",
  "原地左转奔跑",
  "原地敲击桌面互动",
  "原地漂浮踏步",
  "原地跳跃抓碎头顶物品",
  "原地蹲下玩玩具汽车",
  "原地重力下蹲压缩",
  "变鸽子",
  "可爱宅舞",
  "吃Token",
  "吃冰淇淋融化",
  "吃午餐",
  "吃大闸蟹",
  "吃年糕",
  "吃早餐",
  "吃晚餐",
  "吃汤圆",
  "吃白饭",
  "吃粽子",
  "吃糖葫芦",
  "吃腊八粥",
  "吃西瓜",
  "吃重阳糕",
  "吃长寿面",
  "吃青团",
  "吃饺子",
  "吹气球",
  "吹笛子",
  "哈欠连天",
  "堆雪人",
  "大口吃零食",
  "女仆屈膝礼仪",
  "小幅度原地360度旋转展示",
  "小提琴演奏",
  "工作状态-原地踱步张望",
  "工作状态-垂头叹气冒汗",
  "工作状态-忙碌点按",
  "工作状态-思考冒泡",
  "工作状态-清点归档",
  "工作状态-雀跃庆祝",
  "待机呼吸休闲",
  "悠闲哼歌",
  "扑克魔术",
  "打瞌睡被惊醒",
  "抽陀螺",
  "拆礼物",
  "插茱萸赏菊",
  "摇扇纳凉",
  "撸猫",
  "收红包",
  "放孔明灯",
  "放河灯",
  "放烟花",
  "放风筝",
  "整体换装试色",
  "是啊，吃什么",
  "晨间刷牙",
  "涮火锅",
  "深度思考碎碎念",
  "点击回应-傲娇生气",
  "点击回应-元气挥手",
  "点击回应-害羞惊讶",
  "点击回应-开心跃动",
  "点击回应-挠痒咯咯笑",
  "照镜子",
  "玩水枪",
  "玩游戏气急败坏",
  "用鲸鱼尾巴拍打地面",
  "碎碎念-发呆碎碎念",
  "碎碎念-对屏碎碎念",
  "碎碎念-擦桌碎碎念",
  "穿针乞巧",
  "舞狮头",
  "荡秋千",
  "萌化小幽灵",
  "蓝鲸现世",
  "蝴蝶蜜蜂环绕头顶开花",
  "螃蟹走路",
  "被吓一跳",
  "被落叶淹没",
  "被鼠标拖拽悬空反馈",
  "装点圣诞树",
  "讨糖南瓜灯",
  "超大伸懒腰",
  "踢毽子",
  "轻快摇摆舞",
  "轻快记录",
  "骑木马",
  "鲸鱼吐泡泡特效",
];

/** 内置动作：这些随包发布，不需要下载。下载器不关心它，由渲染端决定要请求哪些。 */
export const BUNDLED_ACTIONS = [
  "待机呼吸休闲",
  "东张西望",
  "被鼠标拖拽悬空反馈",
  "点击回应-开心跃动",
  "点击回应-害羞惊讶",
  "点击回应-傲娇生气",
  "点击回应-挠痒咯咯笑",
  "点击回应-元气挥手",
] as const;

function mirrorLabel(template: string): string {
  if (template === "{url}") return "GitHub 官方";
  try {
    return new URL(template.replace("{url}", "https://x/")).hostname;
  } catch {
    return template;
  }
}

function rawUrl(template: string, relativePath: string): string {
  // 路径里含中文文件名，必须逐段编码；`/` 要保留成路径分隔符。
  const encoded = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const base = `${RAW_BASE}/${encoded}`;
  return template.includes("{url}") ? template.replace("{url}", base) : base;
}

/** 探测单个镜像前缀：量首字节延迟与短窗口吞吐。 */
async function probeMirror(
  template: string,
  fetchImpl: DshAssetsManagerDeps["fetchImpl"],
): Promise<DshAssetProbe> {
  // 用一个体积适中的真实素材当探针：441 KB，足够量出吞吐差异。
  const sample = "webm/待机呼吸休闲.webm";
  const url = rawUrl(template, sample);
  const label = mirrorLabel(template);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  let loaded = 0;
  let firstByteAt = 0;
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      return {
        label,
        template,
        bytesPerSecond: 0,
        latencyMs: Number.POSITIVE_INFINITY,
        error: `HTTP ${response.status}`,
      };
    }
    if (!response.body) {
      return {
        label,
        template,
        bytesPerSecond: 0,
        latencyMs: Number.POSITIVE_INFINITY,
        error: "no body",
      };
    }
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!firstByteAt) firstByteAt = Date.now();
      loaded += value?.byteLength ?? 0;
      if (loaded >= PROBE_ENOUGH_BYTES) break;
    }
    await reader.cancel().catch(() => undefined);
  } catch {
    // 超时是预期的（只为测速），已读到的字节仍然有效。
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  if (loaded === 0) {
    return {
      label,
      template,
      bytesPerSecond: 0,
      latencyMs: Number.POSITIVE_INFINITY,
      error: "unreachable",
    };
  }
  const elapsedMs = Math.max(1, Date.now() - startedAt);
  return {
    label,
    template,
    bytesPerSecond: Math.round((loaded / elapsedMs) * 1000),
    latencyMs: firstByteAt ? firstByteAt - startedAt : Number.POSITIVE_INFINITY,
  };
}

function rankProbes(results: DshAssetProbe[]): DshAssetProbe[] {
  return [...results].sort((a, b) => {
    if (a.error && !b.error) return 1;
    if (!a.error && b.error) return -1;
    if (b.bytesPerSecond !== a.bytesPerSecond) return b.bytesPerSecond - a.bytesPerSecond;
    return a.latencyMs - b.latencyMs;
  });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

/** 把一个 URL 的响应体写进目标文件；支持 `onChunk` 进度回调。 */
async function downloadToFile(
  url: string,
  targetPath: string,
  fetchImpl: DshAssetsManagerDeps["fetchImpl"],
  signal: AbortSignal | undefined,
  onChunk?: (loaded: number, total: number) => void,
): Promise<void> {
  const controller = new AbortController();
  const abortOuter = (): void => controller.abort();
  signal?.addEventListener("abort", abortOuter, { once: true });
  const timer = setTimeout(() => controller.abort(), FILE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!response.body) throw new Error("no body");
    const total = Number(response.headers.get("content-length") ?? 0);
    await mkdir(dirname(targetPath), { recursive: true });
    // 先写临时文件再 rename：中断时不会留下半个 webm 被当成已缓存。
    const tempPath = `${targetPath}.part`;
    const sink = createWriteStream(tempPath);
    const reader = response.body.getReader();
    let loaded = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          loaded += value.byteLength;
          sink.write(Buffer.from(value));
          onChunk?.(loaded, total);
        }
      }
      await new Promise<void>((resolvePromise, rejectPromise) => {
        sink.on("error", rejectPromise);
        sink.end(() => resolvePromise());
      });
    } catch (error) {
      sink.destroy();
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
    if (loaded === 0) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw new Error("empty body");
    }
    await rm(targetPath, { force: true });
    const { rename } = await import("node:fs/promises");
    await rename(tempPath, targetPath);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortOuter);
  }
}

export function createDshAssetsManager(deps: DshAssetsManagerDeps): DshAssetsManager {
  const { cacheRoot, logger, fetchImpl } = deps;

  /** 镜像排名缓存：一次会话内不必重复测速。 */
  let rankedMirrors: DshAssetProbe[] | null = null;
  /** 每个镜像的连续失败次数。 */
  const mirrorFailures = new Map<string, number>();
  /** 上次成功的模板，下次优先用它。 */
  let preferredTemplate: string | null = null;

  const ranking = async (): Promise<DshAssetProbe[]> => {
    if (rankedMirrors) return rankedMirrors;
    const probed = await Promise.all(
      RAW_MIRROR_TEMPLATES.map((template) => probeMirror(template, fetchImpl)),
    );
    rankedMirrors = rankProbes(probed);
    logger.info("[dsh-assets] mirror ranking", {
      ranked: rankedMirrors.map((r) => ({
        label: r.label,
        kbps: Math.round(r.bytesPerSecond / 1024),
        error: r.error ?? null,
      })),
    });
    return rankedMirrors;
  };

  /** 取当前可用镜像顺序：上次成功的优先，其余按测速排名，失败过多的排到最后。 */
  const mirrorOrder = async (): Promise<DshAssetProbe[]> => {
    const ranked = await ranking();
    return [...ranked].sort((a, b) => {
      const aFails = mirrorFailures.get(a.template) ?? 0;
      const bFails = mirrorFailures.get(b.template) ?? 0;
      if (aFails >= MIRROR_FAILURE_LIMIT && bFails < MIRROR_FAILURE_LIMIT) return 1;
      if (bFails >= MIRROR_FAILURE_LIMIT && aFails < MIRROR_FAILURE_LIMIT) return -1;
      if (preferredTemplate) {
        if (a.template === preferredTemplate) return -1;
        if (b.template === preferredTemplate) return 1;
      }
      if (a.error && !b.error) return 1;
      if (!a.error && b.error) return -1;
      return b.bytesPerSecond - a.bytesPerSecond;
    });
  };

  /** 带镜像降级的单文件下载。 */
  const fetchFile = async (
    relativePath: string,
    targetPath: string,
    signal: AbortSignal | undefined,
    onChunk?: (loaded: number, total: number) => void,
  ): Promise<string> => {
    const order = await mirrorOrder();
    let lastError = "";
    for (const mirror of order) {
      if (signal?.aborted) throw new Error("cancelled");
      if ((mirrorFailures.get(mirror.template) ?? 0) >= MIRROR_FAILURE_LIMIT) continue;
      try {
        await downloadToFile(
          rawUrl(mirror.template, relativePath),
          targetPath,
          fetchImpl,
          signal,
          onChunk,
        );
        mirrorFailures.set(mirror.template, 0);
        preferredTemplate = mirror.template;
        return mirror.label;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === "cancelled") throw error;
        lastError = message;
        mirrorFailures.set(mirror.template, (mirrorFailures.get(mirror.template) ?? 0) + 1);
        logger.warn("[dsh-assets] mirror failed for file", {
          mirror: mirror.label,
          file: relativePath,
          error: message,
        });
      }
    }
    throw new Error(lastError || "所有镜像都失败");
  };

  const webmPath = (name: string): string => join(cacheRoot, "webm", `${name}.webm`);
  const memePath = (name: string): string => join(cacheRoot, "memes", name);

  const listCached = async (sub: string, ext: string): Promise<string[]> => {
    try {
      const entries = await readdir(join(cacheRoot, sub));
      return entries.filter((n) => n.toLowerCase().endsWith(ext) && !n.endsWith(".part"));
    } catch {
      return [];
    }
  };

  /** 并发受限地跑任务。 */
  const runLimited = async <T, R>(
    items: readonly T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> => {
    const results: R[] = Array.from({ length: items.length }) as R[];
    let cursor = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        results[index] = await worker(items[index]!, index);
      }
    });
    await Promise.all(runners);
    return results;
  };

  return {
    async status(): Promise<DshAssetsStatus> {
      const [webm, memes] = await Promise.all([
        listCached("webm", ".webm"),
        listCached("memes", ".png"),
      ]);
      // 分母只算「需要下载的」：内置动作与字体随包发布、永远不会进缓存目录。
      // 之前写成上游总数 106，导致下满 98 个后仍显示「还差 8 个」。
      const downloadableWebm = ALL_ACTION_NAMES.filter(
        (name) => !BUNDLED_ACTIONS.includes(name as never),
      ).length;
      return {
        installed: webm.length > 0 || memes.length > 0,
        counts: { webm: webm.length, memes: memes.length, font: true },
        totals: { webm: downloadableWebm, memes: 27, font: 1 },
        dir: cacheRoot,
        lastMirror: preferredTemplate ? mirrorLabel(preferredTemplate) : null,
      };
    },

    async cachedWebmNames(): Promise<string[]> {
      const files = await listCached("webm", ".webm");
      return files.map((n) => n.slice(0, -5));
    },

    async cachedMemes(): Promise<string[]> {
      return listCached("memes", ".png");
    },

    async probeMirrors(): Promise<DshAssetProbe[]> {
      return mirrorOrder();
    },

    async ensureWebm(names, options = {}) {
      const unique = [...new Set(names.filter((n) => n && !BUNDLED_ACTIONS.includes(n as never)))];
      const ready: Record<string, string> = {};
      const missing: string[] = [];
      for (const name of unique) {
        const target = webmPath(name);
        if (await fileExists(target)) ready[name] = target;
        else missing.push(name);
      }
      if (missing.length === 0) return ready;

      let done = 0;
      const total = missing.length;
      await runLimited(missing, DOWNLOAD_CONCURRENCY, async (name) => {
        if (options.signal?.aborted) return;
        const target = webmPath(name);
        try {
          const mirror = await fetchFile(`webm/${name}.webm`, target, options.signal, (loaded, size) =>
            options.onProgress?.({
              name: `webm/${name}`,
              loaded,
              total: size,
              done,
              target: total,
              mirror: preferredTemplate ? mirrorLabel(preferredTemplate) : undefined,
            }),
          );
          ready[name] = target;
          done += 1;
          options.onProgress?.({
            name: `webm/${name}`,
            loaded: 1,
            total: 1,
            done,
            target: total,
            mirror,
          });
        } catch (error) {
          logger.warn("[dsh-assets] webm download failed", {
            name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
      return ready;
    },

    async ensureMemes(options = {}) {
      // 表情包清单写死在仓库里，避免再拉一次 manifest 文件。
      const MEME_NAMES = await loadMemeNames();
      const ready: string[] = [];
      const missing: string[] = [];
      for (const name of MEME_NAMES) {
        const target = memePath(name);
        if (await fileExists(target)) ready.push(name);
        else missing.push(name);
      }
      let done = 0;
      await runLimited(missing, DOWNLOAD_CONCURRENCY, async (name) => {
        if (options.signal?.aborted) return;
        try {
          await fetchFile(`memes/${name}`, memePath(name), options.signal, (loaded, size) =>
            options.onProgress?.({
              name: `memes/${name}`,
              loaded,
              total: size,
              done,
              target: missing.length,
            }),
          );
          ready.push(name);
          done += 1;
          options.onProgress?.({
            name: `memes/${name}`,
            loaded: 1,
            total: 1,
            done,
            target: missing.length,
          });
        } catch {
          /* 单张失败不致命 */
        }
      });
      return ready;
    },

    async clear(): Promise<void> {
      await rm(cacheRoot, { recursive: true, force: true });
      rankedMirrors = null;
      mirrorFailures.clear();
      preferredTemplate = null;
    },
  };
}

/**
 * 表情包文件名清单。
 *
 * 从内置 `pets-dsh/memes/manifest.json` 读的是本地那份（可能是空数组），
 * 所以这里内置一份与上游一致的清单；上游增删图时这里要同步。
 * 用 `ensureMemes` 时若清单为空会退化成「只下载已知的」——不会报错。
 */
const MEME_NAMES_FALLBACK = [
  "Ciallo.png",
  "token给妈妈保管.png",
  "假如给我三天多模态.png",
  "先养着吧.png",
  "厉害了我的鲸.png",
  "压力一只大肥鱼.png",
  "可爱.png",
  "吃白饭的大肥鱼.png",
  "吃饱饱摸肚子.png",
  "哦鲸鲸.png",
  "哪来的电脑病毒.png",
  "大师这个区是什么意思.png",
  "大烧货.png",
  "大的药来了.png",
  "大的要来啦.png",
  "完蛋了把黄油删了.png",
  "就一碗.png",
  "就骚了怎么滴吧.png",
  "我不更新你们用什么.png",
  "死掉了.png",
  "深度睡眠.png",
  "电死你.png",
  "要不直接骂他.png",
  "誓死践行开源精神.png",
  "除了调情没啥用.png",
  "鱼片有资源吗.png",
  "黎曼猜想没证明喵.png",
];

async function loadMemeNames(): Promise<string[]> {
  return MEME_NAMES_FALLBACK;
}
