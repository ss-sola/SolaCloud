import type { SourceReference } from '../types/rag.types';
import styles from './ChatSourceCard.module.css';

interface ChatSourceCardProps {
  source: SourceReference;
  onPreview?: (source: SourceReference) => void;
}

export function ChatSourceCard({ source, onPreview }: ChatSourceCardProps) {
  return (
    <div className={styles.card}>
      <svg className={styles.icon} width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path
          d="M3 1h5l3 3v8a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <path d="M8 1v3h3" stroke="currentColor" strokeWidth="1.2" />
      </svg>
      <span className={styles.fileName}>{source.fileName || '来源文档'}</span>
      <span className={styles.score}>{Math.round(source.score * 100)}%</span>
      {source.fileId != null && (
        <button className={styles.link} onClick={() => onPreview?.(source)} type="button">
          查看
        </button>
      )}
    </div>
  );
}
