import { describe, expect, it } from "vitest";

import { findClaimablePlanId } from "../src/lib/marketingClaimAll.js";

/**
 * 服务端下发的投放结构由 `marketingDeliverySchema` 决定：动作挂在
 * `banner.buttons[].action` / `popup.buttons[].action`，类型是 `claim_zcode_plan`，
 * 计划 id 在 `args.plan_id`。
 *
 * 曾经这里按 `delivery.campaign.actions`（旧结构）读，`campaign` 恒为 undefined，
 * 于是每次领取都判成「无可领取活动」。这组用例把这个回归钉住。
 */
function bannerDelivery(buttons: unknown[]) {
  return {
    campaign_id: "campaign-1",
    priority: 10,
    resource_position: "banner" as const,
    banner: { background: {} as never, buttons, success_popup: null },
  };
}

function popupDelivery(buttons: unknown[]) {
  return {
    campaign_id: "campaign-2",
    priority: 20,
    resource_position: "popup" as const,
    popup: { title: { format: "plaintext", content: "t" }, description: { format: "plaintext", content: "d" }, buttons },
  };
}

describe("findClaimablePlanId", () => {
  it("从 banner 按钮的 claim_zcode_plan 动作里取 plan_id", () => {
    const id = findClaimablePlanId([
      bannerDelivery([
        { text: { format: "plaintext", content: "立即领取" }, action: { type: "claim_zcode_plan", args: { plan_id: "plan-banner" } } },
      ]) as never,
    ]);
    expect(id).toBe("plan-banner");
  });

  it("从 popup 按钮里取 plan_id（新活动常以弹窗下发）", () => {
    const id = findClaimablePlanId([
      popupDelivery([
        { text: { format: "plaintext", content: "领取" }, action: { type: "claim_zcode_plan", args: { plan_id: "plan-popup" } } },
      ]) as never,
    ]);
    expect(id).toBe("plan-popup");
  });

  it("忽略非领取动作", () => {
    const id = findClaimablePlanId([
      bannerDelivery([
        { text: { format: "plaintext", content: "了解更多" }, action: { type: "open_url", args: { url: "https://example.com" } } },
      ]) as never,
    ]);
    expect(id).toBeNull();
  });

  it("没有投放时返回 null", () => {
    expect(findClaimablePlanId([])).toBeNull();
  });
});
