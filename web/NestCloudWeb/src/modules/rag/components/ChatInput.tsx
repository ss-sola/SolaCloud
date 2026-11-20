import { useCallback, useRef, useState } from 'react';
import type { SimilarQueryRecommendation } from '../types/rag.types';
import { useToastStore } from '../../../shared/state/toastStore';
import styles from './ChatInput.module.css';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const ALLOWED_MIME_TYPES = new Set([
  // 文本型
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/csv',
  // 图片
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  // 音频
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/mp4',
  // 视频
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
]);

/** 已上传文件信息 */
export interface UploadedFileInfo {
  id: number;
  url: string;
  name: string;
  size: number;
  mimeType: string;
}

interface ChatInputProps {
  onSend: (params: { query: string; fileUrls: string[] }) => void;
  disabled?: boolean;
  onCancel?: () => void;
  recommendations?: SimilarQueryRecommendation[];
  onSelectRecommendation?(rec: SimilarQueryRecommendation): void;
  /** 输入变化回调，用于触发推荐搜索（调用方自行实现防抖） */
  onChange?(value: string): void;
  /** 文件选择后回调，由父组件执行上传 */
  onFilesSelected?(files: File[]): void;
  /** 已上传完成的文件列表 */
  uploadedFiles?: UploadedFileInfo[];
  /** 设置已上传文件列表（用于追加） */
  setUploadedFiles?: React.Dispatch<React.SetStateAction<UploadedFileInfo[]>>;
}

export function ChatInput({
  onSend,
  disabled,
  onCancel,
  recommendations,
  onSelectRecommendation,
  onChange,
  onFilesSelected,
  uploadedFiles = [],
  setUploadedFiles,
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addToast = useToastStore((s) => s.addToast);

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, []);

  const formatFileSize = useCallback((bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }, []);

  const validateFile = useCallback((file: File): string | null => {
    if (file.size > MAX_FILE_SIZE) {
      return `文件 "${file.name}" 超过 25 MB 限制`;
    }
    if (file.size === 0) {
      return `文件 "${file.name}" 大小无效`;
    }
    if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) {
      return `文件类型 "${file.type}" 暂不支持`;
    }
    return null;
  }, []);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const validFiles: File[] = [];
      const errors: string[] = [];
      for (const f of Array.from(files)) {
        const error = validateFile(f);
        if (!error) {
          validFiles.push(f);
        } else {
          errors.push(error);
        }
      }
      if (errors.length > 0) {
        addToast('danger', errors[0]);
      }
      if (validFiles.length > 0) {
        onFilesSelected?.(validFiles);
      }
    },
    [validateFile, onFilesSelected, addToast],
  );

  const removeFile = useCallback(
    (index: number) => {
      setUploadedFiles?.((prev) => prev.filter((_, i) => i !== index));
    },
    [setUploadedFiles],
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        addFiles(e.target.files);
      }
      e.target.value = '';
    },
    [addFiles],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer.files) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const trimmed = value.trim();
      if ((!trimmed && uploadedFiles.length === 0) || disabled) return;
      onSend({ query: trimmed, fileUrls: uploadedFiles.map((f) => f.url) });
      setValue('');
      setUploadedFiles?.([]);
      // 重置高度
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    },
    [value, disabled, onSend, uploadedFiles, setUploadedFiles],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(e.target.value);
      adjustHeight();
      onChange?.(e.target.value);
    },
    [adjustHeight, onChange],
  );

  const handleSelectRecommendation = useCallback(
    (rec: SimilarQueryRecommendation) => {
      setValue(rec.content);
      adjustHeight();
      onSelectRecommendation?.(rec);
    },
    [adjustHeight, onSelectRecommendation],
  );

  const fileInputDisabled = disabled;

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      {uploadedFiles.length > 0 && (
        <div className={styles.attachedFiles}>
          {uploadedFiles.map((file, index) => (
            <div key={index} className={styles.fileChip}>
              <span className={styles.fileName} title={file.name}>
                {file.name.length > 24 ? file.name.slice(0, 24) + '…' : file.name}
              </span>
              <span className={styles.fileSize}>{formatFileSize(file.size)}</span>
              <button
                type="button"
                className={styles.fileRemoveBtn}
                onClick={() => removeFile(index)}
                disabled={fileInputDisabled}
                title="移除文件"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M3 3l6 6M9 3l-6 6"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className={styles.inputBox} onDrop={handleDrop} onDragOver={handleDragOver}>
        <button
          type="button"
          className={styles.attachBtn}
          onClick={() => fileInputRef.current?.click()}
          disabled={fileInputDisabled}
          title="添加文件"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path
              d="M8.12 12.88a4.12 4.12 0 11-5.83-5.83L7.5 1.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M11 5a4.12 4.12 0 115.83 5.83l-5.21 5.21"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.csv,image/jpeg,image/png,image/gif,image/webp,image/bmp,audio/*,video/*"
          onChange={handleFileInputChange}
          style={{ display: 'none' }}
          disabled={fileInputDisabled}
        />
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          rows={1}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="有什么可以帮到你的？（可拖拽或添加文件）"
          disabled={disabled}
        />
        <div className={styles.btnGroup}>
          {disabled && onCancel ? (
            <button type="button" className={styles.cancelBtn} onClick={onCancel} title="停止生成">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="3" y="3" width="10" height="10" rx="1" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              className={`${styles.sendBtn} ${value.trim() || uploadedFiles.length > 0 ? styles.sendBtnActive : ''}`}
              disabled={disabled || (!value.trim() && uploadedFiles.length === 0)}
              title="发送消息"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 14V2M8 2L3 7M8 2l5 5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
      {recommendations && recommendations.length > 0 && (
        <div className={styles.recommendations}>
          {recommendations.map((rec) => (
            <button
              key={rec.messageId}
              type="button"
              className={styles.recommendationChip}
              onClick={() => handleSelectRecommendation(rec)}
            >
              {rec.content.length > 30 ? rec.content.slice(0, 30) + '…' : rec.content}
            </button>
          ))}
        </div>
      )}
      <p className={styles.tip}>Enter 发送，Shift+Enter 换行</p>
    </form>
  );
}
