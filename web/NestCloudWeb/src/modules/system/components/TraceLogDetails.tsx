import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { TraceLogApi } from '../api/traceLogApi';
import styles from './TraceLogResults.module.css';

export function TraceLogDetails({ traceId, entryId }: { traceId: string; entryId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <details className={styles.details} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span className={styles.expand}>展开原文</span>
        <span className={styles.collapse}>收起原文</span>
      </summary>
      {open ? <TraceLogRaw traceId={traceId} entryId={entryId} /> : null}
    </details>
  );
}

function TraceLogRaw({ traceId, entryId }: { traceId: string; entryId: string }) {
  const detail = useQuery({
    queryKey: ['trace-log-detail', traceId, entryId],
    queryFn: ({ signal }) => TraceLogApi.detail(traceId, entryId, signal),
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (detail.isPending) {
    return (
      <p className="small text-secondary mb-0" role="status">
        正在加载原文…
      </p>
    );
  }
  if (detail.isError) {
    return (
      <div className="small mt-2">
        <span className="text-danger" role="alert">
          {detail.error.message}
        </span>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary ms-2"
          onClick={() => void detail.refetch()}
        >
          重试
        </button>
      </div>
    );
  }
  return <pre>{detail.data.message}</pre>;
}
