import { buildRuntimeXCodeApiUrl, resolveZaiBusinessBaseUrl } from "@zcode/shared";

export const ZCODE_CLIENT_SCENES_URL = buildRuntimeXCodeApiUrl(
  process.env,
  "/api/v1/client/scenes",
);

export const ZAI_API_HOST = resolveZaiBusinessBaseUrl(process.env);
