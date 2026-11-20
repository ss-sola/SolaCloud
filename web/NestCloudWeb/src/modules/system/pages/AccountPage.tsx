import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AccountApi,
  type AccountItem,
  type AccountSaveInput,
  type UploadProgressSnapshot,
} from '../api/accountApi';
import { RoleApi, type RoleOption } from '../api/roleApi';
import { ModalDialog } from '../components/ModalDialog';
import { SortableColumnHeader } from '../components/SortableColumnHeader';
import { usePageTableState } from '../hooks/usePageTableState';
import { formatDateTime, formatTransferSpeed } from '../utils/formatters';

interface Filters {
  keyword: string;
  isEnabled: string;
}

interface FormState {
  accountName: string;
  displayName: string;
  password: string;
  isEnabled: boolean;
  avatarUrl: string;
  remark: string;
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
  accountName: '',
  displayName: '',
  password: '',
  isEnabled: true,
  avatarUrl: '',
  remark: '',
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function toFormState(item: AccountItem): FormState {
  return {
    accountName: item.accountName,
    displayName: item.displayName,
    password: '',
    isEnabled: item.isEnabled,
    avatarUrl: item.avatarUrl ?? '',
    remark: item.remark ?? '',
  };
}

function getAvatarLabel(
  item:
    | Pick<AccountItem, 'displayName' | 'accountName'>
    | Pick<FormState, 'displayName' | 'accountName'>,
) {
  return item.displayName || item.accountName || '-';
}

function renderAvatar(avatarUrl: string | undefined, label: string) {
  if (avatarUrl) {
    return <img className="account-avatar" src={avatarUrl} alt={label} />;
  }

  return <span className="avatar-fallback">{label.slice(0, 1)}</span>;
}

export function AccountPage() {
  const queryClient = useQueryClient();
  const tableState = usePageTableState({ defaultSort: 'accountName:asc' });
  const roleTableState = usePageTableState({ defaultSort: 'code:asc' });

  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [draftFilters, setDraftFilters] = useState<Filters>(defaultFilters);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formState, setFormState] = useState<FormState>(emptyFormState);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarUploadProgress, setAvatarUploadProgress] = useState(0);
  const [avatarUploadSpeed, setAvatarUploadSpeed] = useState(0);

  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [roleBindingId, setRoleBindingId] = useState<number | null>(null);
  const [roleBindingAccountName, setRoleBindingAccountName] = useState('');
  const [selectedRoleCodes, setSelectedRoleCodes] = useState<string[]>([]);

  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordResetId, setPasswordResetId] = useState<number | null>(null);
  const [passwordResetAccountName, setPasswordResetAccountName] = useState('');
  const [passwordResetValue, setPasswordResetValue] = useState('');

  const accountQuery = useMemo(
    () =>
      tableState.buildQuery({
        keyword: filters.keyword || undefined,
        isEnabled: filters.isEnabled || undefined,
      }),
    [filters, tableState],
  );

  const overviewQuery = useQuery({
    queryKey: ['account-overview'],
    queryFn: () => AccountApi.getOverview(),
  });

  const itemsQuery = useQuery({
    queryKey: ['accounts', accountQuery],
    queryFn: () => AccountApi.listItems(accountQuery),
  });

  const roleOptionsQuery = useQuery({
    queryKey: ['account-role-options'],
    queryFn: () => RoleApi.listOptions(),
  });

  useEffect(() => {
    tableState.updateFromPageResult(itemsQuery.data);
  }, [itemsQuery.data, tableState]);

  const items = useMemo(() => itemsQuery.data?.list ?? [], [itemsQuery.data?.list]);
  const roleOptions = useMemo(() => roleOptionsQuery.data ?? [], [roleOptionsQuery.data]);
  const selectedRoleCodeSet = useMemo(() => new Set(selectedRoleCodes), [selectedRoleCodes]);

  useEffect(() => {
    setSelectedRoleCodes((current) =>
      current.filter((code) => roleOptions.some((item) => item.code === code)),
    );
  }, [roleOptions]);

  const sortedRoleOptions = useMemo(() => {
    const sortField = roleTableState.sortField;
    const sortDirection = roleTableState.sortDirection;
    if (!sortField || !sortDirection) {
      return [...roleOptions];
    }

    const directionFactor = sortDirection === 'desc' ? -1 : 1;
    return [...roleOptions].sort((left, right) => {
      const leftValue = (left as unknown as Record<string, string | undefined>)[sortField] ?? '';
      const rightValue = (right as unknown as Record<string, string | undefined>)[sortField] ?? '';
      return String(leftValue).localeCompare(String(rightValue), 'zh-CN') * directionFactor;
    });
  }, [roleOptions, roleTableState.sortDirection, roleTableState.sortField]);

  const openCreateModal = useCallback(() => {
    setEditingId(null);
    setFormState(emptyFormState);
    setAccountModalOpen(true);
  }, []);
  const saveMutation = useMutation({
    mutationFn: ({ id, input }: { id?: number | null; input: AccountSaveInput }) => {
      if (id) {
        return AccountApi.updateItem(id, input);
      }
      return AccountApi.createItem(input);
    },
    onSuccess: async () => {
      setAccountModalOpen(false);
      setEditingId(null);
      setFeedback({ type: 'success', message: '账号保存成功' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['account-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['accounts'] }),
      ]);
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '账号保存失败') });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => AccountApi.deleteItem(id),
    onSuccess: async () => {
      setFeedback({ type: 'success', message: '账号删除成功' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['account-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['accounts'] }),
      ]);
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '账号删除失败') });
    },
  });

  const roleBindingMutation = useMutation({
    mutationFn: ({ id, roleCodes }: { id: number; roleCodes: string[] }) =>
      AccountApi.updateRoleBindings(id, { roleCodes }),
    onSuccess: async () => {
      setRoleModalOpen(false);
      setRoleBindingId(null);
      setFeedback({ type: 'success', message: '账号角色保存成功' });
      await queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '账号角色保存失败') });
    },
  });

  const passwordMutation = useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) =>
      AccountApi.updatePassword(id, { password }),
    onSuccess: async () => {
      setPasswordModalOpen(false);
      setPasswordResetId(null);
      setPasswordResetValue('');
      setFeedback({ type: 'success', message: '密码重置成功' });
      await queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '密码重置失败') });
    },
  });

  const openEditModal = useCallback(async (id: number) => {
    setLoadingDetail(true);
    try {
      const item = await AccountApi.getItem(id);
      setEditingId(id);
      setFormState(toFormState(item));
      setAccountModalOpen(true);
    } catch (error) {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '账号详情加载失败') });
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const openRoleModal = useCallback(async (id: number) => {
    setLoadingDetail(true);
    try {
      const item = await AccountApi.getItem(id);
      setRoleBindingId(id);
      setRoleBindingAccountName(item.accountName);
      setSelectedRoleCodes(item.roleCodes ?? []);
      setRoleModalOpen(true);
    } catch (error) {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '账号角色加载失败') });
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const openPasswordModal = useCallback((id: number, accountName: string) => {
    setPasswordResetId(id);
    setPasswordResetAccountName(accountName);
    setPasswordResetValue('');
    setPasswordModalOpen(true);
  }, []);

  const handleDelete = useCallback(
    async (item: AccountItem) => {
      if (typeof item.id !== 'number') {
        setFeedback({ type: 'danger', message: '账号缺少 ID，无法删除' });
        return;
      }
      if (!window.confirm(`确认删除账号 #${item.id} 吗？`)) {
        return;
      }
      await deleteMutation.mutateAsync(item.id);
    },
    [deleteMutation],
  );

  const handleAvatarUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }
      if (!file.type.startsWith('image/')) {
        setFeedback({ type: 'danger', message: '只能上传图片作为头像' });
        event.target.value = '';
        return;
      }
      if (avatarUploading) {
        return;
      }

      const uploadConfig = overviewQuery.data?.avatarUpload;
      if (!uploadConfig?.uploadUrl) {
        setFeedback({ type: 'danger', message: '头像上传地址未配置' });
        event.target.value = '';
        return;
      }

      setAvatarUploading(true);
      setAvatarUploadProgress(0);
      setAvatarUploadSpeed(0);
      try {
        const uploaded = await AccountApi.uploadFile(uploadConfig.uploadUrl, {
          file,
          scene: uploadConfig.scene,
          businessType: uploadConfig.businessType,
          isTemporary: uploadConfig.isTemporary ?? false,
          onProgress: (progress: UploadProgressSnapshot) => {
            setAvatarUploadProgress(progress.percent);
            setAvatarUploadSpeed(progress.bytesPerSecond);
          },
        });
        if (!uploaded.url) {
          throw new Error('上传接口未返回文件 URL');
        }
        setFormState((current) => ({
          ...current,
          avatarUrl: uploaded.url ?? '',
        }));
        setFeedback({ type: 'success', message: '头像上传成功' });
      } catch (error) {
        setFeedback({ type: 'danger', message: getErrorMessage(error, '头像上传失败') });
      } finally {
        setAvatarUploading(false);
        setAvatarUploadProgress(0);
        setAvatarUploadSpeed(0);
        event.target.value = '';
      }
    },
    [avatarUploading, overviewQuery.data?.avatarUpload],
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const accountName = formState.accountName.trim();
      const displayName = formState.displayName.trim();
      if (!accountName || !displayName) {
        setFeedback({ type: 'danger', message: '账号名和显示名必填' });
        return;
      }
      const password = formState.password.trim();
      if (!editingId && !password) {
        setFeedback({ type: 'danger', message: '新增账号时密码必填' });
        return;
      }

      const input: AccountSaveInput = {
        accountName,
        displayName,
        ...(password ? { password } : {}),
        isEnabled: formState.isEnabled,
        avatarUrl: formState.avatarUrl.trim() || undefined,
        remark: formState.remark.trim() || undefined,
      };

      await saveMutation.mutateAsync({ id: editingId, input });
    },
    [editingId, formState, saveMutation],
  );

  const handleSaveRoleBindings = useCallback(async () => {
    if (!roleBindingId) {
      return;
    }
    await roleBindingMutation.mutateAsync({
      id: roleBindingId,
      roleCodes: sortedRoleOptions
        .filter((item) => selectedRoleCodeSet.has(item.code))
        .map((item) => item.code),
    });
  }, [roleBindingId, roleBindingMutation, selectedRoleCodeSet, sortedRoleOptions]);

  const handleResetPassword = useCallback(async () => {
    if (!passwordResetId) {
      return;
    }
    if (!passwordResetValue.trim()) {
      setFeedback({ type: 'danger', message: '新密码必填' });
      return;
    }
    await passwordMutation.mutateAsync({
      id: passwordResetId,
      password: passwordResetValue.trim(),
    });
  }, [passwordMutation, passwordResetId, passwordResetValue]);

  const isBusy =
    overviewQuery.isFetching ||
    itemsQuery.isFetching ||
    roleOptionsQuery.isFetching ||
    saveMutation.isPending ||
    deleteMutation.isPending ||
    roleBindingMutation.isPending ||
    passwordMutation.isPending ||
    loadingDetail ||
    avatarUploading;

  const avatarLabel = getAvatarLabel(formState);

  return (
    <div className="page-card">
      <div className="d-flex flex-column gap-3">
        <div className="d-flex flex-column gap-1">
          <h2 className="m-0">账号管理</h2>
          <p className="text-secondary mb-0">维护管理账号、头像、角色绑定与密码重置。</p>
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
            <label className="form-label" htmlFor="accountKeywordInput">
              关键词
            </label>
            <input
              id="accountKeywordInput"
              className="form-control"
              value={draftFilters.keyword}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  keyword: event.target.value,
                }))
              }
              placeholder="按账号名、显示名搜索"
            />
          </div>
          <div className="col-md-3">
            <label className="form-label" htmlFor="accountIsEnabledSelect">
              状态
            </label>
            <select
              id="accountIsEnabledSelect"
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
              新增账号
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
                  label="账号名"
                  field="accountName"
                  sortable
                  sortField={tableState.sortField}
                  sortDirection={tableState.sortDirection}
                  onSort={tableState.toggleSort}
                />
                <SortableColumnHeader
                  label="显示名"
                  field="displayName"
                  sortable
                  sortField={tableState.sortField}
                  sortDirection={tableState.sortDirection}
                  onSort={tableState.toggleSort}
                />
                <th scope="col">状态</th>
                <th scope="col">角色</th>
                <th scope="col">失败次数</th>
                <th scope="col">锁定截止</th>
                <SortableColumnHeader
                  label="最近登录"
                  field="lastLoginAt"
                  sortable
                  sortField={tableState.sortField}
                  sortDirection={tableState.sortDirection}
                  onSort={tableState.toggleSort}
                />
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
                  <tr key={item.accountName}>
                    <td>{item.id ?? '-'}</td>
                    <td>
                      <div className="account-cell">
                        {renderAvatar(item.avatarUrl, getAvatarLabel(item))}
                        <div>{item.accountName}</div>
                      </div>
                    </td>
                    <td>{item.displayName}</td>
                    <td>
                      <span className={`badge-inline ${item.isEnabled ? 'success' : 'secondary'}`}>
                        {item.isEnabled ? '启用' : '停用'}
                      </span>
                    </td>
                    <td>
                      <div className="pre-wrap">{(item.roleCodes ?? []).join(', ') || '-'}</div>
                    </td>
                    <td>{item.failedLoginCount ?? 0}</td>
                    <td>{formatDateTime(item.lockedUntil)}</td>
                    <td>{formatDateTime(item.lastLoginAt)}</td>
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
                          className="btn btn-outline-secondary btn-sm"
                          type="button"
                          disabled={loadingDetail}
                          onClick={() => {
                            if (typeof item.id === 'number') {
                              void openRoleModal(item.id);
                            }
                          }}
                        >
                          角色
                        </button>
                        <button
                          className="btn btn-outline-warning btn-sm"
                          type="button"
                          onClick={() => {
                            if (typeof item.id === 'number') {
                              openPasswordModal(item.id, item.accountName);
                            }
                          }}
                        >
                          重置密码
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
                  <td colSpan={10}>
                    <div className="text-center py-4 text-secondary">暂无管理账号数据</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ModalDialog
        open={accountModalOpen}
        size="lg"
        title={editingId ? `编辑账号：${formState.accountName}` : '新增账号'}
        onClose={() => {
          if (saveMutation.isPending || avatarUploading) {
            return;
          }
          setAccountModalOpen(false);
        }}
        footer={
          <>
            <button
              className="btn btn-outline-secondary"
              type="button"
              disabled={saveMutation.isPending || avatarUploading}
              onClick={() => setAccountModalOpen(false)}
            >
              取消
            </button>
            <button
              className="btn btn-success"
              type="submit"
              form="accountForm"
              disabled={saveMutation.isPending || avatarUploading}
            >
              {saveMutation.isPending ? '保存中...' : '保存'}
            </button>
          </>
        }
      >
        <form id="accountForm" className="row g-3" onSubmit={(event) => void handleSubmit(event)}>
          <div className="col-md-6">
            <label className="form-label" htmlFor="accountNameInput">
              账号名
            </label>
            <input
              id="accountNameInput"
              className="form-control"
              value={formState.accountName}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  accountName: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-md-6">
            <label className="form-label" htmlFor="accountDisplayNameInput">
              显示名
            </label>
            <input
              id="accountDisplayNameInput"
              className="form-control"
              value={formState.displayName}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  displayName: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="accountPasswordInput">
              密码
            </label>
            <input
              id="accountPasswordInput"
              className="form-control"
              type="password"
              value={formState.password}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  password: event.target.value,
                }))
              }
              placeholder={editingId ? '留空表示不修改密码' : '新增账号时必填'}
            />
          </div>
          <div className="col-md-6">
            <label className="form-label" htmlFor="accountEnabledInput">
              状态
            </label>
            <select
              id="accountEnabledInput"
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
          <div className="col-md-6">
            <label className="form-label" htmlFor="accountAvatarUrlInput">
              头像 URL
            </label>
            <input
              id="accountAvatarUrlInput"
              className="form-control"
              value={formState.avatarUrl}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  avatarUrl: event.target.value,
                }))
              }
            />
          </div>
          <div className="col-md-6">
            <label className="form-label" htmlFor="accountAvatarFileInput">
              上传头像
            </label>
            <input
              id="accountAvatarFileInput"
              className="form-control"
              type="file"
              accept="image/*"
              disabled={avatarUploading}
              onChange={(event) => {
                void handleAvatarUpload(event);
              }}
            />
            {avatarUploading ? (
              <div className="mt-2 d-flex flex-column gap-2">
                <div
                  className="progress"
                  role="progressbar"
                  aria-label="头像上传进度"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={avatarUploadProgress}
                >
                  <div
                    className="progress-bar progress-bar-striped progress-bar-animated"
                    style={{ width: `${avatarUploadProgress}%` }}
                  >
                    {avatarUploadProgress}%
                  </div>
                </div>
                <div className="form-text">
                  上传中，当前速度 {formatTransferSpeed(avatarUploadSpeed)}
                  ；若中断后重新选择同一文件会继续上传。
                </div>
              </div>
            ) : (
              <div className="form-text">上传后会自动回填头像 URL；同一文件中断后可继续上传。</div>
            )}
          </div>
          <div className="col-md-6">
            <label className="form-label">头像预览</label>
            <div className="d-flex align-items-center gap-3 border rounded-3 p-3">
              {renderAvatar(formState.avatarUrl, avatarLabel)}
              <div className="text-secondary small">{avatarLabel}</div>
            </div>
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="accountRemarkInput">
              备注
            </label>
            <textarea
              id="accountRemarkInput"
              className="form-control"
              rows={3}
              value={formState.remark}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  remark: event.target.value,
                }))
              }
            />
          </div>
        </form>
      </ModalDialog>

      <ModalDialog
        open={roleModalOpen}
        title={`账号角色：${roleBindingAccountName}`}
        onClose={() => {
          if (roleBindingMutation.isPending) {
            return;
          }
          setRoleModalOpen(false);
        }}
        footer={
          <>
            <button
              className="btn btn-outline-secondary"
              type="button"
              disabled={roleBindingMutation.isPending}
              onClick={() => setRoleModalOpen(false)}
            >
              取消
            </button>
            <button
              className="btn btn-success"
              type="button"
              disabled={roleBindingMutation.isPending}
              onClick={() => void handleSaveRoleBindings()}
            >
              {roleBindingMutation.isPending ? '保存中...' : '保存角色'}
            </button>
          </>
        }
      >
        <div className="d-flex flex-column gap-3">
          <div className="text-secondary small">
            已选 {selectedRoleCodes.length} 项 / 全部 {roleOptions.length} 项
          </div>

          <div className="table-responsive">
            <table className="table align-middle mb-0">
              <thead>
                <tr>
                  <th scope="col">选择</th>
                  <SortableColumnHeader
                    label="角色编码"
                    field="code"
                    sortable
                    sortField={roleTableState.sortField}
                    sortDirection={roleTableState.sortDirection}
                    onSort={roleTableState.toggleSort}
                  />
                  <SortableColumnHeader
                    label="名称"
                    field="name"
                    sortable
                    sortField={roleTableState.sortField}
                    sortDirection={roleTableState.sortDirection}
                    onSort={roleTableState.toggleSort}
                  />
                </tr>
              </thead>
              <tbody>
                {sortedRoleOptions.length ? (
                  sortedRoleOptions.map((item: RoleOption) => (
                    <tr key={item.code}>
                      <td>
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={selectedRoleCodeSet.has(item.code)}
                          onChange={(event) => {
                            setSelectedRoleCodes((current) => {
                              const next = new Set(current);
                              if (event.target.checked) {
                                next.add(item.code);
                              } else {
                                next.delete(item.code);
                              }
                              return sortedRoleOptions
                                .filter((role) => next.has(role.code))
                                .map((role) => role.code);
                            });
                          }}
                        />
                      </td>
                      <td>{item.code}</td>
                      <td>{item.name}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3}>
                      <div className="text-center py-4 text-secondary">暂无角色选项</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </ModalDialog>

      <ModalDialog
        open={passwordModalOpen}
        title={`重置密码：${passwordResetAccountName}`}
        onClose={() => {
          if (passwordMutation.isPending) {
            return;
          }
          setPasswordModalOpen(false);
        }}
        footer={
          <>
            <button
              className="btn btn-outline-secondary"
              type="button"
              disabled={passwordMutation.isPending}
              onClick={() => setPasswordModalOpen(false)}
            >
              取消
            </button>
            <button
              className="btn btn-warning"
              type="button"
              disabled={passwordMutation.isPending}
              onClick={() => void handleResetPassword()}
            >
              {passwordMutation.isPending ? '提交中...' : '确认重置'}
            </button>
          </>
        }
      >
        <div className="d-flex flex-column gap-3">
          <div>
            <label className="form-label" htmlFor="accountPasswordResetInput">
              新密码
            </label>
            <input
              id="accountPasswordResetInput"
              className="form-control"
              type="password"
              value={passwordResetValue}
              onChange={(event) => setPasswordResetValue(event.target.value)}
            />
          </div>
        </div>
      </ModalDialog>
    </div>
  );
}
