import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";

/** 默认每页账号数。账号行带额度块与代理选择器，一页 5 条能让列表与操作在同一屏内。 */
export const ACCOUNT_PAGE_SIZE = 5;

/** 可选每页条数。 */
export const ACCOUNT_PAGE_SIZE_OPTIONS = [5, 10, 20, 50] as const;

/**
 * 账号列表分页。
 *
 * 供应商的账号是持续累积的（CodeBuddy / Qoder 每次登录都加一条），不翻页时
 * 列表会把设置页拉得很长，且每行都带额度块与代理选择器，滚动成本很高。
 *
 * 页码在数据变短时自动收敛：删除或换供应商后若停在越界页，会看到空白列表。
 */
export function useAccountPagination<T>(accounts: readonly T[]) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(ACCOUNT_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(accounts.length / pageSize));

  useEffect(() => {
    // 数据收缩到当前页之外时回到最后一页，避免删完账号后停在空页。
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return accounts.slice(start, start + pageSize);
  }, [accounts, page, pageSize]);

  const changePageSize = (next: number) => {
    // 改每页条数后保持「大致停在同一批数据」：按当前首条索引换算新页码，
    // 否则从第 3 页切到更大的页长会跳回一个完全不相干的位置。
    const firstVisibleIndex = (page - 1) * pageSize;
    setPageSize(next);
    setPage(Math.floor(firstVisibleIndex / next) + 1);
  };

  return {
    page,
    pageSize,
    totalPages,
    pageItems,
    setPage,
    setPageSize: changePageSize,
    // 只有一页且不需要改页长时不渲染分页条：多一层视觉噪音没有信息量。
    needsPagination: accounts.length > ACCOUNT_PAGE_SIZE_OPTIONS[0],
  };
}

/**
 * 分页条：首页/上一页 + 页码跳转输入 + 下一页/末页 + 每页条数。
 *
 * 页码输入用本地草稿值，失焦或回车才提交：受控 input 直接写 page 时，
 * 用户删掉数字准备重输会立刻被弹回 1，没法正常编辑。
 */
export function AccountPaginationBar({
  page,
  totalPages,
  pageSize,
  onChange,
  onPageSizeChange,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  onChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const { intl } = useXCodeIntl();
  const [draft, setDraft] = useState(String(page));

  useEffect(() => {
    setDraft(String(page));
  }, [page]);

  const commitDraft = () => {
    const parsed = Number.parseInt(draft, 10);
    if (!Number.isFinite(parsed)) {
      setDraft(String(page));
      return;
    }
    const clamped = Math.min(Math.max(1, parsed), totalPages);
    setDraft(String(clamped));
    if (clamped !== page) onChange(clamped);
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 pt-1 text-ui-sm text-foreground-subtle">
      <Select
        value={String(pageSize)}
        onValueChange={(value) => onPageSizeChange(Number(value))}
      >
        <SelectTrigger className="h-8 w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ACCOUNT_PAGE_SIZE_OPTIONS.map((size) => (
            <SelectItem key={size} value={String(size)}>
              {intl.formatMessage(
                { id: "settings.accounts.paginationPageSize" },
                { size: String(size) },
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={page <= 1}
        onClick={() => onChange(1)}
      >
        {intl.formatMessage({ id: "settings.accounts.paginationFirst" })}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        {intl.formatMessage({ id: "settings.accounts.paginationPrev" })}
      </Button>
      <div className="flex items-center gap-1">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value.replace(/[^\d]/g, ""))}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft();
            }
          }}
          inputMode="numeric"
          aria-label={intl.formatMessage({ id: "settings.accounts.paginationJump" })}
          className="h-8 w-12 text-center"
        />
        <span>
          {intl.formatMessage({ id: "settings.accounts.paginationTotal" }, { total: totalPages })}
        </span>
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        {intl.formatMessage({ id: "settings.accounts.paginationNext" })}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={page >= totalPages}
        onClick={() => onChange(totalPages)}
      >
        {intl.formatMessage({ id: "settings.accounts.paginationLast" })}
      </Button>
    </div>
  );
}
