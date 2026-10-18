/**
 * 供应商代理绑定视图的共享缓存（按 providerId 一份）。
 *
 * 同一个供应商页面上同时挂着四个消费者：账号行出口选择器、供应商级出口、批量分配行、
 * 账号轮询控件。它们各自 useState 时，任何一个消费者写盘之后，其余几个仍停在挂载时
 * 拉到的旧快照上——批量「套用到全部账号」确实写进了 provider config，但账号行还显示
 * 「跟随全局」，用户看到的就是「点了没反应 / 改了没生效」。
 *
 * 所以视图收敛成一份：谁写回结果谁广播，同 providerId 的所有消费者一起重渲染。
 * 视图本身仍由 host 计算（含停用池的摘绑定），这里只是同一进程内的分发层。
 */
import type { ProxyProviderBindingView } from "@zcode/services";

export interface ProviderBindingSlot {
  /** 是否已拿到过 host 的应答（含失败：失败也置 true，UI 才会从「加载中」退出）。 */
  loaded: boolean;
  view: ProxyProviderBindingView | null;
}

/** 未加载过的 providerId 共用同一个空槽，保证 getSnapshot 返回稳定引用。 */
const EMPTY_SLOT: ProviderBindingSlot = { loaded: false, view: null };

const slots = new Map<string, ProviderBindingSlot>();
const listeners = new Map<string, Set<() => void>>();

export function readProviderBindingSlot(providerId: string): ProviderBindingSlot {
  return slots.get(providerId) ?? EMPTY_SLOT;
}

export function writeProviderBindingSlot(
  providerId: string,
  slot: ProviderBindingSlot,
): void {
  slots.set(providerId, slot);
  const subscriptions = listeners.get(providerId);
  if (!subscriptions) {
    return;
  }
  // 复制一份再遍历：订阅者在回调里退订会改到原集合。
  for (const listener of [...subscriptions]) {
    listener();
  }
}

export function subscribeProviderBinding(
  providerId: string,
  listener: () => void,
): () => void {
  let subscriptions = listeners.get(providerId);
  if (!subscriptions) {
    subscriptions = new Set();
    listeners.set(providerId, subscriptions);
  }
  subscriptions.add(listener);
  return () => {
    subscriptions.delete(listener);
    if (subscriptions.size === 0) {
      listeners.delete(providerId);
    }
  };
}
