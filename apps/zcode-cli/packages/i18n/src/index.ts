import type { UiLocale, SupportedLocale } from "@zcode/contracts";
import { enUS } from "./locales/en-US.js";
import { zhCN } from "./locales/zh-CN.js";
import {
  DEFAULT_LOCALE,
  detectLocale,
  isSupportedLocale,
  isUiLocale,
  resolveLocale,
  SUPPORTED_LOCALES,
} from "./locale.js";
import type { XCodeCopy } from "./types.js";

export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  detectLocale,
  isSupportedLocale,
  isUiLocale,
  resolveLocale,
};
export type { LocaleDetectionInput } from "./locale.js";
export type { CliCopy, TuiCopy, UiLocale, SupportedLocale, XCodeCopy } from "./types.js";

const CATALOGS: Record<SupportedLocale, XCodeCopy> = {
  "en-US": enUS,
  "zh-CN": zhCN,
};

export function getXCodeCopy(locale?: UiLocale | string, detected?: string | null): XCodeCopy {
  return CATALOGS[resolveLocale(locale, detected)];
}
