import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DictionaryApi, type DictionaryItem as DictionaryRuntimeItem } from '../api/dictionaryApi';
import { LoginLogApi } from '../api/loginLogApi';
import { PagePagination } from '../components/PagePagination';
import { SortableColumnHeader } from '../components/SortableColumnHeader';
import { usePageTableState } from '../hooks/usePageTableState';
import { formatDateTime } from '../utils/formatters';

interface Filters {
  accountName: string;
  eventType: string;
  success: string;
  limit: string;
}

const defaultFilters: Filters = {
  accountName: '',
  eventType: '',
  success: '',
  limit: '100',
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function normalizeDictionaryValue(value: unknown) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

function getDictionaryOptionValue(item: DictionaryRuntimeItem) {
  if (['string', 'number', 'boolean'].includes(typeof item.value)) {
    return String(item.value);
  }
  return String(item.key);
}

function getDictionaryLabel(items: DictionaryRuntimeItem[], value: unknown, fallback = '') {
  const normalizedValue = normalizeDictionaryValue(value);
  if (!normalizedValue) {
    return fallback;
  }

  const matched = items.find((item) => {
    return (
      normalizeDictionaryValue(item.key) === normalizedValue ||
      normalizeDictionaryValue(item.value) === normalizedValue
    );
  });

  return matched?.label || fallback;
}

export function LoginLogPage() {
  const tableState = usePageTableState({ defaultSort: 'id:desc' });

  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [draftFilters, setDraftFilters] = useState<Filters>(defaultFilters);

  const loginLogQuery = useMemo(
    () =>
      tableState.buildQuery({
        accountName: filters.accountName.trim() || undefined,
        eventType: filters.eventType.trim() || undefined,
        success: filters.success || undefined,
        limit: filters.limit.trim() || undefined,
      }),
    [filters, tableState],
  );

  const overviewQuery = useQuery({
    queryKey: ['login-log-overview'],
    queryFn: () => LoginLogApi.getOverview(),
  });

  const itemsQuery = useQuery({
    queryKey: ['login-logs', loginLogQuery],
    queryFn: () => LoginLogApi.listItems(loginLogQuery),
  });

  const successDictionaryQuery = useQuery({
    queryKey: ['dictionary-runtime', 'common', 'success-state'],
    queryFn: () => DictionaryApi.listRuntimeItems('common', 'success-state'),
  });

  const eventTypeDictionaryQuery = useQuery({
    queryKey: ['dictionary-runtime', 'common', 'login-log.event-type'],
    queryFn: () => DictionaryApi.listRuntimeItems('common', 'login-log.event-type'),
  });

  useEffect(() => {
    tableState.updateFromPageResult(itemsQuery.data);
  }, [itemsQuery.data, tableState]);

  const successStateItems = successDictionaryQuery.data ?? [];
  const eventTypeItems = eventTypeDictionaryQuery.data ?? [];
  const items = itemsQuery.data?.list ?? [];
  const total = itemsQuery.data?.total ?? 0;
  const totalPages = itemsQuery.data?.totalPages ?? 1;
  const isBusy =
    overviewQuery.isFetching ||
    itemsQuery.isFetching ||
    successDictionaryQuery.isFetching ||
    eventTypeDictionaryQuery.isFetching;

  const pageErrorMessage = useMemo(() => {
    const firstError = [
      overviewQuery.error,
      itemsQuery.error,
      successDictionaryQuery.error,
      eventTypeDictionaryQuery.error,
    ].find(Boolean);
    return firstError ? getErrorMessage(firstError, '登录日志加载失败') : null;
  }, [
    eventTypeDictionaryQuery.error,
    itemsQuery.error,
    overviewQuery.error,
    successDictionaryQuery.error,
  ]);

  return (
    <div className="page-card">
      <div className="d-flex flex-column gap-3">
        <div className="d-flex flex-column gap-1">
          <h2 className="m-0">登录日志</h2>
          <p className="text-secondary mb-0">
            查询登录成功、失败、锁定、登出和密码重置等安全事件。
          </p>
        </div>

        {pageErrorMessage ? (
          <div className="alert alert-danger mb-0">{pageErrorMessage}</div>
        ) : null}

        <form
          className="row g-3 align-items-end"
          onSubmit={(event) => {
            event.preventDefault();
            tableState.setPage(1);
            setFilters(draftFilters);
          }}
        >
          <div className="col-md-4">
            <label className="form-label" htmlFor="loginLogAccountNameInput">
              账号名
            </label>
            <input
              id="loginLogAccountNameInput"
              className="form-control"
              value={draftFilters.accountName}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  accountName: event.target.value,
                }))
              }
              placeholder="按账号名筛选"
            />
          </div>
          <div className="col-md-3">
            <label className="form-label" htmlFor="loginLogEventTypeInput">
              事件类型
            </label>
            <input
              id="loginLogEventTypeInput"
              className="form-control"
              value={draftFilters.eventType}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  eventType: event.target.value,
                }))
              }
              placeholder="如 login-success"
            />
          </div>
          <div className="col-md-2">
            <label className="form-label" htmlFor="loginLogSuccessSelect">
              结果
            </label>
            <select
              id="loginLogSuccessSelect"
              className="form-select"
              value={draftFilters.success}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  success: event.target.value,
                }))
              }
            >
              <option value="">全部</option>
              {successStateItems.map((item) => {
                const value = getDictionaryOptionValue(item);
                return (
                  <option key={value} value={value}>
                    {item.label || item.key}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="col-md-1">
            <label className="form-label" htmlFor="loginLogLimitInput">
              限制
            </label>
            <input
              id="loginLogLimitInput"
              className="form-control"
              inputMode="numeric"
              value={draftFilters.limit}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  limit: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-md-2 d-flex gap-2">
            <button className="btn btn-success" type="submit" disabled={isBusy}>
              查询
            </button>
            <button
              className="btn btn-outline-secondary"
              type="button"
              onClick={() => {
                setDraftFilters(defaultFilters);
                setFilters(defaultFilters);
                tableState.setPage(1);
              }}
            >
              重置
            </button>
          </div>
        </form>

        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <SortableColumnHeader
                  label="ID"
                  field="id"
                  sortable
                  sortField={tableState.sortField}
                  sortDirection={tableState.sortDirection}
                  onSort={tableState.toggleSort}
                />
                <th scope="col">账号名</th>
                <th scope="col">事件类型</th>
                <th scope="col">结果</th>
                <th scope="col">消息</th>
                <th scope="col">IP</th>
                <th scope="col">User-Agent</th>
                <SortableColumnHeader
                  label="创建时间"
                  field="createdAt"
                  sortable
                  sortField={tableState.sortField}
                  sortDirection={tableState.sortDirection}
                  onSort={tableState.toggleSort}
                />
              </tr>
            </thead>
            <tbody>
              {items.length ? (
                items.map((item) => (
                  <tr key={`${item.id}-${item.createdAt ?? ''}`}>
                    <td>{item.id}</td>
                    <td>{item.accountName || '-'}</td>
                    <td>
                      {getDictionaryLabel(eventTypeItems, item.eventType, item.eventType || '-')}
                    </td>
                    <td>
                      <span className={`badge-inline ${item.success ? 'success' : 'secondary'}`}>
                        {getDictionaryLabel(
                          successStateItems,
                          item.success,
                          item.success ? '成功' : '失败',
                        )}
                      </span>
                    </td>
                    <td>
                      <div className="pre-wrap">{item.message || '-'}</div>
                    </td>
                    <td>{item.ip || '-'}</td>
                    <td>
                      <div className="pre-wrap">{item.userAgent || '-'}</div>
                    </td>
                    <td>{formatDateTime(item.createdAt)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8}>
                    <div className="text-center py-4 text-secondary">暂无登录日志数据</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <PagePagination
          page={tableState.page}
          pageSize={tableState.pageSize}
          total={total}
          totalPages={totalPages}
          onPageChange={tableState.setPage}
          onPageSizeChange={(nextPageSize) => {
            tableState.setPage(1);
            tableState.setPageSize(nextPageSize);
          }}
        />
      </div>
    </div>
  );
}
