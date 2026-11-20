import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DictionaryApi,
  type DictionaryNamespaceItem,
  type DictionaryNamespaceSaveInput,
} from '../api/dictionaryApi';
import { ModalDialog } from '../components/ModalDialog';
import { PagePagination } from '../components/PagePagination';
import { SortableColumnHeader } from '../components/SortableColumnHeader';
import { usePageTableState } from '../hooks/usePageTableState';
import { formatDateTime } from '../utils/formatters';

interface Filters {
  keyword: string;
  isEnabled: string;
}

interface FormState {
  namespace: string;
  label: string;
  description: string;
  isEnabled: boolean;
}

interface SavePayload {
  namespace: string;
  input: DictionaryNamespaceSaveInput;
}

interface FeedbackState {
  type: 'success' | 'danger';
  message: string;
}

const defaultFilters: Filters = {
  keyword: '',
  isEnabled: '',
};

const emptyFormState: FormState = {
  namespace: '',
  label: '',
  description: '',
  isEnabled: true,
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function toFormState(item: DictionaryNamespaceItem): FormState {
  return {
    namespace: item.namespace,
    label: item.label ?? '',
    description: item.description ?? '',
    isEnabled: item.isEnabled,
  };
}

export function DictionaryNamespacePage() {
  const queryClient = useQueryClient();
  const tableState = usePageTableState({ defaultSort: 'namespace:asc' });

  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [draftFilters, setDraftFilters] = useState<Filters>(defaultFilters);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingNamespace, setEditingNamespace] = useState<string | null>(null);
  const [formState, setFormState] = useState<FormState>(emptyFormState);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const namespaceQuery = useMemo(
    () =>
      tableState.buildQuery({
        keyword: filters.keyword || undefined,
        isEnabled: filters.isEnabled || undefined,
      }),
    [filters, tableState],
  );

  const overviewQuery = useQuery({
    queryKey: ['dictionary-overview'],
    queryFn: () => DictionaryApi.getOverview(),
  });

  const namespacesQuery = useQuery({
    queryKey: ['dictionary-namespaces', namespaceQuery],
    queryFn: () => DictionaryApi.listNamespaces(namespaceQuery),
  });

  useEffect(() => {
    tableState.updateFromPageResult(namespacesQuery.data);
  }, [namespacesQuery.data, tableState]);

  const openCreateModal = useCallback(() => {
    setEditingNamespace(null);
    setFormState(emptyFormState);
    setModalOpen(true);
  }, []);

  const saveMutation = useMutation({
    mutationFn: ({ namespace, input }: SavePayload) =>
      DictionaryApi.updateNamespace(namespace, input),
    onSuccess: async () => {
      setModalOpen(false);
      setFeedback({ type: 'success', message: '命名空间保存成功' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dictionary-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['dictionary-namespaces'] }),
      ]);
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '命名空间保存失败') });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (namespace: string) => DictionaryApi.deleteNamespace(namespace),
    onSuccess: async () => {
      setFeedback({ type: 'success', message: '命名空间删除成功' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dictionary-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['dictionary-namespaces'] }),
      ]);
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '命名空间删除失败') });
    },
  });

  const namespaces = namespacesQuery.data?.list ?? [];
  const total = namespacesQuery.data?.total ?? 0;
  const totalPages = namespacesQuery.data?.totalPages ?? 1;
  const isBusy =
    overviewQuery.isFetching ||
    namespacesQuery.isFetching ||
    saveMutation.isPending ||
    deleteMutation.isPending ||
    loadingDetail;

  const openEditModal = useCallback(async (namespace: string) => {
    setLoadingDetail(true);
    try {
      const item = await DictionaryApi.getNamespace(namespace);
      setEditingNamespace(item.namespace);
      setFormState(toFormState(item));
      setModalOpen(true);
    } catch (error) {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '命名空间详情加载失败') });
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const handleDelete = useCallback(
    async (namespace: string) => {
      if (!window.confirm(`确认删除命名空间 ${namespace} 吗？请先删除该命名空间下的字典。`)) {
        return;
      }
      await deleteMutation.mutateAsync(namespace);
    },
    [deleteMutation],
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!formState.namespace.trim()) {
        setFeedback({ type: 'danger', message: '命名空间必填' });
        return;
      }

      await saveMutation.mutateAsync({
        namespace: formState.namespace.trim(),
        input: {
          label: formState.label.trim() || undefined,
          description: formState.description.trim() || undefined,
          isEnabled: formState.isEnabled,
        },
      });
    },
    [formState, saveMutation],
  );

  return (
    <div className="page-card">
      <div className="d-flex flex-column gap-3">
        <div className="d-flex flex-column gap-1">
          <h2 className="m-0">命名空间列表</h2>
          <p className="text-secondary mb-0">维护中性的字典命名空间，不承载具体业务分组。</p>
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
          <div className="col-md-5">
            <label className="form-label" htmlFor="dictionaryNamespaceKeywordInput">
              关键词
            </label>
            <input
              id="dictionaryNamespaceKeywordInput"
              className="form-control"
              value={draftFilters.keyword}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  keyword: event.target.value,
                }))
              }
              placeholder="按命名空间、中文名称、描述搜索"
            />
          </div>
          <div className="col-md-3">
            <label className="form-label" htmlFor="dictionaryNamespaceIsEnabledSelect">
              状态
            </label>
            <select
              id="dictionaryNamespaceIsEnabledSelect"
              className="form-select"
              value={draftFilters.isEnabled}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  isEnabled: event.target.value,
                }))
              }
            >
              <option value="">全部</option>
              <option value="true">启用</option>
              <option value="false">停用</option>
            </select>
          </div>
          <div className="col-md-4 d-flex gap-2">
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
            <button
              className="btn btn-outline-success ms-auto"
              type="button"
              onClick={openCreateModal}
            >
              新增命名空间
            </button>
          </div>
        </form>

        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <SortableColumnHeader
                  label="命名空间"
                  field="namespace"
                  sortable
                  sortField={tableState.sortField}
                  sortDirection={tableState.sortDirection}
                  onSort={tableState.toggleSort}
                />
                <th scope="col">中文名称</th>
                <th scope="col">状态</th>
                <th scope="col">字典项数</th>
                <th scope="col">描述</th>
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
              {namespaces.length ? (
                namespaces.map((item) => (
                  <tr key={item.namespace}>
                    <td>{item.namespace}</td>
                    <td>{item.label || '-'}</td>
                    <td>
                      <span className={`badge-inline ${item.isEnabled ? 'success' : 'secondary'}`}>
                        {item.isEnabled ? '启用' : '停用'}
                      </span>
                    </td>
                    <td>{item.count ?? 0}</td>
                    <td>{item.description || '-'}</td>
                    <td>{formatDateTime(item.updatedAt)}</td>
                    <td>
                      <div className="actions-cell">
                        <button
                          className="btn btn-outline-success btn-sm"
                          type="button"
                          disabled={isBusy}
                          onClick={() => {
                            void openEditModal(item.namespace);
                          }}
                        >
                          编辑
                        </button>
                        <button
                          className="btn btn-outline-danger btn-sm"
                          type="button"
                          disabled={deleteMutation.isPending}
                          onClick={() => {
                            void handleDelete(item.namespace);
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
                  <td colSpan={7}>
                    <div className="text-center py-4 text-secondary">暂无命名空间数据</div>
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
        title={editingNamespace ? `编辑命名空间：${editingNamespace}` : '新增命名空间'}
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
              onClick={() => setModalOpen(false)}
              disabled={saveMutation.isPending}
            >
              取消
            </button>
            <button
              className="btn btn-success"
              type="submit"
              form="dictionaryNamespaceForm"
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? '保存中...' : '保存'}
            </button>
          </>
        }
      >
        <form
          id="dictionaryNamespaceForm"
          className="row g-3"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <div className="col-12">
            <label className="form-label" htmlFor="dictionaryNamespaceFormNamespaceInput">
              命名空间
            </label>
            <input
              id="dictionaryNamespaceFormNamespaceInput"
              className="form-control"
              value={formState.namespace}
              disabled={!!editingNamespace}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  namespace: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="dictionaryNamespaceFormLabelInput">
              中文名称
            </label>
            <input
              id="dictionaryNamespaceFormLabelInput"
              className="form-control"
              value={formState.label}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  label: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="dictionaryNamespaceFormDescriptionInput">
              描述
            </label>
            <textarea
              id="dictionaryNamespaceFormDescriptionInput"
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
            <label className="form-label" htmlFor="dictionaryNamespaceFormEnabledInput">
              状态
            </label>
            <select
              id="dictionaryNamespaceFormEnabledInput"
              className="form-select"
              value={String(formState.isEnabled)}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  isEnabled: event.target.value === 'true',
                }))
              }
            >
              <option value="true">启用</option>
              <option value="false">停用</option>
            </select>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
