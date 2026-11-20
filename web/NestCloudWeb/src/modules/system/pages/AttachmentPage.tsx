import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileApi, type FileItem, type FileQuery } from '../api/fileApi';
import { ModalDialog } from '../components/ModalDialog';
import { PagePagination } from '../components/PagePagination';
import { SortableColumnHeader } from '../components/SortableColumnHeader';
import { usePageTableState } from '../hooks/usePageTableState';
import { formatDateTime, formatFileSize, formatTransferSpeed } from '../utils/formatters';
import { FilePreview } from '../../../shared/components/FilePreview/FilePreview';
import {
  uploadFileWithResume,
  type UploadProgressSnapshot,
} from '../../../shared/api/resumableUploadApi';

interface Filters {
  keyword: string;
  scene: string;
}

interface FeedbackState {
  type: 'success' | 'danger';
  message: string;
}

interface UploadFileState {
  file: File;
  progress: number;
  speed: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  errorMessage?: string;
}

const defaultFilters: Filters = { keyword: '', scene: '' };

/** 上传接口基础路径 */
const FILE_UPLOAD_URL = '/api/file/upload';

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function AttachmentPage() {
  const queryClient = useQueryClient();
  const tableState = usePageTableState({ defaultSort: 'createdAt:desc' });

  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [draftFilters, setDraftFilters] = useState<Filters>(defaultFilters);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  // 上传弹窗状态
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<UploadFileState[]>([]);
  const [uploading, setUploading] = useState(false);

  // 预览弹窗状态
  const [previewItem, setPreviewItem] = useState<FileItem | null>(null);

  // 列表查询
  const fileQuery = useMemo<FileQuery>(
    () =>
      tableState.buildQuery({
        keyword: filters.keyword || undefined,
        scene: filters.scene || undefined,
      }),
    [tableState, filters],
  );

  const listQuery = useQuery({
    queryKey: ['file-list', fileQuery],
    queryFn: () => FileApi.listItems(fileQuery),
  });

  useEffect(() => {
    tableState.updateFromPageResult(listQuery.data);
  }, [listQuery.data, tableState]);

  // 删除
  const deleteMutation = useMutation({
    mutationFn: (id: number) => FileApi.removeItem(id),
    onSuccess: () => {
      setFeedback({ type: 'success', message: '删除成功' });
      queryClient.invalidateQueries({ queryKey: ['file-list'] });
    },
    onError: (error) => {
      setFeedback({ type: 'danger', message: getErrorMessage(error, '删除失败') });
    },
  });

  const handleDelete = useCallback(
    (item: FileItem) => {
      if (!window.confirm(`确认删除文件「${item.originalName}」？`)) {
        return;
      }
      deleteMutation.mutate(item.id);
    },
    [deleteMutation],
  );

  // 搜索提交
  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setFilters({ ...draftFilters });
      tableState.setPage(1);
    },
    [draftFilters, tableState],
  );

  const handleReset = useCallback(() => {
    setDraftFilters(defaultFilters);
    setFilters(defaultFilters);
    tableState.setPage(1);
  }, [tableState]);

  // 上传处理
  const handleFilesSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) {
      return;
    }
    const newItems: UploadFileState[] = Array.from(files).map((file) => ({
      file,
      progress: 0,
      speed: 0,
      status: 'pending' as const,
    }));
    setUploadFiles((prev) => [...prev, ...newItems]);
    e.target.value = '';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) {
      return;
    }
    const newItems: UploadFileState[] = Array.from(files).map((file) => ({
      file,
      progress: 0,
      speed: 0,
      status: 'pending' as const,
    }));
    setUploadFiles((prev) => [...prev, ...newItems]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleStartUpload = useCallback(async () => {
    if (uploading) {
      return;
    }
    setUploading(true);

    for (let i = 0; i < uploadFiles.length; i++) {
      const item = uploadFiles[i];
      if (item.status !== 'pending') {
        continue;
      }
      setUploadFiles((prev) =>
        prev.map((f, idx) => (idx === i ? { ...f, status: 'uploading' } : f)),
      );
      try {
        await uploadFileWithResume({
          uploadUrl: FILE_UPLOAD_URL,
          file: item.file,
          scene: 'attachment',
          businessType: 'attachment',
          onProgress: (progress: UploadProgressSnapshot) => {
            setUploadFiles((prev) =>
              prev.map((f, idx) =>
                idx === i
                  ? { ...f, progress: progress.percent, speed: progress.bytesPerSecond }
                  : f,
              ),
            );
          },
        });
        setUploadFiles((prev) =>
          prev.map((f, idx) => (idx === i ? { ...f, status: 'success', progress: 100 } : f)),
        );
      } catch (error) {
        setUploadFiles((prev) =>
          prev.map((f, idx) =>
            idx === i
              ? { ...f, status: 'error', errorMessage: getErrorMessage(error, '上传失败') }
              : f,
          ),
        );
      }
    }

    setUploading(false);
    queryClient.invalidateQueries({ queryKey: ['file-list'] });
  }, [uploading, uploadFiles, queryClient]);

  const handleCloseUploadModal = useCallback(() => {
    if (uploading) {
      return;
    }
    setUploadModalOpen(false);
    setUploadFiles([]);
  }, [uploading]);

  const handleRemoveUploadFile = useCallback(
    (index: number) => {
      if (uploading) {
        return;
      }
      setUploadFiles((prev) => prev.filter((_, i) => i !== index));
    },
    [uploading],
  );

  const items = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const pageErrorMessage = useMemo(() => {
    return listQuery.error ? getErrorMessage(listQuery.error, '文件列表加载失败') : null;
  }, [listQuery.error]);

  return (
    <div className="page-card">
      {pageErrorMessage && (
        <div className="alert alert-danger mb-3" role="alert">
          {pageErrorMessage}
        </div>
      )}
      {feedback && (
        <div className={`alert alert-${feedback.type} alert-dismissible fade show`} role="alert">
          {feedback.message}
          <button type="button" className="btn-close" onClick={() => setFeedback(null)} />
        </div>
      )}

      {/* 筛选栏 */}
      <form className="row g-2 mb-3 align-items-end" onSubmit={handleSearch}>
        <div className="col-auto">
          <input
            type="text"
            className="form-control form-control-sm"
            placeholder="文件名"
            value={draftFilters.keyword}
            onChange={(e) => setDraftFilters((d) => ({ ...d, keyword: e.target.value }))}
          />
        </div>
        <div className="col-auto">
          <input
            type="text"
            className="form-control form-control-sm"
            placeholder="场景"
            value={draftFilters.scene}
            onChange={(e) => setDraftFilters((d) => ({ ...d, scene: e.target.value }))}
          />
        </div>
        <div className="col-auto">
          <button type="submit" className="btn btn-primary btn-sm">
            搜索
          </button>
        </div>
        <div className="col-auto">
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handleReset}>
            重置
          </button>
        </div>
        <div className="col ms-auto">
          <button
            type="button"
            className="btn btn-success btn-sm w-100"
            onClick={() => setUploadModalOpen(true)}
          >
            上传附件
          </button>
        </div>
      </form>

      {/* 文件列表 */}
      <div className="table-responsive">
        <table className="table align-middle table-hover">
          <thead>
            <tr>
              <SortableColumnHeader
                label="文件名"
                field="originalName"
                sortField={tableState.sortField}
                sortDirection={tableState.sortDirection}
                onSort={tableState.toggleSort}
              />
              <th>类型</th>
              <SortableColumnHeader
                label="大小"
                field="size"
                sortField={tableState.sortField}
                sortDirection={tableState.sortDirection}
                onSort={tableState.toggleSort}
              />
              <th>场景</th>
              <SortableColumnHeader
                label="上传时间"
                field="createdAt"
                sortField={tableState.sortField}
                sortDirection={tableState.sortDirection}
                onSort={tableState.toggleSort}
              />
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="text-break" style={{ maxWidth: '300px' }}>
                  {item.originalName}
                </td>
                <td>
                  <span className="badge bg-secondary">{item.extension}</span>
                </td>
                <td>{formatFileSize(item.size)}</td>
                <td>{item.scene || '-'}</td>
                <td>{formatDateTime(item.createdAt)}</td>
                <td>
                  <div className="d-flex gap-2">
                    <button
                      type="button"
                      className="btn btn-outline-primary btn-sm"
                      onClick={() => setPreviewItem(item)}
                    >
                      预览
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-danger btn-sm"
                      onClick={() => handleDelete(item)}
                      disabled={deleteMutation.isPending}
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!listQuery.isLoading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-muted py-4">
                  暂无数据
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
        totalPages={listQuery.data?.totalPages ?? 0}
        onPageChange={tableState.setPage}
        onPageSizeChange={tableState.setPageSize}
      />

      {/* 上传弹窗 */}
      <ModalDialog
        open={uploadModalOpen}
        title="上传附件"
        size="lg"
        onClose={handleCloseUploadModal}
      >
        <div className="p-3">
          {/* 拖拽区域 */}
          <div
            className="border border-2 border-dashed rounded p-5 text-center mb-3"
            style={{ cursor: 'pointer' }}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => document.getElementById('attachment-file-input')?.click()}
          >
            <div className="text-muted">
              <div style={{ fontSize: '2.5rem' }}>+</div>
              <div>拖拽文件到此处，或点击选择文件</div>
            </div>
            <input
              id="attachment-file-input"
              type="file"
              multiple
              className="d-none"
              onChange={handleFilesSelected}
            />
          </div>

          {/* 文件队列 */}
          {uploadFiles.length > 0 && (
            <div className="list-group mb-3">
              {uploadFiles.map((item, index) => (
                <div key={`${item.file.name}-${index}`} className="list-group-item">
                  <div className="d-flex justify-content-between align-items-center mb-1">
                    <span className="text-break me-2" style={{ maxWidth: '60%' }}>
                      {item.file.name}
                    </span>
                    <span className="text-muted small">{formatFileSize(item.file.size)}</span>
                    {item.status === 'pending' && !uploading && (
                      <button
                        type="button"
                        className="btn-close btn-sm ms-2"
                        onClick={() => handleRemoveUploadFile(index)}
                      />
                    )}
                  </div>
                  {(item.status === 'uploading' || item.status === 'success') && (
                    <div className="progress" style={{ height: '6px' }}>
                      <div
                        className={`progress-bar ${item.status === 'success' ? 'bg-success' : 'progress-bar-striped progress-bar-animated'}`}
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  )}
                  {item.status === 'uploading' && item.speed > 0 && (
                    <div className="text-muted small mt-1">
                      {item.progress.toFixed(1)}% - {formatTransferSpeed(item.speed)}
                    </div>
                  )}
                  {item.status === 'success' && (
                    <div className="text-success small mt-1">上传成功</div>
                  )}
                  {item.status === 'error' && (
                    <div className="text-danger small mt-1">{item.errorMessage}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="d-flex justify-content-end gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleCloseUploadModal}
              disabled={uploading}
            >
              关闭
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleStartUpload}
              disabled={uploading || uploadFiles.filter((f) => f.status === 'pending').length === 0}
            >
              {uploading ? '上传中...' : '开始上传'}
            </button>
          </div>
        </div>
      </ModalDialog>

      {/* 预览弹窗 */}
      <ModalDialog
        open={previewItem !== null}
        title={previewItem?.originalName ?? '文件预览'}
        size="xl"
        onClose={() => setPreviewItem(null)}
      >
        {previewItem && (
          <FilePreview
            url={previewItem.previewUrl || previewItem.url}
            fileName={previewItem.originalName}
            extension={previewItem.extension}
            mimeType={previewItem.mimeType}
            fileId={previewItem.id}
            isExtracted={previewItem.isExtracted}
            basePreviewUrl={
              previewItem.isExtracted ? previewItem.url.replace(/\.[^.]+$/, '') : undefined
            }
          />
        )}
      </ModalDialog>
    </div>
  );
}
