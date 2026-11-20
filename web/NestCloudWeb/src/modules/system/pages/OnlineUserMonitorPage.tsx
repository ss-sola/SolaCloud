import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MonitorApi, type OnlineUserItem } from '../api/monitorApi';
import { PagePagination } from '../components/PagePagination';
import { usePageTableState } from '../hooks/usePageTableState';
import { formatDateTime } from '../utils/formatters';

interface Filters {
  keyword: string;
}

interface FeedbackState {
  type: 'success' | 'danger';
  message: string;
}

const defaultFilters: Filters = {
  keyword: '',
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function getAvatarLabel(item: Pick<OnlineUserItem, 'displayName' | 'accountName'>) {
  return item.displayName || item.accountName || '-';
}

function renderAvatar(item: OnlineUserItem) {
  const label = getAvatarLabel(item);
  if (item.avatarUrl) {
    return <img className="account-avatar" src={item.avatarUrl} alt={label} />;
  }
  return <span className="avatar-fallback">{label.slice(0, 1)}</span>;
}

export function OnlineUserMonitorPage() {
  const queryClient = useQueryClient();
  const tableState = usePageTableState({ defaultSort: 'lastActiveAt:desc' });

  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [draftFilters, setDraftFilters] = useState<Filters>(defaultFilters);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const onlineUserQuery = useMemo(
    () =>
      tableState.buildQuery({
        keyword: filters.keyword.trim() || undefined,
      }),
    [filters, tableState],
  );

  const overviewQuery = useQuery({
    queryKey: ['monitor-overview'],
    queryFn: () => MonitorApi.getOverview(),
  });

  const itemsQuery = useQuery({
    queryKey: ['online-users', onlineUserQuery],
    queryFn: () => MonitorApi.listOnlineUsers(onlineUserQuery),
  });

  useEffect(() => {
    tableState.updateFromPageResult(itemsQuery.data);
  }, [itemsQuery.data, tableState]);

  const kickMutation = useMutation({
    mutationFn: (sessionId: string) => MonitorApi.kickOnlineUser({ sessionId }),
    onSuccess: async () => {
      setFeedback({ type: 'success', message: '已踢下线' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['monitor-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['online-users'] }),
      ]);
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '踢人下线失败') });
    },
  });

  const items = itemsQuery.data?.list ?? [];
  const total = itemsQuery.data?.total ?? 0;
  const totalPages = itemsQuery.data?.totalPages ?? 1;
  const isBusy = overviewQuery.isFetching || itemsQuery.isFetching;

  const pageErrorMessage = useMemo(() => {
    const firstError = [overviewQuery.error, itemsQuery.error].find(Boolean);
    return firstError ? getErrorMessage(firstError, '在线用户监控加载失败') : null;
  }, [itemsQuery.error, overviewQuery.error]);

  const handleKick = useCallback(
    (item: OnlineUserItem) => {
      const label = getAvatarLabel(item);
      if (!window.confirm(`确认将 ${label} 踢下线？`)) {
        return;
      }
      setFeedback(null);
      kickMutation.mutate(item.sessionId);
    },
    [kickMutation],
  );

  return (
    <div className="page-card">
      <div className="d-flex flex-column gap-3">
        <div className="d-flex flex-column gap-1">
          <h2 className="m-0">在线用户监控</h2>
          <p className="text-secondary mb-0">查看当前实例在线会话、登录时间和最近活跃情况。</p>
        </div>

        {pageErrorMessage ? (
          <div className="alert alert-danger mb-0">{pageErrorMessage}</div>
        ) : null}
        {feedback ? (
          <div className={`alert alert-${feedback.type} mb-0`}>{feedback.message}</div>
        ) : null}

        <form
          className="row g-3 align-items-end"
          onSubmit={(event) => {
            event.preventDefault();
            tableState.setPage(1);
            setFilters(draftFilters);
          }}
        >
          <div className="col-md-6">
            <label className="form-label" htmlFor="onlineUserMonitorKeywordInput">
              关键词
            </label>
            <input
              id="onlineUserMonitorKeywordInput"
              className="form-control"
              value={draftFilters.keyword}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  keyword: event.target.value,
                }))
              }
              placeholder="账号名 / 显示名 / IP / User-Agent"
            />
          </div>
          <div className="col-md-6 d-flex gap-2">
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
                <th scope="col">账号</th>
                <th scope="col">IP</th>
                <th scope="col">登录时间</th>
                <th scope="col">最近活跃</th>
                <th scope="col">过期时间</th>
                <th scope="col">User-Agent</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.length ? (
                items.map((item) => {
                  const label = getAvatarLabel(item);
                  return (
                    <tr key={item.sessionId}>
                      <td>
                        <div className="account-cell">
                          {renderAvatar(item)}
                          <div>
                            <div>{label}</div>
                            <div className="table-subtext">{item.accountName}</div>
                          </div>
                        </div>
                      </td>
                      <td>{item.ip || '-'}</td>
                      <td>{formatDateTime(item.loginAt)}</td>
                      <td>{formatDateTime(item.lastActiveAt)}</td>
                      <td>{formatDateTime(item.expiresAt)}</td>
                      <td>
                        <div className="pre-wrap monitor-user-agent">{item.userAgent || '-'}</div>
                      </td>
                      <td>
                        <div className="actions-cell">
                          <button
                            className="btn btn-outline-danger btn-sm"
                            type="button"
                            disabled={kickMutation.isPending}
                            onClick={() => handleKick(item)}
                          >
                            踢人下线
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7}>
                    <div className="text-center py-4 text-secondary">暂无在线用户数据</div>
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
