import { buildRuntimeXCodeApiUrl, resolveZaiBusinessBaseUrl } from "@zcode/shared";

export const XCODE_CLIENT_SCENES_URL = buildRuntimeXCodeApiUrl(
  process.env,
  "/api/v1/client/scenes",
);

export const XCODE_MARKETING_TOUCH_URL = buildRuntimeXCodeApiUrl(
  process.env,
  "/api/v1/marketing/touch",
);

export const XCODE_MARKETING_TOUCH_REPORT_URL = buildRuntimeXCodeApiUrl(
  process.env,
  "/api/v1/marketing/touch/action",
);

export const XCODE_MANUAL_PLAN_PREVIEW_URL = buildRuntimeXCodeApiUrl(
  process.env,
  "/api/v1/zcode-plan/billing/preview",
);

export const XCODE_MANUAL_PLAN_CLAIM_URL = buildRuntimeXCodeApiUrl(
  process.env,
  "/api/v1/zcode-plan/billing/claim",
);

export const ZAI_API_HOST = resolveZaiBusinessBaseUrl(process.env);
