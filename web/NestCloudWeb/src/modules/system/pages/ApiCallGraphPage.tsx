import { memo, useEffect, useMemo, useRef, useState, type SubmitEvent } from 'react';
import {
  ApiCallGraph,
  type MethodGraph,
  type ProjectRoute,
  type RouteCatalog,
} from '../api/apiCallGraph';
import { ApiMethodDiagram } from '../components/ApiMethodDiagram';
import styles from '../components/ApiMethodDiagram.module.css';
import { useCallGraphProbe } from '../hooks/useCallGraphProbe';
import { formatDuration, maxVisibleRequests } from '../utils/apiCallTrace';

const initialProject = 'E:\\project\\wzj-nodejs-v2';
const pageSize = 50;
const RequestDiagram = memo(ApiMethodDiagram);
const statusLabels = {
  starting: '正在启动目标项目',
  listening: '目标项目已监听',
  stopped: '探针已停止',
  error: '探针异常',
};

function Warnings({ warnings, label = '解析提示' }: { warnings?: string[]; label?: string }) {
  return warnings?.length ? (
    <details className="small text-warning-emphasis">
      <summary>
        {label}（{warnings.length}）
      </summary>
      <ul className="mt-2 mb-0">
        {warnings.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </details>
  ) : null;
}

export function ApiCallGraphPage() {
  const [project, setProject] = useState(initialProject);
  const [scannedProject, setScannedProject] = useState('');
  const [catalog, setCatalog] = useState<RouteCatalog>();
  const [selected, setSelected] = useState<ProjectRoute>();
  const [graph, setGraph] = useState<MethodGraph>();
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useState(pageSize);
  const [loading, setLoading] = useState<'scan' | 'graph'>();
  const [error, setError] = useState('');
  const [chosenRequests, setChosenRequests] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [choosing, setChoosing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const page = useRef<HTMLElement>(null);
  const picker = useRef<HTMLDialogElement>(null);
  const routeSearch = useRef<HTMLInputElement>(null);
  const switchRoute = useRef<HTMLButtonElement>(null);
  const operation = useRef<AbortController>(undefined);
  const probe = useCallGraphProbe();
  const locked = probe.active || probe.busy;
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    if (choosing && picker.current && !picker.current.open) {
      picker.current.showModal();
      routeSearch.current?.focus({ preventScroll: true });
      routeSearch.current?.select();
    }
  }, [choosing]);
  useEffect(() => {
    if (selected) switchRoute.current?.focus({ preventScroll: true });
  }, [selected]);
  useEffect(() => {
    const onFullscreenChange = () => setExpanded(document.fullscreenElement === page.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  async function toggleFullscreen() {
    if (expanded) {
      setExpanded(false);
      if (document.fullscreenElement === page.current) {
        await document.exitFullscreen().catch(() => undefined);
      }
    } else {
      setExpanded(true);
      // Embedded browsers can deny native fullscreen. The same workspace also fills the tab.
      await page.current?.requestFullscreen?.().catch(() => undefined);
    }
  }
  const filtered = useMemo(() => {
    const terms = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (
      catalog?.routes.filter((route) => {
        const text = [route.method, route.path, route.file].join(' ').toLowerCase();
        return terms.every((term) => text.includes(term));
      }) ?? []
    );
  }, [catalog, filter]);

  async function scan(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || !project.trim()) return;
    picker.current?.close();
    setChoosing(false);
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setLoading('scan');
    setCatalog(undefined);
    setSelected(undefined);
    setGraph(undefined);
    setFilter('');
    setLimit(pageSize);
    setError('');
    setChosenRequests(new Map());
    probe.reset();
    try {
      const result = await ApiCallGraph.scan(project.trim(), controller.signal);
      if (!controller.signal.aborted) {
        setCatalog(result);
        setScannedProject(project.trim());
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!controller.signal.aborted) setLoading(undefined);
    }
  }

  async function select(route: ProjectRoute) {
    picker.current?.close();
    setChoosing(false);
    if (selected?.id === route.id && graph) return;
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setLoading('graph');
    setSelected(route);
    setGraph(undefined);
    setError('');
    try {
      const result = await ApiCallGraph.graph(scannedProject, route.id, controller.signal);
      if (!controller.signal.aborted) setGraph(result);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!controller.signal.aborted) setLoading(undefined);
    }
  }

  const requests = useMemo(
    () =>
      selected
        ? [...probe.recording.requests.values()]
            .filter((item) => item.routeId === selected.id)
            .reverse()
        : [],
    [selected, probe.recording.requests],
  );
  const chosenRequest = selected ? chosenRequests.get(selected.id) : undefined;
  const request = requests.find((item) => item.requestId === chosenRequest) ?? requests[0];
  const requestId = chosenRequest && request?.requestId === chosenRequest ? chosenRequest : '';
  const status = probe.recording.status;
  const terminal = status?.state === 'stopped' || status?.state === 'error';
  const framework = catalog?.framework;
  const frameworkLabel =
    framework && { koa: 'Koa', nestjs: 'NestJS', unknown: '未识别框架' }[framework];
  const probeButton = (
    <button
      type="button"
      className={
        'btn btn-sm flex-shrink-0 ' + (probe.active ? 'btn-outline-danger' : 'btn-success')
      }
      disabled={probe.busy || !catalog}
      onClick={() => {
        if (probe.active) void probe.stop();
        else if (catalog) {
          setChosenRequests(new Map());
          void probe.start(scannedProject, catalog.routes);
        }
      }}
    >
      {probe.busy ? '处理中…' : probe.active ? '停止探针' : '启动探针'}
    </button>
  );
  const workerEntries = catalog?.workerEntries ?? [];
  const workerDiscovery = workerEntries.length > 0 && (
    <p className="small text-secondary mb-0" title={workerEntries.join('\n')}>
      已识别 {workerEntries.length} 个独立 BullMQ Worker 入口
    </p>
  );
  const probeStatus = (
    <>
      {probe.recording.warnings && (
        <Warnings warnings={[...probe.recording.warnings]} label="探针提示" />
      )}
      {probe.error && (
        <div className="alert alert-danger mb-0" role="alert">
          {probe.error}
        </div>
      )}
      {probe.streamError && (
        <div className="alert alert-warning mb-0" role="alert">
          {probe.streamError}
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary ms-2"
            onClick={probe.reconnect}
          >
            重新连接
          </button>
        </div>
      )}
      {probe.streamWarning && (
        <p className="small text-warning-emphasis mb-0">{probe.streamWarning}</p>
      )}
      {(status || probe.active) && (
        <div className={styles.session} role="status">
          <strong>{status ? statusLabels[status.state] : '正在连接探针'}</strong>
          {status?.port && (
            <span>
              目标端口 <code>{status.port}</code>
            </span>
          )}
          {status?.message && <span className="text-break">{status.message}</span>}
          {status?.state === 'listening' &&
            (selected ? (
              !requests.length && <span>等待调用目标接口…</span>
            ) : (
              <span>选择接口可查看该接口的请求记录。</span>
            ))}
        </div>
      )}
    </>
  );

  const chooser = (!selected || choosing) && (
    <div className={styles.chooser}>
      {(selected || expanded) && (
        <div className={styles.chooserHeading}>
          <h2 className="h6 mb-0">选择接口</h2>
          {selected ? (
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={() => picker.current?.close()}
            >
              关闭
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={() => void toggleFullscreen()}
            >
              退出全屏
            </button>
          )}
        </div>
      )}
      <form className={styles.scan} onSubmit={scan}>
        <label className="form-label fw-semibold mb-0" htmlFor="call-graph-project">
          项目目录
        </label>
        <input
          id="call-graph-project"
          className="form-control font-monospace"
          value={project}
          spellCheck={false}
          autoComplete="off"
          title="填写调用图服务所在机器上的项目路径"
          disabled={locked || loading === 'scan'}
          onChange={(event) => setProject(event.target.value)}
          required
        />
        <button
          type="submit"
          className="btn btn-success"
          disabled={locked || loading === 'scan' || !project.trim()}
        >
          {loading === 'scan' ? '扫描中…' : '扫描接口'}
        </button>
      </form>
      {locked && (
        <p className="small text-secondary mb-0">
          探针运行期间可切换本项目接口。停止探针后可更换项目。
        </p>
      )}
      {!selected && (
        <>
          {workerDiscovery}
          {probeStatus}
        </>
      )}
      <Warnings warnings={catalog?.warnings} />
      {catalog && project.trim() === scannedProject && (
        <aside className={styles.catalog} aria-label="接口列表">
          <div className={styles.catalogHeader}>
            <h2 className="h6 mb-0">项目接口</h2>
            <span className="small text-secondary">
              {frameworkLabel && frameworkLabel + ' · '}
              {filtered.length} / {catalog.routes.length}
            </span>
            {!selected && probeButton}
          </div>
          <input
            ref={routeSearch}
            className="form-control form-control-sm"
            type="search"
            aria-label="搜索接口"
            placeholder="搜索方法或路径"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setLimit(pageSize);
            }}
          />
          <div className={styles.list}>
            {filtered.slice(0, limit).map((route) => (
              <button
                type="button"
                key={route.id}
                className={styles.route}
                aria-label={route.method + ' ' + route.path}
                aria-pressed={route.id === selected?.id}
                onClick={() => void select(route)}
              >
                <span className={styles.verb}>{route.method}</span>
                <span>{route.path}</span>
              </button>
            ))}
            {!filtered.length && (
              <p className="small text-secondary mb-0">
                {catalog.routes.length ? '没有匹配的接口。' : '未发现可识别的 HTTP 接口。'}
              </p>
            )}
            {filtered.length > limit && (
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary w-100 mt-1"
                onClick={() => setLimit(limit + pageSize)}
              >
                显示更多接口
              </button>
            )}
          </div>
        </aside>
      )}
    </div>
  );

  return (
    <section
      ref={page}
      aria-label="接口调用图"
      className={styles.page}
      data-expanded={expanded || undefined}
      onKeyDown={(event) => {
        if (
          event.key === 'Escape' &&
          expanded &&
          !event.defaultPrevented &&
          !picker.current?.open
        ) {
          event.preventDefault();
          void toggleFullscreen();
        }
      }}
    >
      {error && (
        <div role="alert" className="alert alert-danger mb-0">
          {error}
        </div>
      )}
      {!selected ? (
        chooser
      ) : (
        <>
          <header className={styles.heading}>
            <div className={styles.routeInfo}>
              <h2 className={styles.routeTitle} title={selected.method + ' ' + selected.path}>
                <span className={styles.verb}>{selected.method}</span> <span>{selected.path}</span>
              </h2>
              <code title={selected.file + ':' + selected.line}>
                {selected.file}:{selected.line}
              </code>
            </div>
            <div className={styles.actions}>
              <button
                ref={switchRoute}
                type="button"
                className="btn btn-sm btn-outline-secondary"
                aria-haspopup="dialog"
                onClick={() => {
                  setProject(scannedProject);
                  setChoosing(true);
                }}
              >
                切换接口
              </button>
              {probeButton}
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                aria-pressed={expanded}
                onClick={() => void toggleFullscreen()}
              >
                {expanded ? '退出全屏' : '全屏'}
              </button>
            </div>
          </header>
          <div className={styles.graphPanel}>
            {loading === 'graph' && (
              <p role="status" className="small text-secondary">
                正在解析方法调用关系…
              </p>
            )}
            <Warnings warnings={graph?.warnings} />
            {workerDiscovery}
            {selected && <Warnings warnings={catalog?.warnings} />}
            {probeStatus}
            {request && (
              <div className={styles.requests}>
                <label htmlFor="graph-request">请求记录</label>
                <select
                  id="graph-request"
                  className="form-select form-select-sm"
                  value={requestId}
                  onChange={(event) => {
                    const value = event.target.value;
                    setChosenRequests((previous) => {
                      const next = new Map(previous);
                      if (value) next.set(selected.id, value);
                      else next.delete(selected.id);
                      return next;
                    });
                  }}
                >
                  <option value="">跟随最新请求</option>
                  {requests.map((item) => (
                    <option key={item.requestId} value={item.requestId}>
                      {new Date(item.startedAt).toLocaleTimeString()} · {item.method} {item.path} ·{' '}
                      {item.requestId.slice(-8)}
                    </option>
                  ))}
                </select>
                <span className="small text-secondary text-break">
                  {request.method} {request.path}
                  {' · '}
                  {request.end
                    ? 'HTTP ' + request.end.status + ' · ' + formatDuration(request.end.durationMs)
                    : terminal
                      ? '未记录结束'
                      : '运行中'}
                  {request.end?.dropped ? ' · 已省略 ' + request.end.dropped + ' 次调用' : ''}
                  {requests.length >= maxVisibleRequests &&
                    ' · 仅保留最近 ' + maxVisibleRequests + ' 个请求'}
                </span>
              </div>
            )}
            {graph && (
              <RequestDiagram
                key={selected.id}
                route={selected}
                graph={graph}
                request={request}
                liveReturns={
                  request && probe.recording.liveReturns?.requestIds?.has(request.requestId)
                    ? probe.recording.liveReturns
                    : undefined
                }
                interrupted={terminal || Boolean(probe.streamError)}
              />
            )}
          </div>
          {choosing && (
            <dialog
              ref={picker}
              className={styles.pickerDialog}
              aria-label="选择项目和接口"
              onClose={() => setChoosing(false)}
              onClick={(event) => {
                if (event.target === event.currentTarget) picker.current?.close();
              }}
            >
              {chooser}
            </dialog>
          )}
        </>
      )}
    </section>
  );
}
