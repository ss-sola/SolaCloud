import { useMutation } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { TraceLogApi } from '../api/traceLogApi';
import { TraceLogResults } from '../components/TraceLogResults';

export function TraceLogPage() {
  const [traceId, setTraceId] = useState('');
  const [validationError, setValidationError] = useState('');
  const query = useMutation({ mutationFn: TraceLogApi.query, gcTime: 0 });

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (query.isPending) return;
    const value = traceId.trim().toLowerCase();
    if (!/^(?!0{32}$)[a-f0-9]{32}$/.test(value)) {
      query.reset();
      setValidationError('请输入 32 位非全零十六进制 traceId。');
      return;
    }
    setValidationError('');
    query.mutate(value);
  }

  return (
    <section className="page-card d-flex flex-column gap-3" aria-label="日志查询">
      <form onSubmit={submit}>
        <label className="form-label fw-semibold" htmlFor="trace-log-id">
          traceId
        </label>
        <div className="d-grid d-sm-flex gap-2">
          <input
            className={`form-control font-monospace${validationError ? ' is-invalid' : ''}`}
            id="trace-log-id"
            aria-invalid={Boolean(validationError)}
            aria-describedby={validationError ? 'trace-log-validation' : 'trace-log-scope'}
            value={traceId}
            onChange={(event) => {
              setTraceId(event.target.value);
              setValidationError('');
            }}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            className="btn btn-success flex-shrink-0"
            type="submit"
            disabled={query.isPending}
          >
            {query.isPending ? '查询中…' : '查询'}
          </button>
        </div>
        <div id="trace-log-scope" className="form-text">
          查询最近 24 小时的日志
        </div>
        {validationError ? (
          <div id="trace-log-validation" className="invalid-feedback d-block" role="alert">
            {validationError}
          </div>
        ) : null}
      </form>

      {query.isError ? (
        <div className="alert alert-danger mb-0" role="alert">
          {query.error.message}
        </div>
      ) : null}

      {query.isSuccess ? (
        <>
          <div className="small text-secondary text-break" role="status">
            <code>{query.variables}</code>
            {' · '}
            {query.data.list.length === 0
              ? '最近 24 小时内未找到匹配日志'
              : `${query.data.list.length} 条日志`}
          </div>
          {query.data.truncated ? (
            <div className="alert alert-warning mb-0" role="status">
              日志超过 500 条，优先保留网关和接单结果，其余显示较早的日志。
            </div>
          ) : null}
          {query.data.list.length ? (
            <TraceLogResults
              key={query.variables}
              traceId={query.variables}
              entries={query.data.list}
              truncated={query.data.truncated}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
