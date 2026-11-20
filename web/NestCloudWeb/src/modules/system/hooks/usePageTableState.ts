import { useCallback, useMemo, useState } from 'react';
import type { PageQuery } from '../types/common';

export type SortDirection = 'asc' | 'desc';

interface Options {
  defaultSort?: string;
  defaultPageSize?: number;
}

function parseDefaultSort(defaultSort?: string): { field?: string; direction?: SortDirection } {
  const [field, direction] = String(defaultSort ?? '')
    .split(':')
    .map((item) => item.trim())
    .filter(Boolean);

  if (!field || (direction !== 'asc' && direction !== 'desc')) {
    return { field, direction: field ? 'asc' : undefined };
  }

  return { field, direction };
}

export function usePageTableState(options: Options = {}) {
  const defaultSort = useMemo(() => parseDefaultSort(options.defaultSort), [options.defaultSort]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(options.defaultPageSize ?? 10);
  const [sortField, setSortField] = useState<string | undefined>(defaultSort.field);
  const [sortDirection, setSortDirection] = useState<SortDirection | undefined>(
    defaultSort.direction,
  );

  const sort = useMemo(() => {
    if (!sortField || !sortDirection) {
      return undefined;
    }
    return `${sortField}:${sortDirection}`;
  }, [sortDirection, sortField]);

  const buildQuery = useCallback(
    <T extends Record<string, string | number | boolean | undefined | null>>(
      filters: T,
    ): T & PageQuery => ({
      ...filters,
      pageNum: page,
      pageSize,
      sort,
    }),
    [page, pageSize, sort],
  );

  const updateFromPageResult = useCallback(
    (pageResult?: { page?: number; pageSize?: number } | null) => {
      if (!pageResult) {
        return;
      }
      if (
        typeof pageResult.page === 'number' &&
        Number.isFinite(pageResult.page) &&
        pageResult.page > 0
      ) {
        const nextPage = pageResult.page;
        setPage((current) => (current === nextPage ? current : nextPage));
      }
      if (
        typeof pageResult.pageSize === 'number' &&
        Number.isFinite(pageResult.pageSize) &&
        pageResult.pageSize > 0
      ) {
        const nextPageSize = pageResult.pageSize;
        setPageSize((current) => (current === nextPageSize ? current : nextPageSize));
      }
    },
    [],
  );

  const toggleSort = useCallback(
    (field: string) => {
      setPage(1);
      if (sortField === field) {
        setSortDirection((currentDirection) => (currentDirection === 'asc' ? 'desc' : 'asc'));
        return;
      }
      setSortField(field);
      setSortDirection('asc');
    },
    [sortField],
  );

  return useMemo(
    () => ({
      page,
      pageSize,
      setPage,
      setPageSize,
      sort,
      sortField,
      sortDirection,
      buildQuery,
      updateFromPageResult,
      toggleSort,
    }),
    [page, pageSize, sort, sortField, sortDirection, buildQuery, updateFromPageResult, toggleSort],
  );
}
