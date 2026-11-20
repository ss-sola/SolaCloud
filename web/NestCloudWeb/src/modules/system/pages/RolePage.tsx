import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RuntimeMenuRoute } from '../../../shared/api/systemApi';
import { PermissionApi, type PermissionItem } from '../api/permissionApi';
import { RoleApi, type RoleItem, type RoleSaveInput } from '../api/roleApi';
import { ModalDialog } from '../components/ModalDialog';
import { PagePagination } from '../components/PagePagination';
import { SortableColumnHeader } from '../components/SortableColumnHeader';
import { usePageTableState } from '../hooks/usePageTableState';
import { useSystemPageFrame } from './SystemPageFrameContext';
import { formatDateTime } from '../utils/formatters';

interface Filters {
  keyword: string;
  isEnabled: string;
}

interface PermissionFilters {
  keyword: string;
  groupKey: string;
  isEnabled: string;
}

interface FormState {
  code: string;
  name: string;
  description: string;
  isEnabled: boolean;
}

interface FeedbackState {
  type: 'success' | 'danger';
  message: string;
}

const defaultFilters: Filters = {
  keyword: '',
  isEnabled: '',
};

const defaultPermissionFilters: PermissionFilters = {
  keyword: '',
  groupKey: '',
  isEnabled: '',
};

const emptyFormState: FormState = {
  code: '',
  name: '',
  description: '',
  isEnabled: true,
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function matchesPermissionFilter(item: PermissionItem, filters: PermissionFilters) {
  const keyword = filters.keyword.trim().toLowerCase();
  const groupKey = filters.groupKey.trim().toLowerCase();
  const enabledMatched = !filters.isEnabled || String(item.isEnabled) === filters.isEnabled;
  const keywordMatched =
    !keyword ||
    [item.code, item.name, item.description]
      .filter((value): value is string => !!value)
      .some((value) => value.toLowerCase().includes(keyword));
  const groupMatched =
    !groupKey ||
    String(item.groupKey ?? '')
      .toLowerCase()
      .includes(groupKey);

  return keywordMatched && groupMatched && enabledMatched;
}

function toFormState(item: RoleItem): FormState {
  return {
    code: item.code,
    name: item.name,
    description: item.description ?? '',
    isEnabled: item.isEnabled,
  };
}

function renderRuntimeMenuNodes(items: RuntimeMenuRoute[]) {
  if (!items.length) {
    return <div className="table-empty">当前角色无可用菜单</div>;
  }

  return (
    <ul className="tree-list">
      {items.map((item) => (
        <li key={item.code} className="tree-item">
          <div className="tree-item-main">
            <strong>{item.name}</strong>
            <span className="tree-item-meta">{item.code}</span>
            <span className="tree-item-meta">routeName: {item.routeName ?? '-'}</span>
          </div>
          {item.children.length ? renderRuntimeMenuNodes(item.children) : null}
        </li>
      ))}
    </ul>
  );
}

export function RolePage() {
  const queryClient = useQueryClient();
  const { setFrameState } = useSystemPageFrame();
  const tableState = usePageTableState({ defaultSort: 'code:asc' });
  const permissionSelectAllRef = useRef<HTMLInputElement | null>(null);

  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [draftFilters, setDraftFilters] = useState<Filters>(defaultFilters);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formState, setFormState] = useState<FormState>(emptyFormState);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [permissionFilters, setPermissionFilters] =
    useState<PermissionFilters>(defaultPermissionFilters);
  const [draftPermissionFilters, setDraftPermissionFilters] =
    useState<PermissionFilters>(defaultPermissionFilters);
  const [selectedPermissionCodes, setSelectedPermissionCodes] = useState<string[]>([]);

  const [runtimeRoleCodeInput, setRuntimeRoleCodeInput] = useState('');
  const [runtimeQueryRoleCode, setRuntimeQueryRoleCode] = useState('');

  const roleQuery = useMemo(
    () =>
      tableState.buildQuery({
        keyword: filters.keyword || undefined,
        isEnabled: filters.isEnabled || undefined,
      }),
    [filters, tableState],
  );

  const overviewQuery = useQuery({
    queryKey: ['role-overview'],
    queryFn: () => RoleApi.getOverview(),
  });

  const itemsQuery = useQuery({
    queryKey: ['roles', roleQuery],
    queryFn: () => RoleApi.listItems(roleQuery),
  });

  const permissionsQuery = useQuery({
    queryKey: ['role-permissions'],
    queryFn: () => PermissionApi.listItems({ pageNum: 1, pageSize: 100, sort: 'code:asc' }),
  });

  const runtimePreviewQuery = useQuery({
    queryKey: ['role-runtime', runtimeQueryRoleCode],
    queryFn: () => RoleApi.getRuntime(runtimeQueryRoleCode),
    enabled: !!runtimeQueryRoleCode,
  });

  useEffect(() => {
    tableState.updateFromPageResult(itemsQuery.data);
  }, [itemsQuery.data, tableState]);

  const items = useMemo(() => itemsQuery.data?.list ?? [], [itemsQuery.data?.list]);
  const permissions = useMemo(
    () => permissionsQuery.data?.list ?? [],
    [permissionsQuery.data?.list],
  );
  const selectedPermissionCodeSet = useMemo(
    () => new Set(selectedPermissionCodes),
    [selectedPermissionCodes],
  );

  useEffect(() => {
    setSelectedPermissionCodes((current) =>
      current.filter((code) => permissions.some((item) => item.code === code)),
    );
  }, [permissions]);

  useEffect(() => {
    if (!items.length) {
      setRuntimeRoleCodeInput('');
      setRuntimeQueryRoleCode('');
      return;
    }

    const currentExists = items.some((item) => item.code === runtimeQueryRoleCode);
    if (!runtimeQueryRoleCode || !currentExists) {
      setRuntimeRoleCodeInput(items[0]?.code ?? '');
      setRuntimeQueryRoleCode(items[0]?.code ?? '');
    }
  }, [items, runtimeQueryRoleCode]);

  const filteredPermissions = useMemo(
    () => permissions.filter((item) => matchesPermissionFilter(item, permissionFilters)),
    [permissionFilters, permissions],
  );

  useEffect(() => {
    if (!permissionSelectAllRef.current) {
      return;
    }

    const selectedFilteredCount = filteredPermissions.filter((item) =>
      selectedPermissionCodeSet.has(item.code),
    ).length;
    permissionSelectAllRef.current.checked =
      !!filteredPermissions.length && selectedFilteredCount === filteredPermissions.length;
    permissionSelectAllRef.current.indeterminate =
      selectedFilteredCount > 0 && selectedFilteredCount < filteredPermissions.length;
  }, [filteredPermissions, selectedPermissionCodeSet]);

  const orderedSelectedPermissionCodes = useMemo(
    () =>
      permissions
        .filter((item) => selectedPermissionCodeSet.has(item.code))
        .map((item) => item.code),
    [permissions, selectedPermissionCodeSet],
  );

  const refreshPage = useCallback(async () => {
    setFeedback(null);
    await Promise.all([
      overviewQuery.refetch(),
      itemsQuery.refetch(),
      permissionsQuery.refetch(),
      runtimePreviewQuery.refetch(),
    ]);
  }, [itemsQuery, overviewQuery, permissionsQuery, runtimePreviewQuery]);

  useEffect(() => {
    setFrameState((current) => ({
      ...current,
      serviceLabel: `服务：${overviewQuery.data?.service ?? 'system-service'}`,
      capabilityLabel: `能力数：${overviewQuery.data?.capabilities.length ?? '-'}`,
    }));
  }, [overviewQuery.data, setFrameState]);

  const saveMutation = useMutation({
    mutationFn: ({ id, input }: { id?: number | null; input: RoleSaveInput }) => {
      if (id) {
        return RoleApi.updateItem(id, input);
      }
      return RoleApi.createItem(input);
    },
    onSuccess: async (_, variables) => {
      setModalOpen(false);
      setEditingId(null);
      setRuntimeRoleCodeInput(variables.input.code);
      setRuntimeQueryRoleCode(variables.input.code);
      setFeedback({ type: 'success', message: '角色保存成功' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['role-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['roles'] }),
        queryClient.invalidateQueries({ queryKey: ['role-runtime'] }),
      ]);
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '角色保存失败') });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => RoleApi.deleteItem(id),
    onSuccess: async () => {
      setFeedback({ type: 'success', message: '角色删除成功' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['role-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['roles'] }),
        queryClient.invalidateQueries({ queryKey: ['role-runtime'] }),
      ]);
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '角色删除失败') });
    },
  });

  const openCreateModal = useCallback(() => {
    setEditingId(null);
    setFormState(emptyFormState);
    setSelectedPermissionCodes([]);
    setPermissionFilters(defaultPermissionFilters);
    setDraftPermissionFilters(defaultPermissionFilters);
    setModalOpen(true);
  }, []);

  const openEditModal = useCallback(async (id: number) => {
    setLoadingDetail(true);
    try {
      const item = await RoleApi.getItem(id);
      setEditingId(id);
      setFormState(toFormState(item));
      setSelectedPermissionCodes(item.permissionCodes ?? []);
      setPermissionFilters(defaultPermissionFilters);
      setDraftPermissionFilters(defaultPermissionFilters);
      setModalOpen(true);
    } catch (error) {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '角色详情加载失败') });
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const handleDelete = useCallback(
    async (item: RoleItem) => {
      if (typeof item.id !== 'number') {
        setFeedback({ type: 'danger', message: '角色缺少 ID，无法删除' });
        return;
      }
      if (!window.confirm(`确认删除角色 #${item.id} 吗？`)) {
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

      await saveMutation.mutateAsync({
        id: editingId,
        input: {
          code,
          name,
          description: formState.description.trim() || undefined,
          isEnabled: formState.isEnabled,
          permissionCodes: orderedSelectedPermissionCodes,
        },
      });
    },
    [editingId, formState, orderedSelectedPermissionCodes, saveMutation],
  );

  const total = itemsQuery.data?.total ?? 0;
  const totalPages = itemsQuery.data?.totalPages ?? 1;
  const isBusy =
    overviewQuery.isFetching ||
    itemsQuery.isFetching ||
    permissionsQuery.isFetching ||
    runtimePreviewQuery.isFetching ||
    saveMutation.isPending ||
    deleteMutation.isPending ||
    loadingDetail;

  return (
    <div className="d-flex flex-column gap-3">
      <div className="page-card">
        <div className="d-flex flex-column gap-3">
          <div className="d-flex flex-column gap-1">
            <h2 className="m-0">角色管理</h2>
            <p className="text-secondary mb-0">维护角色、角色绑定权限以及运行态菜单树预览。</p>
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
              <label className="form-label" htmlFor="roleKeywordInput">
                关键词
              </label>
              <input
                id="roleKeywordInput"
                className="form-control"
                value={draftFilters.keyword}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    keyword: event.target.value,
                  }))
                }
                placeholder="按 Code、Name 搜索"
              />
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="roleIsEnabledSelect">
                状态
              </label>
              <select
                id="roleIsEnabledSelect"
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
              <button className="btn btn-success ms-auto" type="button" onClick={openCreateModal}>
                新增角色
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
                  <th scope="col">状态</th>
                  <th scope="col">权限绑定</th>
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
                  items.map((item) => {
                    const permissionNames = (item.permissionCodes ?? [])
                      .map(
                        (code) =>
                          permissions.find((current) => current.code === code)?.name ?? code,
                      )
                      .filter(Boolean)
                      .join(', ');
                    return (
                      <tr key={item.code}>
                        <td>{item.id ?? '-'}</td>
                        <td>{item.code}</td>
                        <td>{item.name}</td>
                        <td>
                          <span
                            className={`badge-inline ${item.isEnabled ? 'success' : 'secondary'}`}
                          >
                            {item.isEnabled ? '启用' : '停用'}
                          </span>
                        </td>
                        <td>
                          <div className="pre-wrap">{permissionNames || '-'}</div>
                        </td>
                        <td>{formatDateTime(item.updatedAt)}</td>
                        <td>
                          <div className="actions-cell">
                            <button
                              className="btn btn-outline-primary btn-sm"
                              type="button"
                              onClick={() => {
                                setRuntimeRoleCodeInput(item.code);
                                setRuntimeQueryRoleCode(item.code);
                              }}
                            >
                              运行态
                            </button>
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
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7}>
                      <div className="text-center py-4 text-secondary">暂无角色数据</div>
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

      <div className="page-card">
        <div className="d-flex flex-column gap-3">
          <div className="d-flex justify-content-between align-items-center gap-3">
            <div>
              <h3 className="m-0">运行态预览</h3>
              <p className="text-secondary mb-0">查看角色当前可用的菜单树。</p>
            </div>
            <div className="d-flex gap-2 align-items-center">
              <input
                className="form-control"
                value={runtimeRoleCodeInput}
                onChange={(event) => setRuntimeRoleCodeInput(event.target.value)}
                placeholder="输入角色编码"
              />
              <button
                className="btn btn-outline-success"
                type="button"
                onClick={() => setRuntimeQueryRoleCode(runtimeRoleCodeInput.trim())}
              >
                刷新运行态
              </button>
            </div>
          </div>

          {!runtimeQueryRoleCode ? (
            <div className="table-empty">请输入角色编码查看运行态</div>
          ) : runtimePreviewQuery.isError ? (
            <div className="table-empty">运行态预览加载失败</div>
          ) : runtimePreviewQuery.isFetching ? (
            <div className="table-empty">运行态预览加载中...</div>
          ) : (
            <>
              <div className="summary-panel">
                <div className="summary-panel-title">
                  角色：{runtimePreviewQuery.data?.roleCode ?? runtimeQueryRoleCode}
                </div>
                <div className="summary-panel-desc">运行态返回当前角色可用的菜单树。</div>
              </div>
              <div className="runtime-grid runtime-grid-single">
                <div>
                  <h3 className="runtime-title">菜单树</h3>
                  {renderRuntimeMenuNodes(runtimePreviewQuery.data?.menuTree ?? [])}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <ModalDialog
        open={modalOpen}
        size="lg"
        title={editingId ? `编辑角色：${formState.code}` : '新增角色'}
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
              form="roleForm"
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? '保存中...' : '保存'}
            </button>
          </>
        }
      >
        <form id="roleForm" className="row g-3" onSubmit={(event) => void handleSubmit(event)}>
          <div className="col-md-6">
            <label className="form-label" htmlFor="roleCodeInput">
              Code
            </label>
            <input
              id="roleCodeInput"
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
          <div className="col-md-6">
            <label className="form-label" htmlFor="roleNameInput">
              Name
            </label>
            <input
              id="roleNameInput"
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
            <label className="form-label" htmlFor="roleDescriptionInput">
              Description
            </label>
            <textarea
              id="roleDescriptionInput"
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
            <label className="form-label" htmlFor="roleEnabledInput">
              状态
            </label>
            <select
              id="roleEnabledInput"
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

          <div className="col-12">
            <div className="border rounded-3 p-3 d-flex flex-column gap-3">
              <div className="d-flex flex-column gap-1">
                <div className="fw-semibold">权限绑定</div>
                <div className="text-secondary small">
                  已选 {selectedPermissionCodes.length} 项 / 当前筛选 {filteredPermissions.length}{' '}
                  项 / 全部 {permissions.length} 项
                </div>
              </div>

              <div className="row g-3 align-items-end">
                <div className="col-md-4">
                  <label className="form-label" htmlFor="rolePermissionKeywordInput">
                    权限关键词
                  </label>
                  <input
                    id="rolePermissionKeywordInput"
                    className="form-control"
                    value={draftPermissionFilters.keyword}
                    onChange={(event) =>
                      setDraftPermissionFilters((current) => ({
                        ...current,
                        keyword: event.target.value,
                      }))
                    }
                    placeholder="按权限码、名称、说明搜索"
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label" htmlFor="rolePermissionGroupKeyInput">
                    分组
                  </label>
                  <input
                    id="rolePermissionGroupKeyInput"
                    className="form-control"
                    value={draftPermissionFilters.groupKey}
                    onChange={(event) =>
                      setDraftPermissionFilters((current) => ({
                        ...current,
                        groupKey: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="col-md-2">
                  <label className="form-label" htmlFor="rolePermissionIsEnabledSelect">
                    状态
                  </label>
                  <select
                    id="rolePermissionIsEnabledSelect"
                    className="form-select"
                    value={draftPermissionFilters.isEnabled}
                    onChange={(event) =>
                      setDraftPermissionFilters((current) => ({
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
                <div className="col-md-2 d-flex gap-2">
                  <button
                    className="btn btn-outline-success w-100"
                    type="button"
                    onClick={() => setPermissionFilters(draftPermissionFilters)}
                  >
                    筛选
                  </button>
                  <button
                    className="btn btn-outline-secondary w-100"
                    type="button"
                    onClick={() => {
                      setPermissionFilters(defaultPermissionFilters);
                      setDraftPermissionFilters(defaultPermissionFilters);
                    }}
                  >
                    重置
                  </button>
                </div>
              </div>

              <div className="d-flex flex-wrap gap-2 align-items-center">
                <button
                  className="btn btn-outline-success btn-sm"
                  type="button"
                  onClick={() => {
                    setSelectedPermissionCodes((current) => {
                      const next = new Set(current);
                      filteredPermissions.forEach((item) => next.add(item.code));
                      return permissions
                        .filter((item) => next.has(item.code))
                        .map((item) => item.code);
                    });
                  }}
                >
                  全选当前筛选
                </button>
                <button
                  className="btn btn-outline-secondary btn-sm"
                  type="button"
                  onClick={() => {
                    setSelectedPermissionCodes((current) =>
                      current.filter(
                        (code) => !filteredPermissions.some((item) => item.code === code),
                      ),
                    );
                  }}
                >
                  清空当前筛选
                </button>
              </div>

              <div className="table-responsive">
                <table className="table align-middle mb-0">
                  <thead>
                    <tr>
                      <th scope="col">
                        <input
                          ref={permissionSelectAllRef}
                          className="form-check-input"
                          type="checkbox"
                          onChange={(event) => {
                            if (event.target.checked) {
                              setSelectedPermissionCodes((current) => {
                                const next = new Set(current);
                                filteredPermissions.forEach((item) => next.add(item.code));
                                return permissions
                                  .filter((item) => next.has(item.code))
                                  .map((item) => item.code);
                              });
                              return;
                            }

                            setSelectedPermissionCodes((current) =>
                              current.filter(
                                (code) => !filteredPermissions.some((item) => item.code === code),
                              ),
                            );
                          }}
                        />
                      </th>
                      <th scope="col">权限码</th>
                      <th scope="col">名称</th>
                      <th scope="col">分组</th>
                      <th scope="col">状态</th>
                      <th scope="col">说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPermissions.length ? (
                      filteredPermissions.map((item) => (
                        <tr key={item.code}>
                          <td>
                            <input
                              className="form-check-input"
                              type="checkbox"
                              checked={selectedPermissionCodeSet.has(item.code)}
                              onChange={(event) => {
                                setSelectedPermissionCodes((current) => {
                                  const next = new Set(current);
                                  if (event.target.checked) {
                                    next.add(item.code);
                                  } else {
                                    next.delete(item.code);
                                  }
                                  return permissions
                                    .filter((permission) => next.has(permission.code))
                                    .map((permission) => permission.code);
                                });
                              }}
                            />
                          </td>
                          <td>{item.code}</td>
                          <td>{item.name}</td>
                          <td>{item.groupKey || '-'}</td>
                          <td>
                            <span
                              className={`badge-inline ${item.isEnabled ? 'success' : 'secondary'}`}
                            >
                              {item.isEnabled ? '启用' : '停用'}
                            </span>
                          </td>
                          <td>{item.description || '-'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6}>
                          <div className="text-center py-4 text-secondary">暂无权限数据</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
