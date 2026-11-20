import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../../app/state/authStore';
import { getAllRoutes, getRouteByName } from '../../../app/routes/appRoutes';
import { RouteRegistry } from '../../../app/routes/routeRegistry';
import { resolveMenuIconUrl, menuIconKeys } from '../../../shared/menuIconResolver';
import {
  MenuRouteApi,
  type MenuRouteCreateInput,
  type MenuRouteItem,
  type MenuRouteSaveInput,
} from '../api/menuRouteApi';
import { PermissionApi, type PermissionItem } from '../api/permissionApi';
import { ModalDialog } from '../components/ModalDialog';
import { SortableColumnHeader } from '../components/SortableColumnHeader';
import { usePageTableState } from '../hooks/usePageTableState';
import { formatDateTime } from '../utils/formatters';
import { MenuRouteTreeUtil } from '../utils/MenuRouteTreeUtil';

interface Filters {
  keyword: string;
  parentId: string;
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
  parentId: string;
  routeName: string;
  redirect: string;
  icon: string;
  sort: string;
  isEnabled: boolean;
  isGroup: boolean;
  hideHeader: boolean;
  hideRoute: boolean;
  routeRoot: string;
}

interface FeedbackState {
  type: 'success' | 'danger';
  message: string;
}

const defaultFilters: Filters = {
  keyword: '',
  parentId: '',
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
  parentId: '',
  routeName: '',
  redirect: '',
  icon: '',
  sort: '0',
  isEnabled: true,
  isGroup: false,
  hideHeader: false,
  hideRoute: false,
  routeRoot: '',
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function toFormState(item: MenuRouteItem): FormState {
  return {
    code: item.code,
    name: item.name,
    parentId: item.parentId ? String(item.parentId) : '',
    routeName: item.routeName ?? '',
    redirect: item.redirect ?? '',
    icon: item.icon ?? '',
    sort: String(item.sort ?? 0),
    isEnabled: item.isEnabled,
    isGroup: item.isGroup,
    hideHeader: item.hideHeader,
    hideRoute: item.hideRoute,
    routeRoot: item.routeRoot ?? '',
  };
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

export function MenuRoutePage() {
  const queryClient = useQueryClient();
  const loadCurrentAccount = useAuthStore((state) => state.loadCurrentAccount);
  const tableState = usePageTableState({ defaultSort: 'sort:asc' });
  const tableSelectAllRef = useRef<HTMLInputElement | null>(null);
  const permissionSelectAllRef = useRef<HTMLInputElement | null>(null);

  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [draftFilters, setDraftFilters] = useState<Filters>(defaultFilters);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [collapsedIds, setCollapsedIds] = useState<number[]>([]);
  const [sortDrafts, setSortDrafts] = useState<Record<number, string>>({});

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formState, setFormState] = useState<FormState>(emptyFormState);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const iconPickerRef = useRef<HTMLDivElement | null>(null);

  const [permissionFilters, setPermissionFilters] =
    useState<PermissionFilters>(defaultPermissionFilters);
  const [draftPermissionFilters, setDraftPermissionFilters] =
    useState<PermissionFilters>(defaultPermissionFilters);
  const [selectedPermissionCodes, setSelectedPermissionCodes] = useState<string[]>([]);

  const listQuery = useMemo(
    () => ({
      keyword: filters.keyword || undefined,
      parentId: filters.parentId || undefined,
      isEnabled: filters.isEnabled || undefined,
    }),
    [filters],
  );

  const overviewQuery = useQuery({
    queryKey: ['menu-route-overview'],
    queryFn: () => MenuRouteApi.getOverview(),
  });

  const itemsQuery = useQuery({
    queryKey: ['menu-routes', listQuery],
    queryFn: () => MenuRouteApi.listItems(listQuery),
  });

  const permissionsQuery = useQuery({
    queryKey: ['menu-route-permissions'],
    queryFn: () => PermissionApi.listItems({ pageNum: 1, pageSize: 100, sort: 'code:asc' }),
  });

  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const permissions = useMemo(
    () => permissionsQuery.data?.list ?? [],
    [permissionsQuery.data?.list],
  );

  useEffect(() => {
    const itemIds = new Set(items.map((item) => item.id));
    setCollapsedIds((current) => current.filter((id) => itemIds.has(id)));
    setSelectedIds((current) => current.filter((id) => itemIds.has(id)));
    setSortDrafts(Object.fromEntries(items.map((item) => [item.id, String(item.sort ?? 0)])));
  }, [items]);

  useEffect(() => {
    if (filters.parentId && !items.some((item) => String(item.id) === filters.parentId)) {
      setFilters((current) => ({ ...current, parentId: '' }));
      setDraftFilters((current) => ({ ...current, parentId: '' }));
    }
  }, [filters.parentId, items]);

  const collapsedIdSet = useMemo(() => new Set(collapsedIds), [collapsedIds]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedPermissionCodeSet = useMemo(
    () => new Set(selectedPermissionCodes),
    [selectedPermissionCodes],
  );

  const treeRows = useMemo(
    () =>
      MenuRouteTreeUtil.buildRows(
        items,
        collapsedIdSet,
        tableState.sortField,
        tableState.sortDirection,
      ),
    [collapsedIdSet, items, tableState.sortDirection, tableState.sortField],
  );

  const visibleIds = useMemo(() => treeRows.map((row) => row.item.id), [treeRows]);
  const visibleIdSet = useMemo(() => new Set(visibleIds), [visibleIds]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => visibleIdSet.has(id)));
  }, [visibleIdSet]);

  const parentFilterOptions = useMemo(
    () =>
      MenuRouteTreeUtil.buildParentOptions(
        items,
        undefined,
        tableState.sortField,
        tableState.sortDirection,
      ),
    [items, tableState.sortDirection, tableState.sortField],
  );

  const parentFormOptions = useMemo(
    () =>
      MenuRouteTreeUtil.buildParentOptions(
        items,
        editingId ?? undefined,
        tableState.sortField,
        tableState.sortDirection,
      ),
    [editingId, items, tableState.sortDirection, tableState.sortField],
  );

  const filteredPermissions = useMemo(
    () => permissions.filter((item) => matchesPermissionFilter(item, permissionFilters)),
    [permissionFilters, permissions],
  );

  const orderedSelectedPermissionCodes = useMemo(
    () =>
      permissions
        .filter((item) => selectedPermissionCodeSet.has(item.code))
        .map((item) => item.code),
    [permissions, selectedPermissionCodeSet],
  );

  useEffect(() => {
    setSelectedPermissionCodes((current) =>
      current.filter((code) => permissions.some((item) => item.code === code)),
    );
  }, [permissions]);

  useEffect(() => {
    if (!iconPickerRef.current || !iconPickerOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (iconPickerRef.current && !iconPickerRef.current.contains(event.target as Node)) {
        setIconPickerOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [iconPickerOpen]);

  useEffect(() => {
    if (!tableSelectAllRef.current) {
      return;
    }

    const selectedVisibleCount = visibleIds.filter((id) => selectedIdSet.has(id)).length;
    tableSelectAllRef.current.checked =
      !!visibleIds.length && selectedVisibleCount === visibleIds.length;
    tableSelectAllRef.current.indeterminate =
      selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length;
  }, [selectedIdSet, visibleIds]);

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

  const saveMutation = useMutation({
    mutationFn: async (payload: {
      id?: number | null;
      input: MenuRouteCreateInput | MenuRouteSaveInput;
    }) => {
      if (payload.id) {
        return MenuRouteApi.updateItem(payload.id, payload.input as MenuRouteSaveInput);
      }
      return MenuRouteApi.createItem(payload.input as MenuRouteCreateInput);
    },
    onSuccess: async () => {
      setModalOpen(false);
      setEditingId(null);
      setFeedback({ type: 'success', message: '菜单路由保存成功' });
      setSelectedIds([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['menu-routes'] }),
        queryClient.invalidateQueries({ queryKey: ['menu-route-overview'] }),
        loadCurrentAccount(),
      ]);
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '菜单路由保存失败') });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => MenuRouteApi.deleteItem(id),
    onSuccess: async () => {
      setFeedback({ type: 'success', message: '菜单路由删除成功' });
      setSelectedIds([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['menu-routes'] }),
        queryClient.invalidateQueries({ queryKey: ['menu-route-overview'] }),
        loadCurrentAccount(),
      ]);
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '菜单路由删除失败') });
    },
  });

  const batchStatusMutation = useMutation({
    mutationFn: ({ ids, isEnabled }: { ids: number[]; isEnabled: boolean }) =>
      MenuRouteApi.updateBatchStatus({ ids, isEnabled }),
    onSuccess: async (_, variables) => {
      setFeedback({
        type: 'success',
        message: variables.isEnabled ? '批量启用成功' : '批量停用成功',
      });
      setSelectedIds([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['menu-routes'] }),
        loadCurrentAccount(),
      ]);
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '批量状态更新失败') });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (items: Array<{ id: number; sort: number }>) => MenuRouteApi.reorder({ items }),
    onSuccess: async () => {
      setFeedback({ type: 'success', message: '排序调整成功' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['menu-routes'] }),
        loadCurrentAccount(),
      ]);
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '排序调整失败') });
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
      const item = await MenuRouteApi.getItem(id);
      setEditingId(id);
      setFormState(toFormState(item));
      setSelectedPermissionCodes(item.permissionCodes ?? []);
      setPermissionFilters(defaultPermissionFilters);
      setDraftPermissionFilters(defaultPermissionFilters);
      setModalOpen(true);
    } catch (error) {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '菜单详情加载失败') });
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const handleDelete = useCallback(
    async (id: number) => {
      if (!window.confirm(`确认删除菜单路由 #${id} 吗？`)) {
        return;
      }
      await deleteMutation.mutateAsync(id);
    },
    [deleteMutation],
  );

  const handleBatchStatus = useCallback(
    async (isEnabled: boolean) => {
      if (!selectedIds.length) {
        setFeedback({ type: 'danger', message: '请先选择菜单项' });
        return;
      }
      await batchStatusMutation.mutateAsync({ ids: selectedIds, isEnabled });
    },
    [batchStatusMutation, selectedIds],
  );

  const handleSubmitReorder = useCallback(async () => {
    const nextItems = treeRows
      .map(({ item }) => {
        const sortText = String(sortDrafts[item.id] ?? item.sort ?? 0).trim();
        const sort = Number(sortText);
        if (!Number.isFinite(sort) || sort < 0) {
          return null;
        }
        return { id: item.id, sort };
      })
      .filter((item): item is { id: number; sort: number } => !!item);

    if (!nextItems.length) {
      setFeedback({ type: 'danger', message: '暂无可提交的排序数据' });
      return;
    }

    if (nextItems.length !== treeRows.length) {
      setFeedback({ type: 'danger', message: '排序值必须为大于等于 0 的数字' });
      return;
    }

    await reorderMutation.mutateAsync(nextItems);
  }, [reorderMutation, sortDrafts, treeRows]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const code = formState.code.trim();
      const name = formState.name.trim();
      if ((!editingId && !code) || !name) {
        setFeedback({ type: 'danger', message: 'Code、Name 必填' });
        return;
      }

      const sort = Number(formState.sort.trim() || '0');
      if (!Number.isFinite(sort) || sort < 0) {
        setFeedback({ type: 'danger', message: 'Sort 必须为大于等于 0 的数字' });
        return;
      }

      const payload: MenuRouteSaveInput = {
        name,
        parentId: formState.parentId ? Number(formState.parentId) : undefined,
        routeName: formState.routeName.trim() || undefined,
        redirect: formState.redirect.trim() || undefined,
        icon: formState.icon.trim() || undefined,
        sort,
        isEnabled: formState.isEnabled,
        isGroup: formState.isGroup,
        hideHeader: formState.hideHeader,
        hideRoute: formState.hideRoute,
        routeRoot: formState.routeRoot.trim() || undefined,
        permissionCodes: orderedSelectedPermissionCodes,
      };

      if (editingId) {
        await saveMutation.mutateAsync({ id: editingId, input: payload });
        return;
      }

      await saveMutation.mutateAsync({
        input: {
          code,
          ...payload,
        },
      });
    },
    [editingId, formState, orderedSelectedPermissionCodes, saveMutation],
  );

  const formIconUrl = useMemo(() => resolveMenuIconUrl(formState.icon), [formState.icon]);
  const filteredPermissionCount = filteredPermissions.length;
  const selectedFilteredPermissionCount = filteredPermissions.filter((item) =>
    selectedPermissionCodeSet.has(item.code),
  ).length;
  const isBusy =
    overviewQuery.isFetching ||
    itemsQuery.isFetching ||
    permissionsQuery.isFetching ||
    saveMutation.isPending ||
    deleteMutation.isPending ||
    batchStatusMutation.isPending ||
    reorderMutation.isPending ||
    loadingDetail;

  return (
    <div className="d-flex flex-column gap-3">
      <div className="page-card">
        <div className="d-flex flex-column gap-3">
          <div className="d-flex flex-column gap-1">
            <h2 className="m-0">菜单路由管理</h2>
            <p className="text-secondary mb-0">
              维护运行时菜单树、组件绑定、图标名称、权限码与排序规则。
            </p>
          </div>

          {feedback ? (
            <div className={`alert alert-${feedback.type} mb-0`}>{feedback.message}</div>
          ) : null}

          <form
            className="row g-3 align-items-end"
            onSubmit={(event) => {
              event.preventDefault();
              setFeedback(null);
              setSelectedIds([]);
              setFilters(draftFilters);
            }}
          >
            <div className="col-md-4">
              <label className="form-label" htmlFor="menuRouteKeywordInput">
                关键词
              </label>
              <input
                id="menuRouteKeywordInput"
                className="form-control"
                value={draftFilters.keyword}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    keyword: event.target.value,
                  }))
                }
                placeholder="按名称、Code、Path 搜索"
              />
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="menuRouteParentIdInput">
                父级菜单
              </label>
              <select
                id="menuRouteParentIdInput"
                className="form-select"
                value={draftFilters.parentId}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    parentId: event.target.value,
                  }))
                }
              >
                <option value="">全部</option>
                {parentFilterOptions.map((option) => (
                  <option key={option.id} value={String(option.id)}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label" htmlFor="menuRouteIsEnabledSelect">
                状态
              </label>
              <select
                id="menuRouteIsEnabledSelect"
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
            <div className="col-md-3 d-flex gap-2">
              <button className="btn btn-success" type="submit" disabled={isBusy}>
                查询
              </button>
              <button
                className="btn btn-outline-secondary"
                type="button"
                onClick={() => {
                  setDraftFilters(defaultFilters);
                  setFilters(defaultFilters);
                  setSelectedIds([]);
                }}
              >
                重置
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="page-card">
        <div className="d-flex flex-column gap-3">
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
            <div>
              <h3 className="m-0">菜单树</h3>
              <p className="text-secondary mb-0">
                已选 {selectedIds.length} 项，可批量启停并提交当前可见节点排序。
              </p>
            </div>
            <div className="d-flex flex-wrap gap-2">
              <button className="btn btn-success btn-sm" type="button" onClick={openCreateModal}>
                新增菜单
              </button>
              <button
                className="btn btn-outline-success btn-sm"
                type="button"
                disabled={!selectedIds.length || batchStatusMutation.isPending}
                onClick={() => {
                  void handleBatchStatus(true);
                }}
              >
                批量启用
              </button>
              <button
                className="btn btn-outline-warning btn-sm"
                type="button"
                disabled={!selectedIds.length || batchStatusMutation.isPending}
                onClick={() => {
                  void handleBatchStatus(false);
                }}
              >
                批量停用
              </button>
              <button
                className="btn btn-success btn-sm"
                type="button"
                disabled={!treeRows.length || reorderMutation.isPending}
                onClick={() => {
                  void handleSubmitReorder();
                }}
              >
                提交排序
              </button>
            </div>
          </div>

          <div className="table-responsive">
            <table className="table align-middle table-sm">
              <thead>
                <tr>
                  <th scope="col" className="text-nowrap" style={{ width: 40 }}>
                    <input
                      ref={tableSelectAllRef}
                      className="form-check-input"
                      type="checkbox"
                      onChange={(event) => {
                        setSelectedIds(event.target.checked ? visibleIds : []);
                      }}
                    />
                  </th>
                  <th scope="col" className="text-nowrap text-truncate">
                    菜单名称
                  </th>
                  <th scope="col" className="text-nowrap text-truncate">
                    路由路径
                  </th>
                  <th scope="col" className="text-nowrap text-truncate" style={{ maxWidth: 200 }}>
                    权限码
                  </th>
                  <th scope="col" className="text-nowrap text-truncate">
                    图标
                  </th>
                  <th scope="col" className="text-nowrap text-truncate">
                    状态
                  </th>
                  <th scope="col" className="text-nowrap text-truncate">
                    隐藏
                  </th>
                  <th scope="col" className="text-nowrap" style={{ width: 80 }}>
                    Sort
                  </th>
                  <th scope="col" className="text-nowrap text-truncate" style={{ width: 100 }}>
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {treeRows.length ? (
                  treeRows.map(({ item, depth, hasChildren, collapsed }) => {
                    const iconUrl = resolveMenuIconUrl(item.icon);
                    return (
                      <tr key={item.id}>
                        <td className="text-nowrap px-2">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={selectedIdSet.has(item.id)}
                            onChange={(event) => {
                              setSelectedIds((current) => {
                                const next = new Set(current);
                                if (event.target.checked) {
                                  next.add(item.id);
                                } else {
                                  next.delete(item.id);
                                }
                                return [...next];
                              });
                            }}
                          />
                        </td>
                        <td className="text-nowrap text-truncate" title={item.name}>
                          <div
                            className="tree-table-cell"
                            style={{ ['--tree-depth' as string]: depth }}
                          >
                            {hasChildren ? (
                              <button
                                className="tree-table-toggle"
                                type="button"
                                aria-expanded={!collapsed}
                                onClick={() => {
                                  setCollapsedIds((current) =>
                                    current.includes(item.id)
                                      ? current.filter((value) => value !== item.id)
                                      : [...current, item.id],
                                  );
                                }}
                              >
                                {collapsed ? '▸' : '▾'}
                              </button>
                            ) : (
                              <span className="tree-table-toggle-placeholder" />
                            )}
                            <span
                              className="text-truncate d-inline-block"
                              style={{ maxWidth: 200 }}
                            >
                              {item.name}
                            </span>
                          </div>
                        </td>
                        <td
                          className="text-nowrap text-truncate"
                          title={
                            item.routeName ? (getRouteByName(item.routeName)?.path ?? '-') : '-'
                          }
                        >
                          <code className="text-body-secondary small">
                            {item.routeName ? (getRouteByName(item.routeName)?.path ?? '-') : '-'}
                          </code>
                        </td>
                        <td className="text-nowrap" style={{ maxWidth: 200, overflow: 'hidden' }}>
                          <div
                            className="text-truncate"
                            title={item.permissionCodes.join(', ') || '-'}
                          >
                            {item.permissionCodes.join(', ') || '-'}
                          </div>
                        </td>
                        <td className="text-nowrap text-truncate" title={item.icon || undefined}>
                          {item.icon && iconUrl ? (
                            <img src={iconUrl} alt="" width={20} height={20} title={item.icon} />
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="text-nowrap">
                          <span
                            className={`badge-inline ${item.isEnabled ? 'success' : 'secondary'}`}
                          >
                            {item.isEnabled ? '启用' : '停用'}
                          </span>
                        </td>
                        <td className="text-nowrap">{item.hideRoute ? '隐藏' : '显示'}</td>
                        <td className="text-nowrap">
                          <input
                            className="form-control form-control-sm"
                            type="number"
                            min={0}
                            value={sortDrafts[item.id] ?? String(item.sort ?? 0)}
                            onChange={(event) =>
                              setSortDrafts((current) => ({
                                ...current,
                                [item.id]: event.target.value,
                              }))
                            }
                          />
                        </td>
                        <td className="text-nowrap">
                          <div className="actions-cell" style={{ flexWrap: 'nowrap', gap: 4 }}>
                            <button
                              className="btn btn-outline-success btn-sm"
                              type="button"
                              disabled={loadingDetail}
                              onClick={() => {
                                void openEditModal(item.id);
                              }}
                            >
                              编辑
                            </button>
                            <button
                              className="btn btn-outline-danger btn-sm"
                              type="button"
                              disabled={deleteMutation.isPending}
                              onClick={() => {
                                void handleDelete(item.id);
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
                    <td colSpan={9}>
                      <div className="text-center py-4 text-secondary">暂无菜单路由数据</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ModalDialog
        open={modalOpen}
        size="xl"
        title={editingId ? `编辑菜单：${formState.name || formState.code}` : '新增菜单路由'}
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
              form="menuRouteForm"
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? '保存中...' : '保存'}
            </button>
          </>
        }
      >
        <form id="menuRouteForm" className="row g-3" onSubmit={(event) => void handleSubmit(event)}>
          <div className="col-md-6">
            <label className="form-label" htmlFor="menuRouteCodeInput">
              Code
            </label>
            <input
              id="menuRouteCodeInput"
              className="form-control"
              value={formState.code}
              readOnly={!!editingId}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  code: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-md-6">
            <label className="form-label" htmlFor="menuRouteNameInput">
              名称
            </label>
            <input
              id="menuRouteNameInput"
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
          <div className="col-md-6">
            <label className="form-label" htmlFor="menuRouteParentIdFormInput">
              父级菜单
            </label>
            <select
              id="menuRouteParentIdFormInput"
              className="form-select"
              value={formState.parentId}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  parentId: event.target.value,
                }))
              }
            >
              <option value="">顶级菜单</option>
              {parentFormOptions.map((option) => (
                <option key={option.id} value={String(option.id)}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-6">
            <label className="form-label" htmlFor="menuRouteRouteNameInput">
              路由名称（routeName）
            </label>
            <select
              id="menuRouteRouteNameInput"
              className="form-select"
              value={formState.routeName}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  routeName: event.target.value,
                }))
              }
            >
              <option value="">— 分组节点，无路由 —</option>
              {getAllRoutes().map((route) => (
                <option key={route.name} value={route.name}>
                  {route.name} — {route.meta.title} ({route.path})
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-6">
            <label className="form-label" htmlFor="menuRouteRedirectInput">
              Redirect
            </label>
            <input
              id="menuRouteRedirectInput"
              className="form-control"
              value={formState.redirect}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  redirect: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-md-6">
            <label className="form-label" htmlFor="menuRouteIconInput">
              Icon
            </label>
            <div className="position-relative">
              <button
                type="button"
                className="btn btn-outline-secondary d-flex align-items-center justify-content-center"
                style={{
                  width: 48,
                  height: 48,
                  padding: 0,
                  borderRadius: 8,
                  border: '2px solid #dee2e6',
                }}
                aria-expanded={iconPickerOpen}
                aria-haspopup="listbox"
                onClick={() => setIconPickerOpen((v) => !v)}
              >
                {formIconUrl ? (
                  <img src={formIconUrl} alt="" width={24} height={24} />
                ) : (
                  <span className="text-secondary" style={{ fontSize: 22, lineHeight: 1 }}>
                    ＋
                  </span>
                )}
              </button>
              {iconPickerOpen && (
                <>
                  <div className="icon-picker-backdrop" onClick={() => setIconPickerOpen(false)} />
                  <div
                    ref={iconPickerRef}
                    className="icon-picker-popover"
                    role="listbox"
                    aria-label="图标选择"
                  >
                    <div className="icon-picker-grid">
                      {menuIconKeys.map((key) => {
                        const url = resolveMenuIconUrl(key);
                        const active = formState.icon === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            className={`icon-picker-item${active ? ' active' : ''}`}
                            onClick={() => {
                              setFormState((current) => ({ ...current, icon: key }));
                              setIconPickerOpen(false);
                            }}
                          >
                            {url ? <img src={url} alt={key} width={28} height={28} /> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="col-md-3">
            <label className="form-label" htmlFor="menuRouteSortInput">
              Sort
            </label>
            <input
              id="menuRouteSortInput"
              className="form-control"
              type="number"
              min={0}
              value={formState.sort}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  sort: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-md-3">
            <label className="form-label" htmlFor="menuRouteEnabledInput">
              状态
            </label>
            <select
              id="menuRouteEnabledInput"
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
          <div className="col-md-3">
            <label className="form-label" htmlFor="menuRouteRouteRootInput">
              RouteRoot
            </label>
            <input
              id="menuRouteRouteRootInput"
              className="form-control"
              value={formState.routeRoot}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  routeRoot: event.target.value,
                }))
              }
              placeholder="如 system"
            />
          </div>
          <div className="col-md-3 d-flex align-items-end gap-3">
            <div className="form-check">
              <input
                id="menuRouteIsGroupInput"
                className="form-check-input"
                type="checkbox"
                checked={formState.isGroup}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    isGroup: event.target.checked,
                  }))
                }
              />
              <label className="form-check-label" htmlFor="menuRouteIsGroupInput">
                分组
              </label>
            </div>
            <div className="form-check">
              <input
                id="menuRouteHideHeaderInput"
                className="form-check-input"
                type="checkbox"
                checked={formState.hideHeader}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    hideHeader: event.target.checked,
                  }))
                }
              />
              <label className="form-check-label" htmlFor="menuRouteHideHeaderInput">
                隐藏头
              </label>
            </div>
            <div className="form-check">
              <input
                id="menuRouteHideRouteInput"
                className="form-check-input"
                type="checkbox"
                checked={formState.hideRoute}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    hideRoute: event.target.checked,
                  }))
                }
              />
              <label className="form-check-label" htmlFor="menuRouteHideRouteInput">
                隐藏路由
              </label>
            </div>
          </div>

          <div className="col-12">
            <div className="border rounded-3 p-3 d-flex flex-column gap-3">
              <div className="d-flex flex-column gap-1">
                <div className="fw-semibold">权限绑定</div>
                <div className="text-secondary small">
                  已选 {selectedPermissionCodes.length} 项 / 当前筛选 {filteredPermissionCount} 项 /
                  全部 {permissions.length} 项
                </div>
              </div>

              <div className="row g-3 align-items-end">
                <div className="col-md-4">
                  <label className="form-label" htmlFor="menuRoutePermissionKeywordInput">
                    权限关键词
                  </label>
                  <input
                    id="menuRoutePermissionKeywordInput"
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
                  <label className="form-label" htmlFor="menuRoutePermissionGroupKeyInput">
                    分组
                  </label>
                  <input
                    id="menuRoutePermissionGroupKeyInput"
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
                  <label className="form-label" htmlFor="menuRoutePermissionIsEnabledSelect">
                    状态
                  </label>
                  <select
                    id="menuRoutePermissionIsEnabledSelect"
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
                <span className="text-secondary small">
                  当前筛选已选 {selectedFilteredPermissionCount} 项
                </span>
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
