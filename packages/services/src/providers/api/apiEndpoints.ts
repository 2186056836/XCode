import { buildRuntimeZCodeApiUrl, resolveZaiBusinessBaseUrl } from "@zcode/shared";

export const ZCODE_CLIENT_SCENES_URL = buildRuntimeZCodeApiUrl(
  process.env,
  "/api/v1/client/scenes",
);

export const ZCODE_MARKETING_TOUCH_URL = buildRuntimeZCodeApiUrl(
  process.env,
  "/api/v1/marketing/touch",
);

export const ZCODE_MARKETING_TOUCH_REPORT_URL = buildRuntimeZCodeApiUrl(
  process.env,
  "/api/v1/marketing/touch/action",
);

export const ZCODE_MANUAL_PLAN_PREVIEW_URL = buildRuntimeZCodeApiUrl(
  process.env,
  "/api/v1/zcode-plan/billing/preview",
);

export const ZCODE_MANUAL_PLAN_CLAIM_URL = buildRuntimeZCodeApiUrl(
  process.env,
  "/api/v1/zcode-plan/billing/claim",
);

export const ZAI_API_HOST = resolveZaiBusinessBaseUrl(process.env);
