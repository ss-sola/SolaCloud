import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DictionaryApi,
  type DictionaryAggregateItem,
  type DictionaryAggregateSaveInput,
  type DictionaryImportInput,
  type DictionaryItem,
  type DictionaryItemSaveInput,
  type DictionaryNamespaceItem,
} from '../api/dictionaryApi';
import { ModalDialog } from '../components/ModalDialog';
import { PagePagination } from '../components/PagePagination';
import { SortableColumnHeader } from '../components/SortableColumnHeader';
import { usePageTableState } from '../hooks/usePageTableState';
import { formatDateTime } from '../utils/formatters';

interface AggregateFormState {
  namespace: string;
  aggregateKey: string;
  label: string;
  description: string;
  isEnabled: boolean;
}

interface ItemFormState {
  namespace: string;
  aggregateKey: string;
  key: string;
  label: string;
  description: string;
  valueText: string;
  isEnabled: boolean;
}

interface ImportFormState {
  namespace: string;
  label: string;
  description: string;
  itemsText: string;
}

interface FeedbackState {
  type: 'success' | 'danger';
  message: string;
}

const emptyAggregateFormState: AggregateFormState = {
  namespace: '',
  aggregateKey: '',
  label: '',
  description: '',
  isEnabled: true,
};

const emptyItemFormState: ItemFormState = {
  namespace: '',
  aggregateKey: '',
  key: '',
  label: '',
  description: '',
  valueText: '',
  isEnabled: true,
};

const emptyImportFormState: ImportFormState = {
  namespace: '',
  label: '',
  description: '',
  itemsText: '',
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function getAggregateDisplayName(
  item?: Pick<DictionaryAggregateItem, 'aggregateKey' | 'label'> | null,
) {
  if (!item?.label || item.label === item.aggregateKey) {
    return '未命名字典';
  }
  return item.label;
}

function formatDictionaryValue(value: unknown) {
  if (value === undefined || value === null) {
    return '-';
  }
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function parseDictionaryValue(valueText: string) {
  const trimmed = valueText.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return valueText;
  }
}

function buildImportTemplate(namespace: string, aggregateKey: string) {
  return JSON.stringify(
    [
      {
        aggregateKey,
        key: 'default',
        value: 'aurora',
        label: '默认主题',
        description: `${namespace || 'system-service'} 默认字典项`,
        isEnabled: true,
      },
    ],
    null,
    2,
  );
}

function toAggregateFormState(item: DictionaryAggregateItem): AggregateFormState {
  return {
    namespace: item.namespace,
    aggregateKey: item.aggregateKey,
    label: item.label ?? '',
    description: item.description ?? '',
    isEnabled: item.isEnabled,
  };
}

function toItemFormState(item: DictionaryItem): ItemFormState {
  return {
    namespace: item.namespace,
    aggregateKey: item.aggregateKey,
    key: item.key,
    label: item.label ?? '',
    description: item.description ?? '',
    valueText:
      typeof item.value === 'string' ? item.value : JSON.stringify(item.value ?? null, null, 2),
    isEnabled: item.isEnabled,
  };
}

export function DictionaryPage() {
  const queryClient = useQueryClient();
  const aggregateTableState = usePageTableState({ defaultSort: 'aggregateKey:asc' });
  const itemTableState = usePageTableState({ defaultSort: 'key:asc' });

  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [currentNamespace, setCurrentNamespace] = useState('');
  const [selectedAggregateKey, setSelectedAggregateKey] = useState('');

  const [aggregateModalOpen, setAggregateModalOpen] = useState(false);
  const [editingAggregateKey, setEditingAggregateKey] = useState<string | null>(null);
  const [aggregateFormState, setAggregateFormState] =
    useState<AggregateFormState>(emptyAggregateFormState);

  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItemKey, setEditingItemKey] = useState<string | null>(null);
  const [itemFormState, setItemFormState] = useState<ItemFormState>(emptyItemFormState);
  const [loadingItemDetail, setLoadingItemDetail] = useState(false);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importFormState, setImportFormState] = useState<ImportFormState>(emptyImportFormState);

  const namespacesQuery = useQuery({
    queryKey: ['dictionary-namespaces', 'all'],
    queryFn: () => DictionaryApi.listNamespaces({ pageNum: 1, pageSize: 100 }),
  });

  const overviewQuery = useQuery({
    queryKey: ['dictionary-overview'],
    queryFn: () => DictionaryApi.getOverview(),
  });

  useEffect(() => {
    const namespaces = namespacesQuery.data?.list ?? [];
    if (!namespaces.length) {
      setCurrentNamespace('');
      return;
    }

    const currentExists = namespaces.some((item) => item.namespace === currentNamespace);
    if (!currentExists) {
      setCurrentNamespace(namespaces[0]?.namespace ?? '');
      setSelectedAggregateKey('');
      aggregateTableState.setPage(1);
    }
  }, [aggregateTableState, currentNamespace, namespacesQuery.data]);

  const aggregateQueryParams = useMemo(
    () =>
      currentNamespace ? aggregateTableState.buildQuery({ namespace: currentNamespace }) : null,
    [aggregateTableState, currentNamespace],
  );

  const aggregatesQuery = useQuery({
    queryKey: ['dictionary-aggregates', aggregateQueryParams],
    queryFn: () => DictionaryApi.listAggregates(aggregateQueryParams ?? { namespace: '' }),
    enabled: !!aggregateQueryParams,
  });

  useEffect(() => {
    aggregateTableState.updateFromPageResult(aggregatesQuery.data);
  }, [aggregateTableState, aggregatesQuery.data]);

  const aggregates = aggregatesQuery.data?.list ?? [];

  useEffect(() => {
    if (!selectedAggregateKey) {
      return;
    }

    if (!aggregates.some((item) => item.aggregateKey === selectedAggregateKey)) {
      setSelectedAggregateKey('');
    }
  }, [aggregates, selectedAggregateKey]);

  const aggregateModalItemContext = useMemo(() => {
    if (!aggregateModalOpen || !editingAggregateKey) {
      return null;
    }

    const namespace = aggregateFormState.namespace.trim();
    const aggregateKey = aggregateFormState.aggregateKey.trim();
    if (!namespace || !aggregateKey) {
      return null;
    }

    return { namespace, aggregateKey };
  }, [
    aggregateFormState.aggregateKey,
    aggregateFormState.namespace,
    aggregateModalOpen,
    editingAggregateKey,
  ]);

  const itemQueryParams = useMemo(
    () =>
      aggregateModalItemContext
        ? {
            ...aggregateModalItemContext,
            ...(itemTableState.sort ? { sort: itemTableState.sort } : {}),
          }
        : null,
    [aggregateModalItemContext, itemTableState.sort],
  );

  const itemsQuery = useQuery({
    queryKey: ['dictionary-items', itemQueryParams],
    queryFn: () => DictionaryApi.listItems(itemQueryParams ?? { namespace: '', aggregateKey: '' }),
    enabled: !!itemQueryParams,
  });

  const items = itemsQuery.data ?? [];

  const openAggregateCreateModal = useCallback(() => {
    if (!currentNamespace) {
      setFeedback({ type: 'danger', message: '请先选择命名空间' });
      return;
    }

    setEditingAggregateKey(null);
    setAggregateFormState({
      namespace: currentNamespace,
      aggregateKey: '',
      label: '',
      description: '',
      isEnabled: true,
    });
    setAggregateModalOpen(true);
  }, [currentNamespace]);

  const aggregateSaveMutation = useMutation({
    mutationFn: ({
      namespace,
      aggregateKey,
      input,
    }: {
      namespace: string;
      aggregateKey: string;
      input: DictionaryAggregateSaveInput;
    }) => DictionaryApi.updateAggregate(namespace, aggregateKey, input),
    onSuccess: async () => {
      setAggregateModalOpen(false);
      setEditingAggregateKey(null);
      setFeedback({ type: 'success', message: '字典保存成功' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dictionary-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['dictionary-aggregates'] }),
        queryClient.invalidateQueries({ queryKey: ['dictionary-items'] }),
      ]);
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '字典保存失败') });
    },
  });

  const aggregateDeleteMutation = useMutation({
    mutationFn: ({ namespace, aggregateKey }: { namespace: string; aggregateKey: string }) =>
      DictionaryApi.deleteAggregate(namespace, aggregateKey),
    onSuccess: async () => {
      setFeedback({ type: 'success', message: '字典删除成功' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dictionary-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['dictionary-aggregates'] }),
        queryClient.invalidateQueries({ queryKey: ['dictionary-items'] }),
      ]);
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '字典删除失败') });
    },
  });

  const itemSaveMutation = useMutation({
    mutationFn: ({
      namespace,
      aggregateKey,
      key,
      input,
    }: {
      namespace: string;
      aggregateKey: string;
      key: string;
      input: DictionaryItemSaveInput;
    }) => DictionaryApi.updateItem(namespace, aggregateKey, key, input),
    onSuccess: async () => {
      setItemModalOpen(false);
      setFeedback({ type: 'success', message: '字典项保存成功' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dictionary-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['dictionary-aggregates'] }),
        queryClient.invalidateQueries({ queryKey: ['dictionary-items'] }),
      ]);
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '字典项保存失败') });
    },
  });

  const itemDeleteMutation = useMutation({
    mutationFn: ({
      namespace,
      aggregateKey,
      key,
    }: {
      namespace: string;
      aggregateKey: string;
      key: string;
    }) => DictionaryApi.deleteItem(namespace, aggregateKey, key),
    onSuccess: async () => {
      setFeedback({ type: 'success', message: '字典项删除成功' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dictionary-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['dictionary-aggregates'] }),
        queryClient.invalidateQueries({ queryKey: ['dictionary-items'] }),
      ]);
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '字典项删除失败') });
    },
  });

  const importMutation = useMutation({
    mutationFn: (input: DictionaryImportInput) => DictionaryApi.importItems(input),
    onSuccess: async (result) => {
      const nextAggregateKey = result.items[0]?.aggregateKey ?? selectedAggregateKey;
      setSelectedAggregateKey(nextAggregateKey);
      setImportModalOpen(false);
      setFeedback({
        type: 'success',
        message: `导入成功：新增 ${result.createdCount}，更新 ${result.updatedCount}，跳过 ${result.skippedCount}`,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dictionary-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['dictionary-aggregates'] }),
        queryClient.invalidateQueries({ queryKey: ['dictionary-items'] }),
      ]);
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '字典项导入失败') });
    },
  });

  const openAggregateEditModal = useCallback((item: DictionaryAggregateItem) => {
    setCurrentNamespace(item.namespace);
    setSelectedAggregateKey(item.aggregateKey);
    setEditingAggregateKey(item.aggregateKey);
    setAggregateFormState(toAggregateFormState(item));
    setAggregateModalOpen(true);
  }, []);

  const openItemCreateModal = useCallback(() => {
    if (!aggregateModalItemContext) {
      setFeedback({ type: 'danger', message: '请先打开要维护的字典' });
      return;
    }

    setEditingItemKey(null);
    setItemFormState({
      namespace: aggregateModalItemContext.namespace,
      aggregateKey: aggregateModalItemContext.aggregateKey,
      key: '',
      label: '',
      description: '',
      valueText: '',
      isEnabled: true,
    });
    setItemModalOpen(true);
  }, [aggregateModalItemContext]);

  const openItemEditModal = useCallback(
    async (itemKey: string) => {
      if (!aggregateModalItemContext) {
        return;
      }

      setLoadingItemDetail(true);
      try {
        const item = await DictionaryApi.getItem(
          aggregateModalItemContext.namespace,
          aggregateModalItemContext.aggregateKey,
          itemKey,
        );
        setEditingItemKey(item.key);
        setItemFormState(toItemFormState(item));
        setItemModalOpen(true);
      } catch (error) {
        setFeedback({ type: 'danger', message: getErrorMessage(error, '字典项详情加载失败') });
      } finally {
        setLoadingItemDetail(false);
      }
    },
    [aggregateModalItemContext],
  );

  const openImportModal = useCallback(() => {
    if (!aggregateModalItemContext) {
      setFeedback({ type: 'danger', message: '请先打开要导入字典项的字典' });
      return;
    }

    setImportFormState({
      namespace: aggregateModalItemContext.namespace,
      label: aggregateModalItemContext.namespace || '系统默认',
      description: '',
      itemsText: buildImportTemplate(
        aggregateModalItemContext.namespace,
        aggregateModalItemContext.aggregateKey,
      ),
    });
    setImportModalOpen(true);
  }, [aggregateModalItemContext]);

  const handleDeleteAggregate = useCallback(
    async (item: DictionaryAggregateItem) => {
      if (
        !window.confirm(
          `确认删除字典 ${getAggregateDisplayName(item)} 吗？请先删除该字典下的字典项。`,
        )
      ) {
        return;
      }
      await aggregateDeleteMutation.mutateAsync({
        namespace: item.namespace,
        aggregateKey: item.aggregateKey,
      });
    },
    [aggregateDeleteMutation],
  );

  const handleDeleteItem = useCallback(
    async (item: DictionaryItem) => {
      if (
        !window.confirm(`确认删除字典项 ${item.namespace}.${item.aggregateKey}.${item.key} 吗？`)
      ) {
        return;
      }
      await itemDeleteMutation.mutateAsync({
        namespace: item.namespace,
        aggregateKey: item.aggregateKey,
        key: item.key,
      });
    },
    [itemDeleteMutation],
  );

  const handleAggregateSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!aggregateFormState.namespace.trim() || !aggregateFormState.aggregateKey.trim()) {
        setFeedback({ type: 'danger', message: '命名空间和字典编码必填' });
        return;
      }

      await aggregateSaveMutation.mutateAsync({
        namespace: aggregateFormState.namespace.trim(),
        aggregateKey: aggregateFormState.aggregateKey.trim(),
        input: {
          label: aggregateFormState.label.trim() || undefined,
          description: aggregateFormState.description.trim() || undefined,
          isEnabled: aggregateFormState.isEnabled,
        },
      });

      setSelectedAggregateKey(aggregateFormState.aggregateKey.trim());
      setCurrentNamespace(aggregateFormState.namespace.trim());
    },
    [aggregateFormState, aggregateSaveMutation],
  );

  const handleItemSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (
        !itemFormState.namespace.trim() ||
        !itemFormState.aggregateKey.trim() ||
        !itemFormState.key.trim()
      ) {
        setFeedback({ type: 'danger', message: '命名空间、字典编码和字典项编码必填' });
        return;
      }

      await itemSaveMutation.mutateAsync({
        namespace: itemFormState.namespace.trim(),
        aggregateKey: itemFormState.aggregateKey.trim(),
        key: itemFormState.key.trim(),
        input: {
          value: parseDictionaryValue(itemFormState.valueText),
          label: itemFormState.label.trim() || undefined,
          description: itemFormState.description.trim() || undefined,
          isEnabled: itemFormState.isEnabled,
        },
      });
    },
    [itemFormState, itemSaveMutation],
  );

  const handleImportSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!importFormState.namespace.trim() || !importFormState.itemsText.trim()) {
        setFeedback({ type: 'danger', message: '导入命名空间和 items 必填' });
        return;
      }

      let parsedItems: unknown;
      try {
        parsedItems = JSON.parse(importFormState.itemsText);
      } catch {
        setFeedback({ type: 'danger', message: 'Items 必须是合法 JSON 数组' });
        return;
      }

      if (!Array.isArray(parsedItems)) {
        setFeedback({ type: 'danger', message: 'Items 必须是 JSON 数组' });
        return;
      }

      await importMutation.mutateAsync({
        namespace: importFormState.namespace.trim(),
        label: importFormState.label.trim() || undefined,
        description: importFormState.description.trim() || undefined,
        items: parsedItems as DictionaryImportInput['items'],
      });
    },
    [importFormState, importMutation],
  );

  const namespaces = namespacesQuery.data?.list ?? [];
  const modalAggregateDisplayName = getAggregateDisplayName({
    aggregateKey: aggregateFormState.aggregateKey,
    label: aggregateFormState.label,
  });
  const isBusy =
    overviewQuery.isFetching ||
    namespacesQuery.isFetching ||
    aggregatesQuery.isFetching ||
    itemsQuery.isFetching ||
    aggregateSaveMutation.isPending ||
    aggregateDeleteMutation.isPending ||
    itemSaveMutation.isPending ||
    itemDeleteMutation.isPending ||
    importMutation.isPending ||
    loadingItemDetail;

  return (
    <>
      <div className="d-flex flex-column gap-3">
        {feedback ? (
          <div className={`alert alert-${feedback.type} mb-0`}>{feedback.message}</div>
        ) : null}

        <div className="dictionary-split-layout mt-0">
          <div className="page-card">
            <div className="page-card-header">
              <div>
                <h3 className="page-card-title">字典列表</h3>
                <div className="page-card-desc">
                  以表格维护当前命名空间下的字典，字典项在编辑弹窗中管理。
                </div>
              </div>
              <button
                className="btn btn-outline-primary btn-sm"
                type="button"
                onClick={openAggregateCreateModal}
              >
                新增字典
              </button>
            </div>

            <form className="toolbar-form" onSubmit={(event) => event.preventDefault()}>
              <label
                className="toolbar-field toolbar-field-wide"
                htmlFor="dictionaryNamespaceSelect"
              >
                <span>命名空间</span>
                <select
                  id="dictionaryNamespaceSelect"
                  className="form-select form-select-sm"
                  value={currentNamespace}
                  onChange={(event) => {
                    setCurrentNamespace(event.target.value);
                    setSelectedAggregateKey('');
                    aggregateTableState.setPage(1);
                  }}
                >
                  {namespaces.length ? (
                    namespaces.map((item: DictionaryNamespaceItem) => (
                      <option key={item.namespace} value={item.namespace}>
                        {item.label || item.namespace}
                      </option>
                    ))
                  ) : (
                    <option value="">暂无命名空间</option>
                  )}
                </select>
              </label>
            </form>

            <div className="table-responsive table-wrapper dictionary-list-wrapper">
              <table className="table table-hover align-middle admin-table dictionary-namespace-table">
                <thead>
                  <tr>
                    <SortableColumnHeader
                      label="字典"
                      field="aggregateKey"
                      sortable
                      sortField={aggregateTableState.sortField}
                      sortDirection={aggregateTableState.sortDirection}
                      onSort={aggregateTableState.toggleSort}
                    />
                    <th scope="col">状态</th>
                    <th scope="col">字典项数量</th>
                    <th scope="col">描述</th>
                    <SortableColumnHeader
                      label="更新时间"
                      field="updatedAt"
                      sortable
                      sortField={aggregateTableState.sortField}
                      sortDirection={aggregateTableState.sortDirection}
                      onSort={aggregateTableState.toggleSort}
                    />
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {aggregates.length ? (
                    aggregates.map((item) => (
                      <tr
                        key={`${item.namespace}:${item.aggregateKey}`}
                        className={`dictionary-namespace-row${item.aggregateKey === selectedAggregateKey ? ' active' : ''}`}
                        onClick={() => {
                          setSelectedAggregateKey(item.aggregateKey);
                        }}
                      >
                        <td>
                          <span
                            className="dictionary-namespace-label"
                            title={getAggregateDisplayName(item)}
                          >
                            {item.isEnabled ? (
                              <span className="dictionary-enabled-dot" aria-hidden="true" />
                            ) : null}
                            {getAggregateDisplayName(item)}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`badge-inline ${item.isEnabled ? 'success' : 'secondary'}`}
                          >
                            {item.isEnabled ? '启用' : '停用'}
                          </span>
                        </td>
                        <td>{item.count ?? 0}</td>
                        <td>{item.description || '-'}</td>
                        <td>{formatDateTime(item.updatedAt)}</td>
                        <td>
                          <div
                            className="actions-cell"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <button
                              className="btn btn-outline-success btn-sm"
                              type="button"
                              onClick={() => openAggregateEditModal(item)}
                            >
                              编辑
                            </button>
                            <button
                              className="btn btn-outline-danger btn-sm"
                              type="button"
                              disabled={aggregateDeleteMutation.isPending}
                              onClick={() => {
                                void handleDeleteAggregate(item);
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
                      <td colSpan={6}>
                        <div className="table-empty">暂无字典数据</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <PagePagination
              page={aggregateTableState.page}
              pageSize={aggregateTableState.pageSize}
              total={aggregatesQuery.data?.total ?? 0}
              totalPages={aggregatesQuery.data?.totalPages ?? 1}
              onPageChange={aggregateTableState.setPage}
              onPageSizeChange={(nextPageSize) => {
                aggregateTableState.setPage(1);
                aggregateTableState.setPageSize(nextPageSize);
              }}
            />
          </div>
        </div>
      </div>

      <ModalDialog
        open={aggregateModalOpen}
        size="xl"
        title={editingAggregateKey ? `编辑字典：${modalAggregateDisplayName}` : '新增字典'}
        onClose={() => {
          if (aggregateSaveMutation.isPending) {
            return;
          }
          setAggregateModalOpen(false);
          setEditingAggregateKey(null);
        }}
        footer={
          <>
            <button
              className="btn btn-outline-secondary"
              type="button"
              disabled={aggregateSaveMutation.isPending}
              onClick={() => {
                setAggregateModalOpen(false);
                setEditingAggregateKey(null);
              }}
            >
              取消
            </button>
            <button
              className="btn btn-success"
              type="submit"
              form="dictionaryAggregateForm"
              disabled={aggregateSaveMutation.isPending}
            >
              {aggregateSaveMutation.isPending ? '保存中...' : '保存'}
            </button>
          </>
        }
      >
        <form
          id="dictionaryAggregateForm"
          className="row g-3"
          onSubmit={(event) => void handleAggregateSubmit(event)}
        >
          <div className="col-12">
            <label className="form-label" htmlFor="dictionaryAggregateNamespaceInput">
              命名空间
            </label>
            <input
              id="dictionaryAggregateNamespaceInput"
              className="form-control"
              value={aggregateFormState.namespace}
              disabled={!!editingAggregateKey}
              onChange={(event) =>
                setAggregateFormState((current) => ({
                  ...current,
                  namespace: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="dictionaryAggregateKeyInput">
              字典编码
            </label>
            <input
              id="dictionaryAggregateKeyInput"
              className="form-control"
              value={aggregateFormState.aggregateKey}
              disabled={!!editingAggregateKey}
              onChange={(event) =>
                setAggregateFormState((current) => ({
                  ...current,
                  aggregateKey: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="dictionaryAggregateLabelInput">
              中文名称
            </label>
            <input
              id="dictionaryAggregateLabelInput"
              className="form-control"
              value={aggregateFormState.label}
              onChange={(event) =>
                setAggregateFormState((current) => ({
                  ...current,
                  label: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="dictionaryAggregateDescriptionInput">
              描述
            </label>
            <textarea
              id="dictionaryAggregateDescriptionInput"
              className="form-control"
              rows={3}
              value={aggregateFormState.description}
              onChange={(event) =>
                setAggregateFormState((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="dictionaryAggregateEnabledInput">
              状态
            </label>
            <select
              id="dictionaryAggregateEnabledInput"
              className="form-select"
              value={String(aggregateFormState.isEnabled)}
              onChange={(event) =>
                setAggregateFormState((current) => ({
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

        {editingAggregateKey ? (
          <div className="dictionary-modal-items">
            <div className="dictionary-modal-items-header">
              <div>
                <h6 className="dictionary-modal-items-title">字典项列表</h6>
                <div className="dictionary-modal-items-desc">维护当前字典下的字典项。</div>
              </div>
              <div className="toolbar-actions">
                <button
                  className="btn btn-outline-success btn-sm"
                  type="button"
                  disabled={itemsQuery.isFetching}
                  onClick={() => {
                    void itemsQuery.refetch();
                  }}
                >
                  刷新
                </button>
                <button
                  className="btn btn-success btn-sm"
                  type="button"
                  onClick={openItemCreateModal}
                >
                  新增字典项
                </button>
                <button
                  className="btn btn-outline-primary btn-sm"
                  type="button"
                  onClick={openImportModal}
                >
                  批量导入
                </button>
              </div>
            </div>

            <div className="table-responsive table-wrapper dictionary-modal-items-table">
              <table className="table table-hover align-middle admin-table mb-0">
                <thead>
                  <tr>
                    <SortableColumnHeader
                      label="字典项编码"
                      field="key"
                      sortable
                      sortField={itemTableState.sortField}
                      sortDirection={itemTableState.sortDirection}
                      onSort={itemTableState.toggleSort}
                    />
                    <th scope="col">中文名称</th>
                    <th scope="col">状态</th>
                    <th scope="col">字典值</th>
                    <th scope="col">描述</th>
                    <SortableColumnHeader
                      label="更新时间"
                      field="updatedAt"
                      sortable
                      sortField={itemTableState.sortField}
                      sortDirection={itemTableState.sortDirection}
                      onSort={itemTableState.toggleSort}
                    />
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length ? (
                    items.map((item) => (
                      <tr key={`${item.namespace}:${item.aggregateKey}:${item.key}`}>
                        <td>{item.key}</td>
                        <td>{item.label || '-'}</td>
                        <td>
                          <span
                            className={`badge-inline ${item.isEnabled ? 'success' : 'secondary'}`}
                          >
                            {item.isEnabled ? '启用' : '停用'}
                          </span>
                        </td>
                        <td>
                          <div className="pre-wrap">{formatDictionaryValue(item.value)}</div>
                        </td>
                        <td>{item.description || '-'}</td>
                        <td>{formatDateTime(item.updatedAt)}</td>
                        <td>
                          <div className="actions-cell">
                            <button
                              className="btn btn-outline-success btn-sm"
                              type="button"
                              disabled={loadingItemDetail}
                              onClick={() => {
                                void openItemEditModal(item.key);
                              }}
                            >
                              编辑
                            </button>
                            <button
                              className="btn btn-outline-danger btn-sm"
                              type="button"
                              disabled={itemDeleteMutation.isPending}
                              onClick={() => {
                                void handleDeleteItem(item);
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
                        <div className="table-empty">暂无字典项数据</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </ModalDialog>

      <ModalDialog
        open={itemModalOpen}
        size="lg"
        title={
          editingItemKey
            ? `编辑字典项：${itemFormState.aggregateKey}.${editingItemKey}`
            : '新增字典项'
        }
        onClose={() => {
          if (itemSaveMutation.isPending) {
            return;
          }
          setItemModalOpen(false);
        }}
        footer={
          <>
            <button
              className="btn btn-outline-secondary"
              type="button"
              disabled={itemSaveMutation.isPending}
              onClick={() => setItemModalOpen(false)}
            >
              取消
            </button>
            <button
              className="btn btn-success"
              type="submit"
              form="dictionaryItemForm"
              disabled={itemSaveMutation.isPending}
            >
              {itemSaveMutation.isPending ? '保存中...' : '保存'}
            </button>
          </>
        }
      >
        <form
          id="dictionaryItemForm"
          className="row g-3"
          onSubmit={(event) => void handleItemSubmit(event)}
        >
          <div className="col-md-6">
            <label className="form-label" htmlFor="dictionaryFormNamespaceInput">
              命名空间
            </label>
            <input
              id="dictionaryFormNamespaceInput"
              className="form-control"
              value={itemFormState.namespace}
              disabled
              onChange={(event) =>
                setItemFormState((current) => ({
                  ...current,
                  namespace: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-md-6">
            <label className="form-label" htmlFor="dictionaryFormAggregateKeyInput">
              字典编码
            </label>
            <input
              id="dictionaryFormAggregateKeyInput"
              className="form-control"
              value={itemFormState.aggregateKey}
              disabled
              onChange={(event) =>
                setItemFormState((current) => ({
                  ...current,
                  aggregateKey: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="dictionaryFormKeyInput">
              字典项编码
            </label>
            <input
              id="dictionaryFormKeyInput"
              className="form-control"
              value={itemFormState.key}
              disabled={!!editingItemKey}
              onChange={(event) =>
                setItemFormState((current) => ({
                  ...current,
                  key: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="dictionaryFormLabelInput">
              中文名称
            </label>
            <input
              id="dictionaryFormLabelInput"
              className="form-control"
              value={itemFormState.label}
              onChange={(event) =>
                setItemFormState((current) => ({
                  ...current,
                  label: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="dictionaryFormDescriptionInput">
              描述
            </label>
            <textarea
              id="dictionaryFormDescriptionInput"
              className="form-control"
              rows={3}
              value={itemFormState.description}
              onChange={(event) =>
                setItemFormState((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="dictionaryFormValueInput">
              字典值
            </label>
            <textarea
              id="dictionaryFormValueInput"
              className="form-control"
              rows={6}
              value={itemFormState.valueText}
              onChange={(event) =>
                setItemFormState((current) => ({
                  ...current,
                  valueText: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="dictionaryFormEnabledInput">
              状态
            </label>
            <select
              id="dictionaryFormEnabledInput"
              className="form-select"
              value={String(itemFormState.isEnabled)}
              onChange={(event) =>
                setItemFormState((current) => ({
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

      <ModalDialog
        open={importModalOpen}
        size="lg"
        title="导入字典项"
        onClose={() => {
          if (importMutation.isPending) {
            return;
          }
          setImportModalOpen(false);
        }}
        footer={
          <>
            <button
              className="btn btn-outline-secondary"
              type="button"
              disabled={importMutation.isPending}
              onClick={() => setImportModalOpen(false)}
            >
              取消
            </button>
            <button
              className="btn btn-success"
              type="submit"
              form="dictionaryImportForm"
              disabled={importMutation.isPending}
            >
              {importMutation.isPending ? '导入中...' : '导入'}
            </button>
          </>
        }
      >
        <form
          id="dictionaryImportForm"
          className="row g-3"
          onSubmit={(event) => void handleImportSubmit(event)}
        >
          <div className="col-12">
            <label className="form-label" htmlFor="dictionaryImportNamespaceInput">
              命名空间
            </label>
            <input
              id="dictionaryImportNamespaceInput"
              className="form-control"
              value={importFormState.namespace}
              onChange={(event) =>
                setImportFormState((current) => ({
                  ...current,
                  namespace: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="dictionaryImportLabelInput">
              中文名称
            </label>
            <input
              id="dictionaryImportLabelInput"
              className="form-control"
              value={importFormState.label}
              onChange={(event) =>
                setImportFormState((current) => ({
                  ...current,
                  label: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="dictionaryImportDescriptionInput">
              描述
            </label>
            <textarea
              id="dictionaryImportDescriptionInput"
              className="form-control"
              rows={3}
              value={importFormState.description}
              onChange={(event) =>
                setImportFormState((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="dictionaryImportItemsInput">
              Items(JSON 数组)
            </label>
            <textarea
              id="dictionaryImportItemsInput"
              className="form-control"
              rows={10}
              value={importFormState.itemsText}
              onChange={(event) =>
                setImportFormState((current) => ({
                  ...current,
                  itemsText: event.target.value,
                }))
              }
            />
          </div>
        </form>
      </ModalDialog>
    </>
  );
}
