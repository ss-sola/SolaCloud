import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DictionaryApi, type DictionaryItem as DictionaryRuntimeItem } from '../api/dictionaryApi';
import { OperationLogApi } from '../api/operationLogApi';
import { PagePagination } from '../components/PagePagination';
import { SortableColumnHeader } from '../components/SortableColumnHeader';
import { usePageTableState } from '../hooks/usePageTableState';
import { formatDateTime } from '../utils/formatters';

interface Filters {
  module: string;
  action: string;
  targetType: string;
  operator: string;
}

const defaultFilters: Filters = {
  module: '',
  action: '',
  targetType: '',
  operator: '',
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

export function OperationLogPage() {
  const tableState = usePageTableState({ defaultSort: 'id:desc' });

  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [draftFilters, setDraftFilters] = useState<Filters>(defaultFilters);

  const operationLogQuery = useMemo(
    () =>
      tableState.buildQuery({
        module: filters.module.trim() || undefined,
        action: filters.action.trim() || undefined,
        targetType: filters.targetType.trim() || undefined,
        operator: filters.operator.trim() || undefined,
      }),
    [filters, tableState],
  );

  const overviewQuery = useQuery({
    queryKey: ['operation-log-overview'],
    queryFn: () => OperationLogApi.getOverview(),
  });

  const itemsQuery = useQuery({
    queryKey: ['operation-logs', operationLogQuery],
    queryFn: () => OperationLogApi.listItems(operationLogQuery),
  });

  const moduleDictionaryQuery = useQuery({
    queryKey: ['dictionary-runtime', 'common', 'operation-log.module'],
    queryFn: () => DictionaryApi.listRuntimeItems('common', 'operation-log.module'),
  });

  const actionDictionaryQuery = useQuery({
    queryKey: ['dictionary-runtime', 'common', 'operation-log.action'],
    queryFn: () => DictionaryApi.listRuntimeItems('common', 'operation-log.action'),
  });

  const targetTypeDictionaryQuery = useQuery({
    queryKey: ['dictionary-runtime', 'common', 'operation-log.target-type'],
    queryFn: () => DictionaryApi.listRuntimeItems('common', 'operation-log.target-type'),
  });

  useEffect(() => {
    tableState.updateFromPageResult(itemsQuery.data);
  }, [itemsQuery.data, tableState]);

  const moduleItems = moduleDictionaryQuery.data ?? [];
  const actionItems = actionDictionaryQuery.data ?? [];
  const targetTypeItems = targetTypeDictionaryQuery.data ?? [];
  const items = itemsQuery.data?.list ?? [];
  const total = itemsQuery.data?.total ?? 0;
  const totalPages = itemsQuery.data?.totalPages ?? 1;
  const isBusy =
    overviewQuery.isFetching ||
    itemsQuery.isFetching ||
    moduleDictionaryQuery.isFetching ||
    actionDictionaryQuery.isFetching ||
    targetTypeDictionaryQuery.isFetching;

  const pageErrorMessage = useMemo(() => {
    const firstError = [
      overviewQuery.error,
      itemsQuery.error,
      moduleDictionaryQuery.error,
      actionDictionaryQuery.error,
      targetTypeDictionaryQuery.error,
    ].find(Boolean);
    return firstError ? getErrorMessage(firstError, '操作日志加载失败') : null;
  }, [
    actionDictionaryQuery.error,
    itemsQuery.error,
    moduleDictionaryQuery.error,
    overviewQuery.error,
    targetTypeDictionaryQuery.error,
  ]);

  return (
    <div className="page-card">
      <div className="d-flex flex-column gap-3">
        <div className="d-flex flex-column gap-1">
          <h2 className="m-0">操作日志</h2>
          <p className="text-secondary mb-0">查询基础资源中心的变更留痕。</p>
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
          <div className="col-md-3">
            <label className="form-label" htmlFor="operationLogModuleInput">
              模块
            </label>
            <input
              id="operationLogModuleInput"
              className="form-control"
              value={draftFilters.module}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  module: event.target.value,
                }))
              }
              placeholder="如 dictionary"
            />
          </div>
          <div className="col-md-3">
            <label className="form-label" htmlFor="operationLogActionInput">
              动作
            </label>
            <input
              id="operationLogActionInput"
              className="form-control"
              value={draftFilters.action}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  action: event.target.value,
                }))
              }
              placeholder="如 update"
            />
          </div>
          <div className="col-md-3">
            <label className="form-label" htmlFor="operationLogTargetTypeInput">
              目标类型
            </label>
            <input
              id="operationLogTargetTypeInput"
              className="form-control"
              value={draftFilters.targetType}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  targetType: event.target.value,
                }))
              }
              placeholder="如 dictionary-item"
            />
          </div>
          <div className="col-md-3">
            <label className="form-label" htmlFor="operationLogOperatorInput">
              操作人
            </label>
            <input
              id="operationLogOperatorInput"
              className="form-control"
              value={draftFilters.operator}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  operator: event.target.value,
                }))
              }
              placeholder="按操作人筛选"
            />
          </div>
          <div className="col-12 d-flex gap-2">
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
                <SortableColumnHeader
                  label="模块"
                  field="module"
                  sortable
                  sortField={tableState.sortField}
                  sortDirection={tableState.sortDirection}
                  onSort={tableState.toggleSort}
                />
                <th scope="col">动作</th>
                <th scope="col">目标类型</th>
                <th scope="col">目标标识</th>
                <th scope="col">摘要</th>
                <th scope="col">操作人</th>
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
                    <td>{getDictionaryLabel(moduleItems, item.module, item.module || '-')}</td>
                    <td>{getDictionaryLabel(actionItems, item.action, item.action || '-')}</td>
                    <td>
                      {getDictionaryLabel(targetTypeItems, item.targetType, item.targetType || '-')}
                    </td>
                    <td>{item.targetId ?? '-'}</td>
                    <td>
                      <div className="pre-wrap">{item.summary || '-'}</div>
                    </td>
                    <td>{item.operator || '-'}</td>
                    <td>{formatDateTime(item.createdAt)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8}>
                    <div className="text-center py-4 text-secondary">暂无操作日志数据</div>
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
