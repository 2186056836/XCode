import { useCallback, useEffect, useRef, useState } from "react";
import type { XCodeUsageRequestDetailsResult } from "@zcode/shared";
import { useServices } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";

export type UsageDetailsStatusFilter = "" | "completed" | "error" | "cancelled" | "running";

export interface UsageDetailsFilters {
  providerId: string;
  modelId: string;
  status: UsageDetailsStatusFilter;
  /** 起止时间（datetime-local 字符串，"" 表示不限）。 */
  startDate: string;
  endDate: string;
}

export const EMPTY_USAGE_DETAILS_FILTERS: UsageDetailsFilters = {
  providerId: "",
  modelId: "",
  status: "",
  startDate: "",
  endDate: "",
};

export interface UsageRequestDetailsState {
  result: XCodeUsageRequestDetailsResult | null;
  loading: boolean;
  error: string | undefined;
  page: number;
  pageSize: number;
  filters: UsageDetailsFilters;
  setFilters: (filters: UsageDetailsFilters) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  refresh: () => void;
}

/** datetime-local 的本地时间字符串 → unix ms；空串或非法值返回 undefined（不限）。 */
function parseLocalDate(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * 「使用详情」取数：逐请求的 model_usage 明细。
 *
 * 数据源在 agent 侧 sqlite（与 App Usage 同源），经 usageStatsService 走协议查询。
 */
export function useUsageRequestDetails(): UsageRequestDetailsState {
  const { usageStatsService } = useServices();
  const [result, setResult] = useState<XCodeUsageRequestDetailsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFiltersState] = useState<UsageDetailsFilters>(EMPTY_USAGE_DETAILS_FILTERS);
  const requestVersionRef = useRef(0);

  const refresh = useCallback(() => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setLoading(true);
    setError(undefined);
    void Promise.resolve(
      usageStatsService.getRequestDetails({
        page,
        pageSize,
        ...(parseLocalDate(filters.startDate) !== undefined
          ? { since: parseLocalDate(filters.startDate) }
          : {}),
        ...(parseLocalDate(filters.endDate) !== undefined
          ? { until: parseLocalDate(filters.endDate) }
          : {}),
        ...(filters.providerId ? { providerId: filters.providerId } : {}),
        ...(filters.modelId ? { modelId: filters.modelId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      }),
    )
      .then((value) => {
        if (requestVersionRef.current !== requestVersion) return;
        setResult(value);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (requestVersionRef.current !== requestVersion) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        logger.warn("[useUsageRequestDetails] 读取使用详情失败", { error: message });
        setError(message);
        setLoading(false);
      });
  }, [filters, page, pageSize, usageStatsService]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setFilters = useCallback((next: UsageDetailsFilters) => {
    // 换过滤条件回到第一页：留在旧页码会落到越界空页。
    setPage(1);
    setFiltersState(next);
  }, []);

  const changePageSize = useCallback((next: number) => {
    setPage(1);
    setPageSize(next);
  }, []);

  return {
    result,
    loading,
    error,
    page,
    pageSize,
    filters,
    setFilters,
    setPage,
    setPageSize: changePageSize,
    refresh,
  };
}
