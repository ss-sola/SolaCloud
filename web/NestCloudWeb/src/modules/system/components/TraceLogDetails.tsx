import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { TraceLogApi } from '../api/traceLogApi';
import { parseLog } from '../utils/traceLogPresentation';
import styles from './TraceLogResults.module.css';

export function TraceLogDetails({ traceId, entryId }: { traceId: string; entryId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <details
      open={open}
      className={styles.details}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className={styles.expand}>查看详情</span>
        <span className={styles.collapse}>收起详情</span>
      </summary>
      {open ? <TraceLogContent traceId={traceId} entryId={entryId} /> : null}
    </details>
  );
}

export function TraceLogContent({ traceId, entryId }: { traceId: string; entryId: string }) {
  const [rawOpen, setRawOpen] = useState(false);
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
        正在加载详情…
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
  const details = parseLog(detail.data.message).fields?.httpDetails;
  if (!details) return <pre>{detail.data.message}</pre>;
  return (
    <>
      <div className={styles.sections}>
        {Object.entries(sectionLabels).map(([key, label]) => {
          const section = details[key];
          if (!section) return null;
          return (
            <section key={key}>
              <h4>{label}</h4>
              {section.state !== 'captured' ? (
                <span className="small text-secondary">{stateLabels[section.state]}</span>
              ) : null}
              {section.value !== undefined ? (
                <pre>{JSON.stringify(section.value, null, 2)}</pre>
              ) : null}
            </section>
          );
        })}
      </div>
      <details
        className={styles.details}
        onToggle={(event) => setRawOpen(event.currentTarget.open)}
      >
        <summary>日志原文</summary>
        {rawOpen && <pre>{detail.data.message}</pre>}
      </details>
    </>
  );
}

const sectionLabels = {
  requestHeaders: '请求头',
  params: '路径参数',
  query: '查询参数',
  requestBody: '请求正文',
  responseHeaders: '响应头',
  responseBody: '响应内容',
};

const stateLabels = {
  captured: '',
  truncated: '已截断',
  omitted: '内容未采集',
  empty: '无正文',
  skipped: '按规则跳过正文',
};
