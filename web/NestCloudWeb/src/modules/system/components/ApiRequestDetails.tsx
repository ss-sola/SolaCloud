import type { ProjectRoute } from '../api/apiCallGraph';
import { formatDuration, type RecordedRequest } from '../utils/apiCallTrace';
import canvas from './ApiMethodCanvas.module.css';

function Snapshot({ value, missing, empty }: { value: unknown; missing: string; empty?: string }) {
  if (value === undefined) return <p className={canvas.snapshotNote}>{missing}</p>;
  if (
    empty &&
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !Object.keys(value).length
  )
    return <p className={canvas.snapshotNote}>{empty}</p>;
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}

export function ApiRequestDetails({
  route,
  request,
  status,
  interrupted,
  onClose,
}: {
  route: Pick<ProjectRoute, 'method' | 'path'>;
  request?: RecordedRequest;
  status: string;
  interrupted: boolean;
  onClose: () => void;
}) {
  const end = request?.end;
  const hasMetadata =
    request?.requestHeaders !== undefined ||
    request?.parameters !== undefined ||
    end?.responseHeaders !== undefined ||
    end?.responseBody !== undefined;
  const missingParam = end || interrupted ? '未记录' : '尚未采集';
  const missingResponse = end ? '未记录' : interrupted ? '未收到响应结束记录' : '等待响应…';
  return (
    <section aria-label="入口详情" className={canvas.detailsPanel}>
      <div className="d-flex align-items-start justify-content-between gap-3">
        <div>
          <h3 className="h6 mb-1">HTTP 入口</h3>
          <code className="text-break">
            {route.method} {route.path}
          </code>
        </div>
        <button type="button" className={canvas.close} onClick={onClose}>
          关闭详情
        </button>
      </div>
      <p className={canvas.noCalls}>
        {status}
        {end && ' · HTTP ' + end.status + ' · ' + formatDuration(end.durationMs)}
      </p>
      {request && (route.path !== request.path || route.method !== request.method) && (
        <code className="text-break">
          {request.method} {request.path}
        </code>
      )}
      {!request ? (
        <p className={canvas.snapshotNote}>尚无请求记录。</p>
      ) : !hasMetadata && (end || interrupted) ? (
        <p className={canvas.snapshotNote}>
          该记录未包含 HTTP 详情。旧版探针只记录请求状态和耗时。
        </p>
      ) : (
        <div className={canvas.httpFields}>
          <section aria-label="请求头">
            <h4>请求头</h4>
            <Snapshot value={request.requestHeaders} missing="未记录请求头" empty="无请求头" />
          </section>
          <section aria-label="请求参数">
            <h4>请求参数</h4>
            <h5>路径参数</h5>
            <Snapshot value={request.parameters?.path} missing={missingParam} empty="无路径参数" />
            <h5>查询参数</h5>
            <Snapshot value={request.parameters?.query} missing={missingParam} empty="无查询参数" />
            <h5>请求体</h5>
            <Snapshot value={request.parameters?.body} missing={missingParam} />
          </section>
          <section aria-label="响应头">
            <h4>响应头</h4>
            <Snapshot value={end?.responseHeaders} missing={missingResponse} empty="无响应头" />
          </section>
          <section aria-label="返回值">
            <h4>返回值</h4>
            <Snapshot value={end?.responseBody} missing={missingResponse} />
          </section>
        </div>
      )}
    </section>
  );
}
