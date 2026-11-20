import { useCallback, useState } from 'react';
import { Streamdown } from 'streamdown';
import type { ChatMessage, SourceReference, FileAttachment } from '../types/rag.types';
import { ChatSourceCard } from './ChatSourceCard';
import styles from './ChatMessageList.module.css';

interface ChatMessageListProps {
  messages: ChatMessage[];
  onSourcePreview?: (source: SourceReference) => void;
  onDownloadAttachment?: (attachment: FileAttachment) => void;
  onRegenerate?: (lastUserId: number) => void;
  isRegenerating: boolean;
}

export function ChatMessageList({
  messages,
  onSourcePreview,
  onDownloadAttachment,
  onRegenerate,
  isRegenerating,
}: ChatMessageListProps) {
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const handleCopy = useCallback((content: string, id: number) => {
    void navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  if (messages.length === 0) return null;

  return (
    <div className={styles.list}>
      {messages.map((msg) => (
        <div key={msg.id} className={styles.messageRow}>
          {msg.role === 'user' ? (
            <div className={styles.userRow}>
              <div className={styles.userBubble}>
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className={styles.attachmentList}>
                    {msg.attachments.map((att) => (
                      <button
                        key={att.fileId}
                        type="button"
                        className={styles.attachmentChip}
                        onClick={() => onDownloadAttachment?.(att)}
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path
                            d="M3 2h5l3 3v7a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"
                            stroke="currentColor"
                            strokeWidth="1.2"
                          />
                          <path
                            d="M8 2v3h3"
                            stroke="currentColor"
                            strokeWidth="1.2"
                            strokeLinecap="round"
                          />
                        </svg>
                        <span className={styles.attachmentName}>{att.name}</span>
                        <span className={styles.attachmentSize}>{formatFileSize(att.size)}</span>
                      </button>
                    ))}
                  </div>
                )}
                {msg.content}
              </div>
            </div>
          ) : (
            <div className={styles.assistantRow}>
              <div className={styles.avatar}>AI</div>
              <div className={styles.body}>
                <div className={styles.assistantBubble}>
                  <Streamdown
                    components={{
                      table: (props) => <table className={styles.mdTable} {...props} />,
                      code: (props) => <code className={styles.mdCode} {...props} />,
                      pre: (props) => <pre className={styles.mdPre} {...props} />,
                      blockquote: (props) => (
                        <blockquote className={styles.mdBlockquote} {...props} />
                      ),
                      img: (props) => <img className={styles.mdImage} {...props} />,
                    }}
                  >
                    {msg.content}
                  </Streamdown>
                </div>
                {msg.sources && msg.sources.length > 0 && (
                  <div className={styles.sources}>
                    {msg.sources
                      .filter((s) => s.fileUrl)
                      .map((source) => (
                        <ChatSourceCard
                          key={source.chunkId}
                          source={source}
                          onPreview={onSourcePreview}
                        />
                      ))}
                  </div>
                )}
                <div className={styles.actions}>
                  <button
                    className={styles.actionBtn}
                    onClick={() => handleCopy(msg.content, msg.id)}
                    title="复制"
                  >
                    {copiedId === msg.id ? (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path
                          d="M2 7.5l3 3 7-7"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <rect
                          x="5"
                          y="5"
                          width="7"
                          height="7"
                          rx="1.5"
                          stroke="currentColor"
                          strokeWidth="1.2"
                        />
                        <path
                          d="M9 5V3.5A1.5 1.5 0 007.5 2h-4A1.5 1.5 0 002 3.5v4A1.5 1.5 0 003.5 9H5"
                          stroke="currentColor"
                          strokeWidth="1.2"
                        />
                      </svg>
                    )}
                  </button>
                  <button
                    className={styles.actionBtn}
                    disabled={isRegenerating}
                    onClick={() => {
                      // 找到这条 assistant 消息对应的用户消息 ID
                      const msgIndex = messages.findIndex((m) => m.id === msg.id);
                      if (msgIndex <= 0) return;
                      const prevMsg = messages[msgIndex - 1];
                      if (prevMsg?.role === 'user') {
                        onRegenerate?.(prevMsg.id);
                      }
                    }}
                    title="重新生成"
                  >
                    {isRegenerating ? (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        className={styles.regenSpinner}
                      >
                        <path
                          d="M7 1a6 6 0 11-6 6"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path
                          d="M1.5 4.5V2h2.5"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M3.2 9.8A5.5 5.5 0 011.5 4.5 5.5 5.5 0 017 1a5.5 5.5 0 015 4"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                        />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
