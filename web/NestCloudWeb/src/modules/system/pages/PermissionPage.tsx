import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DictionaryApi, type DictionaryItem as DictionaryRuntimeItem } from '../api/dictionaryApi';
import { PermissionApi, type PermissionItem, type PermissionSaveInput } from '../api/permissionApi';
import { ModalDialog } from '../components/ModalDialog';
import { PagePagination } from '../components/PagePagination';
import { SortableColumnHeader } from '../components/SortableColumnHeader';
import { usePageTableState } from '../hooks/usePageTableState';
import { useSystemPageFrame } from './SystemPageFrameContext';
import { formatDateTime } from '../utils/formatters';

interface Filters {
  keyword: string;
  groupKey: string;
  isEnabled: string;
}

interface FormState {
  code: string;
  name: string;
  groupKey: string;
  description: string;
  isEnabled: string;
}

interface FeedbackState {
  type: 'success' | 'danger';
  message: string;
}

const defaultFilters: Filters = {
  keyword: '',
  groupKey: '',
  isEnabled: '',
};

const emptyFormState: FormState = {
  code: '',
  name: '',
  groupKey: '',
  description: '',
  isEnabled: 'true',
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

function toFormState(item: PermissionItem): FormState {
  return {
    code: item.code,
    name: item.name,
    groupKey: item.groupKey ?? '',
    description: item.description ?? '',
    isEnabled: item.isEnabled ? 'true' : 'false',
  };
}

export function PermissionPage() {
  const queryClient = useQueryClient();
  const { setFrameState } = useSystemPageFrame();
  const tableState = usePageTableState({ defaultSort: 'groupKey:asc' });

  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [draftFilters, setDraftFilters] = useState<Filters>(defaultFilters);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formState, setFormState] = useState<FormState>(emptyFormState);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const permissionQuery = useMemo(
    () =>
      tableState.buildQuery({
        keyword: filters.keyword || undefined,
        groupKey: filters.groupKey || undefined,
        isEnabled: filters.isEnabled || undefined,
      }),
    [filters, tableState],
  );

  const overviewQuery = useQuery({
    queryKey: ['permission-overview'],
    queryFn: () => PermissionApi.getOverview(),
  });

  const itemsQuery = useQuery({
    queryKey: ['permissions', permissionQuery],
    queryFn: () => PermissionApi.listItems(permissionQuery),
  });

  const enabledDictionaryQuery = useQuery({
    queryKey: ['dictionary-runtime', 'common', 'enabled-state'],
    queryFn: () => DictionaryApi.listRuntimeItems('common', 'enabled-state'),
  });

  const groupDictionaryQuery = useQuery({
    queryKey: ['dictionary-runtime', 'common', 'permission.group'],
    queryFn: () => DictionaryApi.listRuntimeItems('common', 'permission.group'),
  });

  useEffect(() => {
    tableState.updateFromPageResult(itemsQuery.data);
  }, [itemsQuery.data, tableState]);

  const enabledStateItems = enabledDictionaryQuery.data ?? [];
  const groupItems = groupDictionaryQuery.data ?? [];

  const refreshPage = useCallback(async () => {
    setFeedback(null);
    await Promise.all([
      overviewQuery.refetch(),
      itemsQuery.refetch(),
      enabledDictionaryQuery.refetch(),
      groupDictionaryQuery.refetch(),
    ]);
  }, [enabledDictionaryQuery, groupDictionaryQuery, itemsQuery, overviewQuery]);

  useEffect(() => {
    setFrameState((current) => ({
      ...current,
      serviceLabel: `服务：${overviewQuery.data?.service ?? 'system-service'}`,
      capabilityLabel: `能力数：${overviewQuery.data?.capabilities.length ?? '-'}`,
    }));
  }, [overviewQuery.data, setFrameState]);

  const saveMutation = useMutation({
    mutationFn: ({ id, input }: { id?: number | null; input: PermissionSaveInput }) => {
      if (id) {
        return PermissionApi.updateItem(id, input);
      }
      return PermissionApi.createItem(input);
    },
    onSuccess: async () => {
      setModalOpen(false);
      setEditingId(null);
      setFeedback({ type: 'success', message: '权限码保存成功' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['permission-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['permissions'] }),
      ]);
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '权限码保存失败') });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => PermissionApi.deleteItem(id),
    onSuccess: async () => {
      setFeedback({ type: 'success', message: '权限码删除成功' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['permission-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['permissions'] }),
      ]);
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '权限码删除失败') });
    },
  });

  const openCreateModal = useCallback(() => {
    setEditingId(null);
    setFormState(emptyFormState);
    setModalOpen(true);
  }, []);

  const openEditModal = useCallback(async (id: number) => {
    setLoadingDetail(true);
    try {
      const item = await PermissionApi.getItem(id);
      setEditingId(id);
      setFormState(toFormState(item));
      setModalOpen(true);
    } catch (error) {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '权限码详情加载失败') });
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const handleDelete = useCallback(
    async (item: PermissionItem) => {
      if (!window.confirm(`确认删除权限码 ${item.code} 吗？`)) {
        return;
      }
      if (typeof item.id !== 'number') {
        setFeedback({ type: 'danger', message: '权限码缺少 ID，无法删除' });
        return;
      }
      await deleteMutation.mutateAsync(item.id);
    },
    [deleteMutation],
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const code = formState.code.trim();
      const name = formState.name.trim();
      if (!code || !name) {
        setFeedback({ type: 'danger', message: 'Code 和 Name 必填' });
        return;
      }

      const input: PermissionSaveInput = {
        code,
        name,
        groupKey: formState.groupKey.trim() || undefined,
        description: formState.description.trim() || undefined,
        isEnabled: formState.isEnabled === 'true',
      };

      await saveMutation.mutateAsync({
        id: editingId,
        input,
      });
    },
    [editingId, formState, saveMutation],
  );

  const items = itemsQuery.data?.list ?? [];
  const total = itemsQuery.data?.total ?? 0;
  const totalPages = itemsQuery.data?.totalPages ?? 1;
  const isBusy =
    overviewQuery.isFetching ||
    itemsQuery.isFetching ||
    enabledDictionaryQuery.isFetching ||
    groupDictionaryQuery.isFetching ||
    saveMutation.isPending ||
    deleteMutation.isPending ||
    loadingDetail;

  return (
    <div className="page-card">
      <div className="d-flex flex-column gap-3">
        <div className="d-flex flex-column gap-1">
          <h2 className="m-0">权限码管理</h2>
          <p className="text-secondary mb-0">维护权限码、分组标签和启停状态。</p>
        </div>

        {feedback ? (
          <div className={`alert alert-${feedback.type} mb-0`}>{feedback.message}</div>
        ) : null}

        <form
          className="row g-3 align-items-end"
          onSubmit={(event) => {
            event.preventDefault();
            setFeedback(null);
            tableState.setPage(1);
            setFilters(draftFilters);
          }}
        >
          <div className="col-12 col-lg-5">
            <label className="form-label" htmlFor="permissionKeywordInput">
              关键词
            </label>
            <input
              id="permissionKeywordInput"
              className="form-control form-control-sm"
              value={draftFilters.keyword}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  keyword: event.target.value,
                }))
              }
              placeholder="Code / Name / Description"
            />
          </div>
          <div className="col-12 col-sm-6 col-lg-4">
            <label className="form-label" htmlFor="permissionGroupKeyInput">
              分组
            </label>
            <select
              id="permissionGroupKeyInput"
              className="form-select form-select-sm"
              value={draftFilters.groupKey}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  groupKey: event.target.value,
                }))
              }
            >
              <option value="">全部</option>
              {groupItems.map((item) => {
                const value = getDictionaryOptionValue(item);
                return (
                  <option key={value} value={value}>
                    {item.label || item.key}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="col-12 col-sm-6 col-lg-3">
            <label className="form-label" htmlFor="permissionIsEnabledSelect">
              状态
            </label>
            <select
              id="permissionIsEnabledSelect"
              className="form-select form-select-sm"
              value={draftFilters.isEnabled}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  isEnabled: event.target.value,
                }))
              }
            >
              <option value="">全部</option>
              {enabledStateItems.map((item) => {
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
            <button className="btn btn-success btn-sm text-nowrap" type="submit" disabled={isBusy}>
              查询
            </button>
            <button
              className="btn btn-outline-secondary btn-sm text-nowrap"
              type="button"
              onClick={() => {
                setDraftFilters(defaultFilters);
                setFilters(defaultFilters);
                tableState.setPage(1);
              }}
            >
              重置
            </button>
            <button
              className="btn btn-success btn-sm text-nowrap ms-sm-auto"
              type="button"
              onClick={openCreateModal}
            >
              新增
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
                  label="Code"
                  field="code"
                  sortable
                  sortField={tableState.sortField}
                  sortDirection={tableState.sortDirection}
                  onSort={tableState.toggleSort}
                />
                <SortableColumnHeader
                  label="Name"
                  field="name"
                  sortable
                  sortField={tableState.sortField}
                  sortDirection={tableState.sortDirection}
                  onSort={tableState.toggleSort}
                />
                <SortableColumnHeader
                  label="分组"
                  field="groupKey"
                  sortable
                  sortField={tableState.sortField}
                  sortDirection={tableState.sortDirection}
                  onSort={tableState.toggleSort}
                />
                <th scope="col">状态</th>
                <th scope="col">Description</th>
                <SortableColumnHeader
                  label="更新时间"
                  field="updatedAt"
                  sortable
                  sortField={tableState.sortField}
                  sortDirection={tableState.sortDirection}
                  onSort={tableState.toggleSort}
                />
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.length ? (
                items.map((item) => (
                  <tr key={item.code}>
                    <td>{item.id ?? '-'}</td>
                    <td>{item.code}</td>
                    <td>{item.name}</td>
                    <td>{getDictionaryLabel(groupItems, item.groupKey, item.groupKey ?? '-')}</td>
                    <td>
                      <span className={`badge-inline ${item.isEnabled ? 'success' : 'secondary'}`}>
                        {getDictionaryLabel(
                          enabledStateItems,
                          item.isEnabled,
                          item.isEnabled ? '启用' : '停用',
                        )}
                      </span>
                    </td>
                    <td>{item.description || '-'}</td>
                    <td>{formatDateTime(item.updatedAt)}</td>
                    <td>
                      <div className="actions-cell">
                        <button
                          className="btn btn-outline-success btn-sm"
                          type="button"
                          disabled={loadingDetail}
                          onClick={() => {
                            if (typeof item.id === 'number') {
                              void openEditModal(item.id);
                            }
                          }}
                        >
                          编辑
                        </button>
                        <button
                          className="btn btn-outline-danger btn-sm"
                          type="button"
                          disabled={deleteMutation.isPending}
                          onClick={() => {
                            void handleDelete(item);
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8}>
                    <div className="text-center py-4 text-secondary">暂无权限码数据</div>
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

      <ModalDialog
        open={modalOpen}
        title={editingId ? `编辑权限码：${formState.code}` : '新增权限码'}
        onClose={() => {
          if (saveMutation.isPending) {
            return;
          }
          setModalOpen(false);
        }}
        footer={
          <>
            <button
              className="btn btn-outline-secondary"
              type="button"
              disabled={saveMutation.isPending}
              onClick={() => setModalOpen(false)}
            >
              取消
            </button>
            <button
              className="btn btn-success"
              type="submit"
              form="permissionForm"
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? '保存中...' : '保存'}
            </button>
          </>
        }
      >
        <form
          id="permissionForm"
          className="row g-3"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <div className="col-12">
            <label className="form-label" htmlFor="permissionCodeInput">
              Code
            </label>
            <input
              id="permissionCodeInput"
              className="form-control"
              value={formState.code}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  code: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="permissionNameInput">
              Name
            </label>
            <input
              id="permissionNameInput"
              className="form-control"
              value={formState.name}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="permissionGroupKeyFormInput">
              分组
            </label>
            <select
              id="permissionGroupKeyFormInput"
              className="form-select"
              value={formState.groupKey}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  groupKey: event.target.value,
                }))
              }
            >
              <option value="">未分组</option>
              {groupItems.map((item) => {
                const value = getDictionaryOptionValue(item);
                return (
                  <option key={value} value={value}>
                    {item.label || item.key}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="permissionDescriptionInput">
              Description
            </label>
            <textarea
              id="permissionDescriptionInput"
              className="form-control"
              rows={3}
              value={formState.description}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="permissionEnabledInput">
              状态
            </label>
            <select
              id="permissionEnabledInput"
              className="form-select"
              value={formState.isEnabled}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  isEnabled: event.target.value,
                }))
              }
            >
              {enabledStateItems.map((item) => {
                const value = getDictionaryOptionValue(item);
                return (
                  <option key={value} value={value}>
                    {item.label || item.key}
                  </option>
                );
              })}
            </select>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
