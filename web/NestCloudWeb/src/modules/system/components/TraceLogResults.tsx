import type { TraceLogEntry } from '../api/traceLogApi';
import { formatTraceLogTime } from '../utils/formatters';
import {
  listUncollectedTargets,
  orderTraceLogEntries,
  summarizeTraceLog,
} from '../utils/traceLogPresentation';
import styles from './TraceLogResults.module.css';
import { TraceLogDetails } from './TraceLogDetails';

export function TraceLogResults({
  traceId,
  entries,
  truncated,
}: {
  traceId: string;
  entries: TraceLogEntry[];
  truncated: boolean;
}) {
  const missingTargets = listUncollectedTargets(entries);

  return (
    <div className={styles.results}>
      {missingTargets.length ? (
        <p className="small text-secondary mb-0" role="status">
          网关转发目标 {missingTargets.join('、')}。
          {truncated ? '结果已截断，当前列表未包含对应实例日志。' : '查询结果中暂无对应实例日志。'}
        </p>
      ) : null}
      <div className={styles.header} aria-hidden="true">
        <span>时间</span>
        <span>服务</span>
        <span>实例地址</span>
        <span>级别</span>
        <span>日志摘要</span>
      </div>
      <ul className={styles.entries} aria-label="按调用顺序展示的日志">
        {orderTraceLogEntries(entries).map(({ entry, hasStartTime, timestampNs }, index) => {
          const summary = summarizeTraceLog(entry.message);
          return (
            <li className={styles.entry} key={entry.entryId + '-' + index}>
              <time className={styles.time} title={hasStartTime ? '调用开始时间' : '日志写入时间'}>
                {formatTraceLogTime(timestampNs)}
              </time>
              <span className={styles.service}>{entry.service || '—'}</span>
              <div className={styles.address} title={entry.instance}>
                <span className={styles.mobileLabel}>实例地址</span>
                <code>{entry.instanceAddress ?? (entry.instance || '—')}</code>
              </div>
              <span className={styles.level} data-level={entry.level ?? undefined}>
                {entry.level ?? '—'}
              </span>
              <div className={styles.content}>
                <p className={styles.preview} title={summary}>
                  {summary}
                </p>
                <TraceLogDetails traceId={traceId} entryId={entry.entryId} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
