import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../../app/state/authStore';
import { AccountApi, type AccountOptionItem } from '../api/accountApi';
import { DictionaryApi, type DictionaryItem as DictionaryRuntimeItem } from '../api/dictionaryApi';
import {
  NotificationApi,
  type AnnouncementItem,
  type AnnouncementSaveInput,
} from '../api/notificationApi';
import { ModalDialog } from '../components/ModalDialog';
import { PagePagination } from '../components/PagePagination';
import { SortableColumnHeader } from '../components/SortableColumnHeader';
import { usePageTableState } from '../hooks/usePageTableState';
import { formatDateTime } from '../utils/formatters';

interface AnnouncementFilters {
  keyword: string;
  isPublished: string;
}

interface MessageFilters {
  receiverAccountId: string;
  isRead: string;
}

interface AnnouncementFormState {
  title: string;
  content: string;
  isPublished: boolean;
  effectiveFrom: string;
  effectiveTo: string;
}

type SendMode = 'account' | 'broadcast';

interface MessageFormState {
  title: string;
  content: string;
  sendMode: SendMode;
  receiverKeyword: string;
  receiverAccountIds: number[];
}

interface FeedbackState {
  type: 'success' | 'danger';
  message: string;
}

const defaultAnnouncementFilters: AnnouncementFilters = {
  keyword: '',
  isPublished: '',
};

const defaultMessageFilters: MessageFilters = {
  receiverAccountId: '',
  isRead: '',
};

const emptyAnnouncementFormState: AnnouncementFormState = {
  title: '',
  content: '',
  isPublished: false,
  effectiveFrom: '',
  effectiveTo: '',
};

const emptyMessageFormState: MessageFormState = {
  title: '',
  content: '',
  sendMode: 'account',
  receiverKeyword: '',
  receiverAccountIds: [],
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

function toDateTimeLocalValue(value?: string | null) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const offset = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toIsoDateTimeOrUndefined(value: string) {
  if (!value.trim()) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}

function formatPeriod(from?: string | null, to?: string | null) {
  return `${formatDateTime(from)} ~ ${formatDateTime(to)}`;
}

function toAnnouncementFormState(item: AnnouncementItem): AnnouncementFormState {
  return {
    title: item.title,
    content: item.content,
    isPublished: item.isPublished,
    effectiveFrom: toDateTimeLocalValue(item.effectiveFrom),
    effectiveTo: toDateTimeLocalValue(item.effectiveTo),
  };
}

function toAnnouncementSaveInput(formState: AnnouncementFormState): AnnouncementSaveInput {
  return {
    title: formState.title.trim(),
    content: formState.content.trim(),
    isPublished: formState.isPublished,
    effectiveFrom: toIsoDateTimeOrUndefined(formState.effectiveFrom),
    effectiveTo: toIsoDateTimeOrUndefined(formState.effectiveTo),
  };
}

function getAccountDisplay(accounts: AccountOptionItem[], accountId?: number | null) {
  if (!accountId) {
    return '-';
  }
  const matched = accounts.find((item) => item.id === accountId);
  if (!matched) {
    return `#${accountId}`;
  }
  return matched.displayName
    ? `${matched.displayName} (${matched.accountName})`
    : matched.accountName;
}

function filterAccounts(accounts: AccountOptionItem[], keyword: string) {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) {
    return accounts;
  }
  return accounts.filter((item) => {
    return (
      item.accountName.toLowerCase().includes(normalizedKeyword) ||
      item.displayName.toLowerCase().includes(normalizedKeyword)
    );
  });
}

function normalizeSendMode(value: string): SendMode {
  return value === 'broadcast' ? 'broadcast' : 'account';
}

export function NotificationPage() {
  const queryClient = useQueryClient();
  const currentAccount = useAuthStore((state) => state.account);
  const announcementTableState = usePageTableState({ defaultSort: 'id:desc' });
  const messageTableState = usePageTableState({ defaultSort: 'id:desc' });

  const [announcementFilters, setAnnouncementFilters] = useState<AnnouncementFilters>(
    defaultAnnouncementFilters,
  );
  const [draftAnnouncementFilters, setDraftAnnouncementFilters] = useState<AnnouncementFilters>(
    defaultAnnouncementFilters,
  );
  const [messageFilters, setMessageFilters] = useState<MessageFilters>(defaultMessageFilters);
  const [draftMessageFilters, setDraftMessageFilters] =
    useState<MessageFilters>(defaultMessageFilters);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const [announcementModalOpen, setAnnouncementModalOpen] = useState(false);
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<number | null>(null);
  const [announcementFormState, setAnnouncementFormState] = useState<AnnouncementFormState>(
    emptyAnnouncementFormState,
  );
  const [loadingAnnouncementDetail, setLoadingAnnouncementDetail] = useState(false);

  const [messageModalOpen, setMessageModalOpen] = useState(false);
  const [messageFormState, setMessageFormState] = useState<MessageFormState>(emptyMessageFormState);

  const announcementQuery = useMemo(
    () =>
      announcementTableState.buildQuery({
        keyword: announcementFilters.keyword.trim() || undefined,
        isPublished: announcementFilters.isPublished || undefined,
      }),
    [announcementFilters, announcementTableState],
  );

  const messageQuery = useMemo(
    () =>
      messageTableState.buildQuery({
        receiverAccountId: messageFilters.receiverAccountId.trim() || undefined,
        isRead: messageFilters.isRead || undefined,
      }),
    [messageFilters, messageTableState],
  );

  const runtimeMessageQuery = useMemo(
    () => ({
      isRead: messageFilters.isRead || undefined,
    }),
    [messageFilters.isRead],
  );

  const overviewQuery = useQuery({
    queryKey: ['notification-overview'],
    queryFn: () => NotificationApi.getOverview(),
  });

  const announcementsQuery = useQuery({
    queryKey: ['notification-announcements', announcementQuery],
    queryFn: () => NotificationApi.listAnnouncements(announcementQuery),
  });

  const messagesQuery = useQuery({
    queryKey: ['notification-station-messages', messageQuery],
    queryFn: () => NotificationApi.listMessages(messageQuery),
  });

  const runtimeAnnouncementsQuery = useQuery({
    queryKey: ['notification-runtime-announcements'],
    queryFn: () => NotificationApi.listRuntimeAnnouncements(),
  });

  const runtimeMessagesQuery = useQuery({
    queryKey: ['notification-runtime-messages', runtimeMessageQuery],
    queryFn: () => NotificationApi.listRuntimeMessages(runtimeMessageQuery),
  });

  const unreadCountQuery = useQuery({
    queryKey: ['notification-unread-count'],
    queryFn: () => NotificationApi.getUnreadCount(),
  });

  const publishStateQuery = useQuery({
    queryKey: ['dictionary-runtime', 'common', 'notification.publish-state'],
    queryFn: () => DictionaryApi.listRuntimeItems('common', 'notification.publish-state'),
  });

  const readStateQuery = useQuery({
    queryKey: ['dictionary-runtime', 'common', 'notification.read-state'],
    queryFn: () => DictionaryApi.listRuntimeItems('common', 'notification.read-state'),
  });

  const sendModeQuery = useQuery({
    queryKey: ['dictionary-runtime', 'common', 'notification.send-mode'],
    queryFn: () => DictionaryApi.listRuntimeItems('common', 'notification.send-mode'),
  });

  const accountsQuery = useQuery({
    queryKey: ['notification-enabled-accounts'],
    queryFn: () => AccountApi.listOptions(),
  });

  useEffect(() => {
    announcementTableState.updateFromPageResult(announcementsQuery.data);
  }, [announcementTableState, announcementsQuery.data]);

  useEffect(() => {
    messageTableState.updateFromPageResult(messagesQuery.data);
  }, [messageTableState, messagesQuery.data]);

  const refreshRuntime = useCallback(async () => {
    setFeedback(null);
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ['notification-runtime-announcements'] }),
      queryClient.refetchQueries({ queryKey: ['notification-runtime-messages'] }),
      queryClient.refetchQueries({ queryKey: ['notification-unread-count'] }),
    ]);
  }, [queryClient]);

  const openCreateAnnouncementModal = useCallback(() => {
    setEditingAnnouncementId(null);
    setAnnouncementFormState(emptyAnnouncementFormState);
    setAnnouncementModalOpen(true);
  }, []);

  const openSendMessageModal = useCallback(() => {
    setMessageFormState(emptyMessageFormState);
    setMessageModalOpen(true);
    void queryClient.refetchQueries({ queryKey: ['notification-enabled-accounts'] });
  }, [queryClient]);

  const saveAnnouncementMutation = useMutation({
    mutationFn: ({ id, input }: { id?: number | null; input: AnnouncementSaveInput }) => {
      if (id) {
        return NotificationApi.updateAnnouncement(id, input);
      }
      return NotificationApi.createAnnouncement(input);
    },
    onSuccess: async () => {
      setAnnouncementModalOpen(false);
      setEditingAnnouncementId(null);
      setFeedback({ type: 'success', message: '公告保存成功' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['notification-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['notification-announcements'] }),
        queryClient.invalidateQueries({ queryKey: ['notification-runtime-announcements'] }),
      ]);
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '公告保存失败') });
    },
  });

  const deleteAnnouncementMutation = useMutation({
    mutationFn: (id: number) => NotificationApi.deleteAnnouncement(id),
    onSuccess: async () => {
      setFeedback({ type: 'success', message: '公告删除成功' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['notification-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['notification-announcements'] }),
        queryClient.invalidateQueries({ queryKey: ['notification-runtime-announcements'] }),
      ]);
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '公告删除失败') });
    },
  });

  const sendMessagesMutation = useMutation({
    mutationFn: (input: {
      title: string;
      content: string;
      isBroadcast: boolean;
      receiverAccountIds?: number[];
    }) => {
      return NotificationApi.sendMessages(input);
    },
    onSuccess: async () => {
      setMessageModalOpen(false);
      setFeedback({ type: 'success', message: '站内信发送成功' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['notification-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['notification-station-messages'] }),
        queryClient.invalidateQueries({ queryKey: ['notification-runtime-messages'] }),
        queryClient.invalidateQueries({ queryKey: ['notification-unread-count'] }),
      ]);
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '站内信发送失败') });
    },
  });

  const markMessageReadMutation = useMutation({
    mutationFn: (id: number) => NotificationApi.markMessageRead(id),
    onSuccess: async () => {
      setFeedback({ type: 'success', message: '站内信已标记为已读' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['notification-station-messages'] }),
        queryClient.invalidateQueries({ queryKey: ['notification-runtime-messages'] }),
        queryClient.invalidateQueries({ queryKey: ['notification-unread-count'] }),
      ]);
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '站内信已读状态更新失败') });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => NotificationApi.markAllRead(),
    onSuccess: async (result) => {
      setFeedback({ type: 'success', message: `已处理 ${result.updatedCount} 条站内信` });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['notification-station-messages'] }),
        queryClient.invalidateQueries({ queryKey: ['notification-runtime-messages'] }),
        queryClient.invalidateQueries({ queryKey: ['notification-unread-count'] }),
      ]);
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '批量已读失败') });
    },
  });

  const openEditAnnouncementModal = useCallback(async (id: number) => {
    setLoadingAnnouncementDetail(true);
    try {
      const item = await NotificationApi.getAnnouncement(id);
      setEditingAnnouncementId(id);
      setAnnouncementFormState(toAnnouncementFormState(item));
      setAnnouncementModalOpen(true);
    } catch (error) {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '公告详情加载失败') });
    } finally {
      setLoadingAnnouncementDetail(false);
    }
  }, []);

  const handleDeleteAnnouncement = useCallback(
    (item: AnnouncementItem) => {
      if (!window.confirm(`确认删除公告 #${item.id} 吗？`)) {
        return;
      }
      setFeedback(null);
      deleteAnnouncementMutation.mutate(item.id);
    },
    [deleteAnnouncementMutation],
  );

  const publishStateItems = publishStateQuery.data ?? [];
  const readStateItems = readStateQuery.data ?? [];
  const sendModeItems = sendModeQuery.data ?? [];
  const enabledAccounts = accountsQuery.data ?? [];
  const filteredAccounts = useMemo(
    () => filterAccounts(enabledAccounts, messageFormState.receiverKeyword),
    [enabledAccounts, messageFormState.receiverKeyword],
  );

  const announcements = announcementsQuery.data?.list ?? [];
  const announcementTotal = announcementsQuery.data?.total ?? 0;
  const announcementTotalPages = announcementsQuery.data?.totalPages ?? 1;
  const messages = messagesQuery.data?.list ?? [];
  const messageTotal = messagesQuery.data?.total ?? 0;
  const messageTotalPages = messagesQuery.data?.totalPages ?? 1;
  const runtimeAnnouncements = runtimeAnnouncementsQuery.data ?? [];
  const runtimeMessages = runtimeMessagesQuery.data ?? [];
  const currentAccountLabel =
    currentAccount?.displayName || currentAccount?.accountName || '当前登录账号';

  const pageErrorMessage = useMemo(() => {
    const firstError = [
      overviewQuery.error,
      announcementsQuery.error,
      messagesQuery.error,
      runtimeAnnouncementsQuery.error,
      runtimeMessagesQuery.error,
      unreadCountQuery.error,
      publishStateQuery.error,
      readStateQuery.error,
      sendModeQuery.error,
    ].find(Boolean);
    return firstError ? getErrorMessage(firstError, '通知公告数据加载失败') : null;
  }, [
    announcementsQuery.error,
    messagesQuery.error,
    overviewQuery.error,
    publishStateQuery.error,
    readStateQuery.error,
    runtimeAnnouncementsQuery.error,
    runtimeMessagesQuery.error,
    sendModeQuery.error,
    unreadCountQuery.error,
  ]);

  return (
    <>
      <div className="d-flex flex-column gap-3">
        <div className="d-flex flex-column gap-1">
          <h2 className="m-0">通知公告</h2>
          <p className="text-secondary mb-0">
            管理公告发布、站内信发送与当前登录账号的运行态消息。公告{' '}
            {overviewQuery.data?.announcementCount ?? '-'} 条，站内信{' '}
            {overviewQuery.data?.messageCount ?? '-'} 条。
          </p>
        </div>

        {pageErrorMessage ? (
          <div className="alert alert-danger mb-0">{pageErrorMessage}</div>
        ) : null}
        {feedback ? (
          <div className={`alert alert-${feedback.type} mb-0`}>{feedback.message}</div>
        ) : null}

        <div className="page-card mt-0">
          <div className="page-card-header">
            <div>
              <h3 className="page-card-title">公告列表</h3>
              <div className="page-card-desc">维护发布状态、生效期与公告内容。</div>
            </div>
          </div>

          <form
            className="row g-3 align-items-end"
            onSubmit={(event) => {
              event.preventDefault();
              announcementTableState.setPage(1);
              setAnnouncementFilters(draftAnnouncementFilters);
            }}
          >
            <div className="col-md-4">
              <label className="form-label" htmlFor="notificationAnnouncementKeywordInput">
                关键词
              </label>
              <input
                id="notificationAnnouncementKeywordInput"
                className="form-control"
                value={draftAnnouncementFilters.keyword}
                onChange={(event) =>
                  setDraftAnnouncementFilters((current) => ({
                    ...current,
                    keyword: event.target.value,
                  }))
                }
                placeholder="标题 / 内容"
              />
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="notificationAnnouncementPublishedSelect">
                发布状态
              </label>
              <select
                id="notificationAnnouncementPublishedSelect"
                className="form-select"
                value={draftAnnouncementFilters.isPublished}
                onChange={(event) =>
                  setDraftAnnouncementFilters((current) => ({
                    ...current,
                    isPublished: event.target.value,
                  }))
                }
              >
                <option value="">全部</option>
                {publishStateItems.map((item) => {
                  const value = getDictionaryOptionValue(item);
                  return (
                    <option key={value} value={value}>
                      {item.label || item.key}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="col-12 d-flex flex-wrap gap-2">
              <button
                className="btn btn-success"
                type="submit"
                disabled={announcementsQuery.isFetching}
              >
                查询
              </button>
              <button
                className="btn btn-outline-secondary"
                type="button"
                onClick={() => {
                  setDraftAnnouncementFilters(defaultAnnouncementFilters);
                  setAnnouncementFilters(defaultAnnouncementFilters);
                  announcementTableState.setPage(1);
                }}
              >
                重置
              </button>
              <button
                className="btn btn-outline-primary"
                type="button"
                onClick={openCreateAnnouncementModal}
              >
                新增公告
              </button>
            </div>
          </form>

          <div className="table-responsive mt-3">
            <table className="table align-middle">
              <thead>
                <tr>
                  <SortableColumnHeader
                    label="ID"
                    field="id"
                    sortable
                    sortField={announcementTableState.sortField}
                    sortDirection={announcementTableState.sortDirection}
                    onSort={announcementTableState.toggleSort}
                  />
                  <th scope="col">标题</th>
                  <th scope="col">状态</th>
                  <SortableColumnHeader
                    label="生效时间"
                    field="effectiveFrom"
                    sortable
                    sortField={announcementTableState.sortField}
                    sortDirection={announcementTableState.sortDirection}
                    onSort={announcementTableState.toggleSort}
                  />
                  <th scope="col">发布人</th>
                  <SortableColumnHeader
                    label="发布时间"
                    field="publishedAt"
                    sortable
                    sortField={announcementTableState.sortField}
                    sortDirection={announcementTableState.sortDirection}
                    onSort={announcementTableState.toggleSort}
                  />
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {announcements.length ? (
                  announcements.map((item) => (
                    <tr key={item.id}>
                      <td>{item.id}</td>
                      <td>
                        <div>{item.title}</div>
                        <div className="table-subtext">{item.content}</div>
                      </td>
                      <td>
                        <span
                          className={`badge-inline ${item.isPublished ? 'success' : 'secondary'}`}
                        >
                          {getDictionaryLabel(
                            publishStateItems,
                            item.isPublished,
                            item.isPublished ? '已发布' : '未发布',
                          )}
                        </span>
                      </td>
                      <td>{formatPeriod(item.effectiveFrom, item.effectiveTo)}</td>
                      <td>{item.publisherAccountId ? `#${item.publisherAccountId}` : '-'}</td>
                      <td>
                        <div>{formatDateTime(item.publishedAt)}</div>
                        <div className="table-subtext">撤回：{formatDateTime(item.revokedAt)}</div>
                      </td>
                      <td>
                        <div className="actions-cell">
                          <button
                            className="btn btn-outline-success btn-sm"
                            type="button"
                            disabled={loadingAnnouncementDetail}
                            onClick={() => {
                              void openEditAnnouncementModal(item.id);
                            }}
                          >
                            编辑
                          </button>
                          <button
                            className="btn btn-outline-danger btn-sm"
                            type="button"
                            disabled={deleteAnnouncementMutation.isPending}
                            onClick={() => handleDeleteAnnouncement(item)}
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7}>
                      <div className="text-center py-4 text-secondary">暂无公告数据</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <PagePagination
            page={announcementTableState.page}
            pageSize={announcementTableState.pageSize}
            total={announcementTotal}
            totalPages={announcementTotalPages}
            onPageChange={announcementTableState.setPage}
            onPageSizeChange={(nextPageSize) => {
              announcementTableState.setPage(1);
              announcementTableState.setPageSize(nextPageSize);
            }}
          />
        </div>

        <div className="page-card mt-0">
          <div className="page-card-header">
            <div>
              <h3 className="page-card-title">站内信列表</h3>
              <div className="page-card-desc">
                按接收账号筛选消息记录；已读操作只对当前登录账号生效。
              </div>
            </div>
          </div>

          <form
            className="row g-3 align-items-end"
            onSubmit={(event) => {
              event.preventDefault();
              messageTableState.setPage(1);
              setMessageFilters(draftMessageFilters);
            }}
          >
            <div className="col-md-3">
              <label className="form-label" htmlFor="notificationMessageReceiverAccountIdInput">
                接收账号 ID
              </label>
              <input
                id="notificationMessageReceiverAccountIdInput"
                className="form-control"
                type="number"
                min={1}
                value={draftMessageFilters.receiverAccountId}
                onChange={(event) =>
                  setDraftMessageFilters((current) => ({
                    ...current,
                    receiverAccountId: event.target.value,
                  }))
                }
                placeholder="如 1"
              />
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="notificationMessageIsReadSelect">
                已读状态
              </label>
              <select
                id="notificationMessageIsReadSelect"
                className="form-select"
                value={draftMessageFilters.isRead}
                onChange={(event) =>
                  setDraftMessageFilters((current) => ({
                    ...current,
                    isRead: event.target.value,
                  }))
                }
              >
                <option value="">全部</option>
                {readStateItems.map((item) => {
                  const value = getDictionaryOptionValue(item);
                  return (
                    <option key={value} value={value}>
                      {item.label || item.key}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="col-12 d-flex flex-wrap gap-2">
              <button className="btn btn-success" type="submit" disabled={messagesQuery.isFetching}>
                查询
              </button>
              <button
                className="btn btn-outline-secondary"
                type="button"
                onClick={() => {
                  setDraftMessageFilters(defaultMessageFilters);
                  setMessageFilters(defaultMessageFilters);
                  messageTableState.setPage(1);
                }}
              >
                重置
              </button>
              <button
                className="btn btn-outline-primary"
                type="button"
                onClick={openSendMessageModal}
              >
                发送站内信
              </button>
            </div>
          </form>

          <div className="table-responsive mt-3">
            <table className="table align-middle">
              <thead>
                <tr>
                  <SortableColumnHeader
                    label="ID"
                    field="id"
                    sortable
                    sortField={messageTableState.sortField}
                    sortDirection={messageTableState.sortDirection}
                    onSort={messageTableState.toggleSort}
                  />
                  <th scope="col">标题</th>
                  <th scope="col">接收账号</th>
                  <th scope="col">发送人</th>
                  <th scope="col">状态</th>
                  <SortableColumnHeader
                    label="发送时间"
                    field="createdAt"
                    sortable
                    sortField={messageTableState.sortField}
                    sortDirection={messageTableState.sortDirection}
                    onSort={messageTableState.toggleSort}
                  />
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {messages.length ? (
                  messages.map((item) => {
                    const canMarkRead =
                      !item.isRead && currentAccount?.accountId === item.receiverAccountId;
                    return (
                      <tr key={item.id}>
                        <td>{item.id}</td>
                        <td>
                          <div>{item.title}</div>
                          <div className="table-subtext">{item.content}</div>
                        </td>
                        <td>{getAccountDisplay(enabledAccounts, item.receiverAccountId)}</td>
                        <td>{getAccountDisplay(enabledAccounts, item.senderAccountId)}</td>
                        <td>
                          <span className={`badge-inline ${item.isRead ? 'secondary' : 'success'}`}>
                            {getDictionaryLabel(
                              readStateItems,
                              item.isRead,
                              item.isRead ? '已读' : '未读',
                            )}
                          </span>
                          <div className="table-subtext">
                            读取时间：{formatDateTime(item.readAt)}
                          </div>
                        </td>
                        <td>{formatDateTime(item.createdAt)}</td>
                        <td>
                          <div className="actions-cell">
                            {item.isRead ? (
                              <span className="table-subtext">已处理</span>
                            ) : canMarkRead ? (
                              <button
                                className="btn btn-outline-primary btn-sm"
                                type="button"
                                disabled={markMessageReadMutation.isPending}
                                onClick={() => {
                                  markMessageReadMutation.mutate(item.id);
                                }}
                              >
                                标记已读
                              </button>
                            ) : (
                              <span className="table-subtext">仅接收人可标记</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7}>
                      <div className="text-center py-4 text-secondary">暂无站内信数据</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <PagePagination
            page={messageTableState.page}
            pageSize={messageTableState.pageSize}
            total={messageTotal}
            totalPages={messageTotalPages}
            onPageChange={messageTableState.setPage}
            onPageSizeChange={(nextPageSize) => {
              messageTableState.setPage(1);
              messageTableState.setPageSize(nextPageSize);
            }}
          />
        </div>

        <div className="page-card mt-0">
          <div className="page-card-header">
            <div>
              <h3 className="page-card-title">运行态预览</h3>
              <div className="page-card-desc">
                公告运行态展示生效中的公告；站内信运行态与未读数只按当前登录账号返回。
              </div>
            </div>
            <div className="d-flex flex-wrap gap-2">
              <button
                className="btn btn-outline-primary btn-sm"
                type="button"
                disabled={runtimeAnnouncementsQuery.isFetching || runtimeMessagesQuery.isFetching}
                onClick={() => {
                  void refreshRuntime();
                }}
              >
                刷新运行态
              </button>
              <button
                className="btn btn-outline-secondary btn-sm"
                type="button"
                disabled={unreadCountQuery.isFetching}
                onClick={() => {
                  void unreadCountQuery.refetch();
                }}
              >
                刷新未读数
              </button>
              <button
                className="btn btn-success btn-sm"
                type="button"
                disabled={markAllReadMutation.isPending}
                onClick={() => {
                  if (
                    !window.confirm(`确认将 ${currentAccountLabel} 的未读站内信全部标记为已读吗？`)
                  ) {
                    return;
                  }
                  setFeedback(null);
                  markAllReadMutation.mutate();
                }}
              >
                全部已读
              </button>
            </div>
          </div>

          <div className="summary-panel mb-3">
            <div className="summary-panel-title">当前登录账号</div>
            <div className="summary-panel-desc">{currentAccountLabel}</div>
            <div className="table-subtext">未读数：{unreadCountQuery.data ?? 0}</div>
          </div>

          <div className="row g-3">
            <div className="col-lg-6">
              <div className="summary-panel">
                <div className="summary-panel-title">运行态公告</div>
                <div className="summary-panel-desc">只显示已发布、未撤回且在生效期内的公告。</div>
              </div>
              <div className="d-flex flex-column gap-2 mt-3">
                {runtimeAnnouncements.length ? (
                  runtimeAnnouncements.map((item) => (
                    <div key={item.id} className="summary-panel">
                      <div className="summary-panel-title">{item.title}</div>
                      <div className="summary-panel-desc">{item.content}</div>
                      <div className="table-subtext">
                        生效：{formatPeriod(item.effectiveFrom, item.effectiveTo)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-secondary">当前没有运行中的公告。</div>
                )}
              </div>
            </div>
            <div className="col-lg-6">
              <div className="summary-panel">
                <div className="summary-panel-title">站内信运行态</div>
                <div className="summary-panel-desc">
                  按当前登录账号展示消息列表，并可按已读状态筛选。
                </div>
              </div>
              <div className="d-flex flex-column gap-2 mt-3">
                {runtimeMessages.length ? (
                  runtimeMessages.map((item) => (
                    <div key={item.id} className="summary-panel">
                      <div className="summary-panel-title">{item.title}</div>
                      <div className="summary-panel-desc">{item.content}</div>
                      <div className="table-subtext">
                        状态：
                        {getDictionaryLabel(
                          readStateItems,
                          item.isRead,
                          item.isRead ? '已读' : '未读',
                        )}
                        ，发送时间：
                        {formatDateTime(item.createdAt)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-secondary">当前登录账号没有符合条件的运行态站内信。</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <ModalDialog
        open={announcementModalOpen}
        title={editingAnnouncementId ? `编辑公告：${announcementFormState.title}` : '新增公告'}
        size="lg"
        onClose={() => {
          if (saveAnnouncementMutation.isPending) {
            return;
          }
          setAnnouncementModalOpen(false);
          setEditingAnnouncementId(null);
        }}
        footer={
          <>
            <button
              className="btn btn-outline-secondary"
              type="button"
              onClick={() => {
                setAnnouncementModalOpen(false);
                setEditingAnnouncementId(null);
              }}
              disabled={saveAnnouncementMutation.isPending}
            >
              取消
            </button>
            <button
              className="btn btn-success"
              type="button"
              disabled={saveAnnouncementMutation.isPending || loadingAnnouncementDetail}
              onClick={() => {
                if (!announcementFormState.title.trim() || !announcementFormState.content.trim()) {
                  setFeedback({ type: 'danger', message: '公告标题和内容必填' });
                  return;
                }
                setFeedback(null);
                saveAnnouncementMutation.mutate({
                  id: editingAnnouncementId,
                  input: toAnnouncementSaveInput(announcementFormState),
                });
              }}
            >
              {saveAnnouncementMutation.isPending ? '保存中...' : '保存'}
            </button>
          </>
        }
      >
        <div className="row g-3">
          <div className="col-12">
            <label className="form-label" htmlFor="notificationAnnouncementTitleInput">
              标题
            </label>
            <input
              id="notificationAnnouncementTitleInput"
              className="form-control"
              value={announcementFormState.title}
              onChange={(event) =>
                setAnnouncementFormState((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              maxLength={128}
            />
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="notificationAnnouncementContentInput">
              内容
            </label>
            <textarea
              id="notificationAnnouncementContentInput"
              className="form-control"
              rows={4}
              value={announcementFormState.content}
              onChange={(event) =>
                setAnnouncementFormState((current) => ({
                  ...current,
                  content: event.target.value,
                }))
              }
              maxLength={2000}
            />
          </div>
          <div className="col-md-4">
            <label className="form-label" htmlFor="notificationAnnouncementPublishedInput">
              发布状态
            </label>
            <select
              id="notificationAnnouncementPublishedInput"
              className="form-select"
              value={String(announcementFormState.isPublished)}
              onChange={(event) =>
                setAnnouncementFormState((current) => ({
                  ...current,
                  isPublished: event.target.value === 'true',
                }))
              }
            >
              <option value="false">
                {getDictionaryLabel(publishStateItems, false, '未发布')}
              </option>
              <option value="true">{getDictionaryLabel(publishStateItems, true, '已发布')}</option>
            </select>
          </div>
          <div className="col-md-4">
            <label className="form-label" htmlFor="notificationAnnouncementEffectiveFromInput">
              生效开始
            </label>
            <input
              id="notificationAnnouncementEffectiveFromInput"
              className="form-control"
              type="datetime-local"
              value={announcementFormState.effectiveFrom}
              onChange={(event) =>
                setAnnouncementFormState((current) => ({
                  ...current,
                  effectiveFrom: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-md-4">
            <label className="form-label" htmlFor="notificationAnnouncementEffectiveToInput">
              生效结束
            </label>
            <input
              id="notificationAnnouncementEffectiveToInput"
              className="form-control"
              type="datetime-local"
              value={announcementFormState.effectiveTo}
              onChange={(event) =>
                setAnnouncementFormState((current) => ({
                  ...current,
                  effectiveTo: event.target.value,
                }))
              }
            />
          </div>
        </div>
      </ModalDialog>

      <ModalDialog
        open={messageModalOpen}
        title="发送站内信"
        size="xl"
        onClose={() => {
          if (sendMessagesMutation.isPending) {
            return;
          }
          setMessageModalOpen(false);
        }}
        footer={
          <>
            <button
              className="btn btn-outline-secondary"
              type="button"
              onClick={() => {
                setMessageModalOpen(false);
              }}
              disabled={sendMessagesMutation.isPending}
            >
              取消
            </button>
            <button
              className="btn btn-success"
              type="button"
              disabled={sendMessagesMutation.isPending || accountsQuery.isFetching}
              onClick={() => {
                if (!messageFormState.title.trim() || !messageFormState.content.trim()) {
                  setFeedback({ type: 'danger', message: '站内信标题和内容必填' });
                  return;
                }
                if (
                  messageFormState.sendMode === 'account' &&
                  !messageFormState.receiverAccountIds.length
                ) {
                  setFeedback({ type: 'danger', message: '请至少选择一个接收账号' });
                  return;
                }
                setFeedback(null);
                sendMessagesMutation.mutate({
                  title: messageFormState.title.trim(),
                  content: messageFormState.content.trim(),
                  isBroadcast: messageFormState.sendMode === 'broadcast',
                  receiverAccountIds:
                    messageFormState.sendMode === 'broadcast'
                      ? undefined
                      : messageFormState.receiverAccountIds,
                });
              }}
            >
              {sendMessagesMutation.isPending ? '发送中...' : '发送'}
            </button>
          </>
        }
      >
        <div className="row g-3">
          <div className="col-md-6">
            <label className="form-label" htmlFor="notificationMessageTitleInput">
              标题
            </label>
            <input
              id="notificationMessageTitleInput"
              className="form-control"
              value={messageFormState.title}
              onChange={(event) =>
                setMessageFormState((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              maxLength={128}
            />
          </div>
          <div className="col-md-6">
            <label className="form-label" htmlFor="notificationMessageSendModeSelect">
              发送模式
            </label>
            <select
              id="notificationMessageSendModeSelect"
              className="form-select"
              value={messageFormState.sendMode}
              onChange={(event) =>
                setMessageFormState((current) => ({
                  ...current,
                  sendMode: normalizeSendMode(event.target.value),
                  receiverAccountIds:
                    normalizeSendMode(event.target.value) === 'broadcast'
                      ? []
                      : current.receiverAccountIds,
                }))
              }
            >
              {sendModeItems.length ? (
                sendModeItems.map((item) => {
                  const value = getDictionaryOptionValue(item);
                  return (
                    <option key={value} value={value}>
                      {item.label || item.key}
                    </option>
                  );
                })
              ) : (
                <>
                  <option value="account">指定账号</option>
                  <option value="broadcast">广播</option>
                </>
              )}
            </select>
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="notificationMessageContentInput">
              内容
            </label>
            <textarea
              id="notificationMessageContentInput"
              className="form-control"
              rows={4}
              value={messageFormState.content}
              onChange={(event) =>
                setMessageFormState((current) => ({
                  ...current,
                  content: event.target.value,
                }))
              }
              maxLength={2000}
            />
          </div>
          <div className="col-md-4">
            <label className="form-label" htmlFor="notificationMessageReceiverKeywordInput">
              接收账号筛选
            </label>
            <input
              id="notificationMessageReceiverKeywordInput"
              className="form-control"
              value={messageFormState.receiverKeyword}
              onChange={(event) =>
                setMessageFormState((current) => ({
                  ...current,
                  receiverKeyword: event.target.value,
                }))
              }
              placeholder="账号名 / 显示名"
              disabled={messageFormState.sendMode === 'broadcast'}
            />
          </div>
          <div className="col-md-8">
            <label className="form-label" htmlFor="notificationMessageReceiverSelect">
              接收账号
            </label>
            <select
              id="notificationMessageReceiverSelect"
              className="form-select"
              multiple
              size={8}
              value={messageFormState.receiverAccountIds.map(String)}
              onChange={(event) => {
                const values = Array.from(event.target.selectedOptions)
                  .map((option) => Number(option.value))
                  .filter((value) => Number.isFinite(value) && value > 0);
                setMessageFormState((current) => ({
                  ...current,
                  receiverAccountIds: values,
                }));
              }}
              disabled={messageFormState.sendMode === 'broadcast' || accountsQuery.isFetching}
            >
              {filteredAccounts.length ? (
                filteredAccounts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} ({item.accountName})
                  </option>
                ))
              ) : (
                <option value="">暂无可选账号</option>
              )}
            </select>
            <div className="form-text" id="notificationMessageReceiverHint">
              {messageFormState.sendMode === 'broadcast'
                ? `广播模式会向当前 ${enabledAccounts.length} 个启用账号发送站内信。`
                : `当前可选 ${filteredAccounts.length} 个启用账号，已选 ${messageFormState.receiverAccountIds.length} 个。`}
            </div>
            {accountsQuery.error ? (
              <div className="text-danger mt-2">
                {getErrorMessage(accountsQuery.error, '接收账号列表加载失败')}
              </div>
            ) : null}
          </div>
        </div>
      </ModalDialog>
    </>
  );
}
