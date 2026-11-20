import { useCallback, useEffect, useRef, useState } from 'react';
import { Streamdown } from 'streamdown';
import { RagApi } from '../api/ragApi';
import { useChatStream } from '../hooks/useChatStream';
import type {
  ChatSession,
  SimilarQueryRecommendation,
  SourceReference,
  FileAttachment,
} from '../types/rag.types';
import { ChatInput, type UploadedFileInfo } from '../components/ChatInput';
import { ChatMessageList } from '../components/ChatMessageList';
import { ChatSourceCard } from '../components/ChatSourceCard';
import { ModalDialog } from '../../system/components/ModalDialog';
import { FilePreview } from '../../../shared/components/FilePreview/FilePreview';
import { uploadFileWithResume } from '../../../shared/api/resumableUploadApi';
import styles from './RagChatPage.module.css';

/** 用户向上滚动离开底部后，自动跟随的阈值（像素） */
const SCROLL_THRESHOLD = 80;

/** 强制滚动的场景标记 */
type ScrollTrigger = 'none' | 'send' | 'switch' | 'new' | 'regenerate';

/** 预览弹窗类型 */
type PreviewTarget =
  | { type: 'source'; source: SourceReference }
  | { type: 'attachment'; attachment: FileAttachment };

export function RagChatPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesAreaRef = useRef<HTMLDivElement>(null);
  /** 缓存待发送消息，解决自动创建会话后 sessionId 尚未生效的竞态问题 */
  const pendingQueryRef = useRef<string | null>(null);
  /** 已上传完成的文件列表 */
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileInfo[]>([]);
  /** 预览弹窗状态 */
  const [previewSource, setPreviewSource] = useState<PreviewTarget | null>(null);
  /** 是否在底部附近（决定是否自动跟随） */
  const [isNearBottom, setIsNearBottom] = useState(true);
  /** 强制滚动场景标记 */
  const [forceScroll, setForceScroll] = useState<ScrollTrigger>('none');

  /** 相似问答推荐 */
  const [recommendations, setRecommendations] = useState<SimilarQueryRecommendation[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 上传进度 */
  const [uploadProgress, setUploadProgress] = useState<{ fileId: string; percent: number }[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  /** SSE onDone 后刷新会话列表（展示 LLM 生成的标题） */
  const handleSseDone = useCallback(async () => {
    try {
      const list = await RagApi.listSessions();
      setSessions(list);
    } catch {
      // 刷新标题失败不影响用户体验
    }
  }, []);

  const {
    messages,
    isStreaming,
    isRegenerating,
    currentStreamContent,
    currentSources,
    loadMessages,
    sendMessage,
    cancelStream,
    regenerate,
  } = useChatStream(currentSessionId, { onDone: handleSseDone });

  useEffect(() => {
    void RagApi.listSessions().then(setSessions);
  }, []);

  useEffect(() => {
    if (currentSessionId) {
      void loadMessages();
    }
  }, [currentSessionId, loadMessages]);

  /** 当 sessionId 就绪后，发送待发消息 */
  useEffect(() => {
    if (currentSessionId && pendingQueryRef.current) {
      const query = pendingQueryRef.current;
      pendingQueryRef.current = null;
      if (uploadedFiles.length > 0) {
        sendWithFiles(query, uploadedFiles);
      } else {
        sendMessage(query);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId]);

  /** 批量上传文件 */
  const uploadFiles = useCallback(async (files: File[]): Promise<UploadedFileInfo[]> => {
    if (files.length === 0) return [];
    const results: UploadedFileInfo[] = [];
    const progressPerFile = files.map(() => 0);
    setUploadProgress(files.map((f, i) => ({ fileId: `file-${i}`, percent: 0 })));
    setIsUploading(true);

    try {
      const uploadPromises = files.map(async (file, idx) => {
        const uploaded = await uploadFileWithResume({
          uploadUrl: '/api/file/upload',
          file,
          scene: 'rag-attachment',
          businessType: 'chat',
          isTemporary: true,
          onProgress: (snapshot) => {
            progressPerFile[idx] = snapshot.percent;
            setUploadProgress(
              files.map((_, i) => ({ fileId: `file-${i}`, percent: progressPerFile[i] })),
            );
          },
        });
        return {
          id: uploaded.id!,
          url: uploaded.previewUrl || uploaded.url || '',
          name: file.name,
          size: file.size,
          mimeType: file.type || '',
        };
      });

      results.push(...(await Promise.all(uploadPromises)));
      setUploadProgress([]);
      setIsUploading(false);
      setUploadedFiles((prev) => [...prev, ...results]);
    } catch {
      setUploadProgress([]);
      setIsUploading(false);
    }
    return results;
  }, []);

  /** 搜索相似历史问答（500ms 防抖） */
  const fetchRecommendations = useCallback(async (query: string) => {
    if (!query.trim() || query.length < 2) {
      setRecommendations([]);
      return;
    }
    setRecommendationsLoading(true);
    try {
      const results = await RagApi.getSimilarQueries(query, 3);
      setRecommendations(results);
    } catch {
      // 推荐失败不影响正常使用
      setRecommendations([]);
    } finally {
      setRecommendationsLoading(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const handleInputChange = useCallback(
    (value: string) => {
      // 清除之前的定时器
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      // 防抖 500ms
      debounceTimerRef.current = setTimeout(() => {
        void fetchRecommendations(value);
      }, 500);
    },
    [fetchRecommendations],
  );

  const handleNewSession = useCallback(async () => {
    const session = await RagApi.createSession();
    handleScrollOnSwitch();
    setSessions((prev) => [session, ...prev]);
    setCurrentSessionId(session.id);
  }, []);

  /** 清空已上传文件 */
  const clearUploadedFiles = useCallback(() => {
    setUploadedFiles([]);
  }, []);

  const handleSend = useCallback(
    async (params: { query: string; fileUrls: string[] }) => {
      handleScrollOnSend();
      if (!currentSessionId) {
        pendingQueryRef.current = params.query;
        // 文件已在选择时上传，无需缓存
        void RagApi.createSession().then((session) => {
          setSessions((prev) => [session, ...prev]);
          setCurrentSessionId(session.id);
        });
        return;
      }
      const attachments: FileAttachment[] = uploadedFiles
        .filter((f) => params.fileUrls.includes(f.url))
        .map((f) => ({
          fileId: f.id,
          name: f.name,
          size: f.size,
          mimeType: f.mimeType,
          url: f.url,
        }));
      sendMessage(params.query, attachments.length > 0 ? attachments : undefined);
      clearUploadedFiles();
    },
    [currentSessionId, sendMessage, uploadedFiles, clearUploadedFiles],
  );

  const handleDeleteSession = useCallback(
    async (sessionId: number, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await RagApi.deleteSession(sessionId);
      } catch {
        // 即使后端删除失败，前端仍移除会话避免阻塞用户操作
      }
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
      }
    },
    [currentSessionId],
  );

  const handleSourcePreview = useCallback((source: SourceReference) => {
    if (source.fileId == null || !source.fileUrl) return;
    setPreviewSource({ type: 'source', source });
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewSource(null);
  }, []);

  /** 处理附件点击预览 */
  const handlePreviewAttachment = useCallback((attachment: FileAttachment) => {
    setPreviewSource({ type: 'attachment', attachment });
  }, []);

  /** 上传文件并发送 */
  const sendWithFiles = useCallback(
    async (query: string, files: UploadedFileInfo[]) => {
      const attachments: FileAttachment[] = files.map((f) => ({
        fileId: f.id,
        name: f.name,
        size: f.size,
        mimeType: f.mimeType,
        url: f.url,
      }));
      sendMessage(query, attachments);
    },
    [sendMessage],
  );

  /** 强制滚动到底部 */
  const scrollToBottom = useCallback((behavior: 'smooth' | 'auto' = 'smooth') => {
    const el = messagesEndRef.current;
    if (el) {
      el.scrollIntoView({ behavior, block: 'end' });
    }
  }, []);

  /** 用户滚动检测 */
  const handleMessagesAreaScroll = useCallback(() => {
    const el = messagesAreaRef.current;
    if (!el) return;
    const { scrollTop, clientHeight, scrollHeight } = el;
    setIsNearBottom(scrollTop + clientHeight >= scrollHeight - SCROLL_THRESHOLD);
  }, []);

  /** 消息变化或流式状态变化时自动滚动 */
  useEffect(() => {
    if (!currentSessionId) return;

    const shouldAutoScroll = isNearBottom || forceScroll !== 'none';
    if (!shouldAutoScroll) return;

    const behavior = isStreaming ? 'auto' : 'smooth';
    scrollToBottom(behavior);

    if (forceScroll !== 'none') {
      setForceScroll('none');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, isStreaming, currentSessionId, forceScroll, scrollToBottom, isNearBottom]);

  /** 场景触发：发送消息 */
  const handleScrollOnSend = useCallback(() => {
    setForceScroll('send');
  }, []);

  /** 场景触发：切换会话 */
  const handleScrollOnSwitch = useCallback(() => {
    setForceScroll('switch');
  }, []);

  return (
    <div className={styles.container}>
      {/* 侧边栏 */}
      <aside className={`${styles.sidebar} ${sidebarCollapsed ? styles.sidebarCollapsed : ''}`}>
        <div className={styles.sidebarHeader}>
          <button className={styles.newChatBtn} onClick={handleNewSession}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 1v14M1 8h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            {!sidebarCollapsed && <span>新建对话</span>}
          </button>
          <button
            className={styles.collapseBtn}
            onClick={() => setSidebarCollapsed((v) => !v)}
            title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 4h10M3 8h10M3 12h10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        {!sidebarCollapsed && (
          <nav className={styles.sessionList}>
            {sessions.map((s) => (
              <div
                key={s.id}
                className={`${styles.sessionItem} ${s.id === currentSessionId ? styles.sessionActive : ''}`}
                onClick={() => setCurrentSessionId(s.id)}
              >
                <span className={styles.sessionTitle}>{s.title || '新对话'}</span>
                <button
                  className={styles.deleteBtn}
                  onClick={(e) => handleDeleteSession(s.id, e)}
                  title="删除对话"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path
                      d="M2 4h10M5 4V3a1 1 0 011-1h2a1 1 0 011 1v1M6 7v4M8 7v4M3 4l1 8a1 1 0 001 1h4a1 1 0 001-1l1-8"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            ))}
          </nav>
        )}
      </aside>

      {/* 主内容区 */}
      <main className={styles.main}>
        <div
          className={styles.messagesArea}
          ref={messagesAreaRef}
          onScroll={handleMessagesAreaScroll}
        >
          {messages.length ? (
            <>
              <ChatMessageList
                messages={messages}
                onSourcePreview={handleSourcePreview}
                onDownloadAttachment={handlePreviewAttachment}
                onRegenerate={regenerate}
                isRegenerating={isRegenerating}
              />
              {isStreaming && currentStreamContent && (
                <div className={styles.streamingMessage}>
                  <div className={styles.assistantAvatar}>AI</div>
                  <div className={styles.messageBody}>
                    <div className={`${styles.assistantBubble} ${styles.streamdownInline}`}>
                      <Streamdown>{currentStreamContent}</Streamdown>
                      <span className={styles.cursor}>|</span>
                    </div>
                    {currentSources.filter((s) => s.fileUrl).length > 0 && (
                      <div className={styles.sourcesRow}>
                        {currentSources
                          .filter((s) => s.fileUrl)
                          .map((source) => (
                            <ChatSourceCard
                              key={source.chunkId}
                              source={source}
                              onPreview={handleSourcePreview}
                            />
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {isStreaming && !currentStreamContent && (
                <div className={styles.streamingMessage}>
                  <div className={styles.assistantAvatar}>AI</div>
                  <div className={styles.messageBody}>
                    <div className={styles.thinkingDots}>
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          ) : (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                  <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="2" />
                  <path
                    d="M16 20c0-4.4 3.6-8 8-8s8 3.6 8 8-3.6 8-8 8"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <circle cx="24" cy="34" r="2" fill="currentColor" />
                </svg>
              </div>
              <h2 className={styles.emptyTitle}>AI 知识助手</h2>
              <p className={styles.emptyDesc}>基于知识库的智能问答，输入问题开始对话</p>
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className={styles.inputArea}>
          <div className={styles.inputWrapper}>
            {isUploading && (
              <div className={styles.uploadProgress}>
                {uploadProgress.map((p) => `${p.percent}%`).join(' | ')}
              </div>
            )}
            <div className={styles.inputWrapperInner}>
              <ChatInput
                onSend={handleSend}
                disabled={isStreaming || isUploading}
                onCancel={isStreaming ? cancelStream : undefined}
                recommendations={recommendations}
                onChange={handleInputChange}
                onFilesSelected={uploadFiles}
                uploadedFiles={uploadedFiles}
                setUploadedFiles={setUploadedFiles}
                onSelectRecommendation={() => {
                  // 选中推荐后清空推荐列表
                  setRecommendations([]);
                }}
              />
            </div>
          </div>
        </div>
      </main>

      {/* 文件预览弹窗 */}
      <ModalDialog
        open={previewSource !== null}
        title={
          previewSource?.type === 'source'
            ? (previewSource.source.fileName ?? '文件预览')
            : (previewSource?.attachment?.name ?? '文件预览')
        }
        size="xl"
        onClose={handleClosePreview}
      >
        {previewSource?.type === 'source' && previewSource.source && (
          <FilePreview
            url={previewSource.source.previewUrl || previewSource.source.fileUrl || ''}
            fileName={previewSource.source.fileName}
            extension={previewSource.source.extension ?? ''}
            mimeType={previewSource.source.mimeType ?? ''}
            fileId={previewSource.source.fileId ?? undefined}
            isExtracted={previewSource.source.isExtracted}
            basePreviewUrl={
              previewSource.source.isExtracted && previewSource.source.fileUrl
                ? previewSource.source.fileUrl.replace(/\.[^.]+$/, '')
                : undefined
            }
          />
        )}
        {previewSource?.type === 'attachment' && previewSource.attachment && (
          <FilePreview
            url={previewSource.attachment.url}
            fileName={previewSource.attachment.name}
            extension={previewSource.attachment.name?.split('.').pop() ?? ''}
            mimeType={previewSource.attachment.mimeType}
          />
        )}
      </ModalDialog>
    </div>
  );
}
