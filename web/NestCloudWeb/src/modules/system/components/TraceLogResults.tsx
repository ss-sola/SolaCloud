import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { TraceLogEntry } from '../api/traceLogApi';
import {
  MAX_TRACE_ZOOM,
  MIN_TRACE_ZOOM,
  useTraceDiagramCamera,
} from '../hooks/useTraceDiagramCamera';
import { formatTraceLogTime } from '../utils/formatters';
import {
  buildTraceCallTree,
  formatTraceRequest,
  layoutTraceCallTree,
  listUncollectedTargets,
  parseLog,
  summarizeTraceLog,
  TRACE_NODE_SIZE,
  type TraceCallNode,
} from '../utils/traceLogPresentation';
import styles from './TraceLogResults.module.css';
import { TraceFlowEdge } from './TraceFlowEdge';
import { TraceLogContent, TraceLogDetails } from './TraceLogDetails';

export function TraceLogResults({
  traceId,
  entries,
  truncated,
}: {
  traceId: string;
  entries: TraceLogEntry[];
  truncated: boolean;
}) {
  const [selection, setSelection] = useState<{ traceId: string; id: string }>();
  const [highlightedId, setHighlightedId] = useState<string>();
  const roots = useMemo(() => buildTraceCallTree(entries), [entries]);
  const missingTargets = listUncollectedTargets(entries);
  const selected = selection?.traceId === traceId ? findCall(roots, selection.id) : undefined;
  const select = useCallback(
    (id: string) => {
      setHighlightedId(id);
      setSelection({ traceId, id });
    },
    [traceId],
  );

  return (
    <div className={styles.results}>
      {missingTargets.length ? (
        <p className="small text-secondary mb-2" role="status">
          网关转发目标 {missingTargets.join('、')}。
          {truncated ? '结果已截断，当前查询未包含对应实例日志。' : '查询结果中暂无对应实例日志。'}
        </p>
      ) : null}
      <CallDiagram roots={roots} selectedId={highlightedId} onSelect={select} />
      {selected ? (
        <CallDetailDialog
          key={selected.id}
          traceId={traceId}
          node={selected}
          onClose={() => setSelection(undefined)}
        />
      ) : null}
    </div>
  );
}

const ZOOM_STEP = 1.25;

function CallDiagram({
  roots,
  selectedId,
  onSelect,
}: {
  roots: TraceCallNode[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const pattern = useId();
  const graph = useMemo(() => layoutTraceCallTree(roots), [roots]);
  const controls = useTraceDiagramCamera(graph);
  const { x, y, zoom } = controls.camera;

  return (
    <section className={styles.diagram} aria-label="调用树图">
      <div className={styles.tools} role="group" aria-label="流程图缩放">
        <button
          type="button"
          aria-label="缩小"
          disabled={zoom <= MIN_TRACE_ZOOM}
          onClick={() => controls.zoomFromCenter(zoom / ZOOM_STEP)}
        >
          −
        </button>
        <output aria-label="缩放比例">{Math.round(zoom * 100)}%</output>
        <button
          type="button"
          aria-label="放大"
          disabled={zoom >= MAX_TRACE_ZOOM}
          onClick={() => controls.zoomFromCenter(Math.max(MIN_TRACE_ZOOM, zoom * ZOOM_STEP))}
        >
          +
        </button>
        <button type="button" onClick={controls.fit}>
          适应窗口
        </button>
        <button type="button" onClick={() => controls.zoomFromCenter(1)}>
          实际大小
        </button>
      </div>
      <div
        ref={controls.viewport}
        className={styles.viewport}
        tabIndex={0}
        aria-label="流程图视图"
        onPointerDown={controls.pointerDown}
        onPointerMove={controls.pointerMove}
        onPointerUp={controls.pointerEnd}
        onPointerCancel={controls.pointerEnd}
        onLostPointerCapture={(event) => {
          if (event.target === event.currentTarget) controls.pointerEnd(event);
        }}
        onPointerLeave={(event) => {
          if (!controls.dragging.current) controls.pointerEnd(event);
        }}
        onClickCapture={(event) => {
          if (event.detail > 0 && controls.suppressClick.current) event.stopPropagation();
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const steps = {
            ArrowLeft: [36, 0],
            ArrowRight: [-36, 0],
            ArrowUp: [0, 36],
            ArrowDown: [0, -36],
          };
          const step = steps[event.key as keyof typeof steps];
          if (!step) return;
          event.preventDefault();
          controls.panBy(step[0], step[1]);
        }}
      >
        <svg
          className={styles.flowchart}
          aria-label="自上而下的服务调用流程"
          width="100%"
          height="100%"
        >
          <defs>
            <pattern
              id={pattern}
              width="20"
              height="20"
              patternUnits="userSpaceOnUse"
              patternTransform={`translate(${x} ${y}) scale(${zoom})`}
            >
              <circle className={styles.gridDot} cx="1" cy="1" r=".85" />
            </pattern>
          </defs>
          {zoom >= MIN_TRACE_ZOOM && <rect width="100%" height="100%" fill={`url(#${pattern})`} />}
          <g data-trace-world="" transform={`translate(${x} ${y}) scale(${zoom})`}>
            <FlowContent graph={graph} selectedId={selectedId} onSelect={onSelect} />
          </g>
        </svg>
      </div>
    </section>
  );
}
const FlowContent = memo(function FlowContent({
  graph,
  selectedId,
  onSelect,
}: {
  graph: ReturnType<typeof layoutTraceCallTree>;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      {graph.nodes.map(({ node, x, y }) => (
        <FlowNode
          key={node.id}
          node={node}
          transform={`translate(${x} ${y})`}
          selected={node.id === selectedId}
          onSelect={onSelect}
        />
      ))}
      {graph.edges.map((edge) => (
        <TraceFlowEdge key={edge.id} edge={edge} selectedId={selectedId} />
      ))}
    </>
  );
});
function CallDetailDialog({
  traceId,
  node,
  onClose,
}: {
  traceId: string;
  node: TraceCallNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const { entry } = node.row;
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => element.close();
  }, []);

  function close() {
    dialog.current?.close();
    onClose();
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className={styles.dialogHeader}>
        <div>
          <h3 id={title}>调用详情</h3>
          <p>
            {entry.service} · {entry.instanceAddress ?? entry.instance}
          </p>
        </div>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={close}>
          关闭
        </button>
      </header>
      <div className={styles.dialogBody}>
        <p className={styles.dialogSummary}>{summarizeTraceLog(entry.message)}</p>
        <TraceLogContent traceId={traceId} entryId={entry.entryId} />
        {node.logs
          .filter((log) => log !== entry)
          .map((log) => (
            <div key={log.entryId} className={styles.related}>
              <p className={styles.preview}>{summarizeTraceLog(log.message)}</p>
              <TraceLogDetails traceId={traceId} entryId={log.entryId} />
            </div>
          ))}
      </div>
    </dialog>
  );
}
function findCall(nodes: TraceCallNode[], id: string): TraceCallNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findCall(node.children, id);
    if (child) return child;
  }
}

function shortenLabel(value: string, units: number): string {
  let remaining = units;
  let label = '';
  for (const character of value) {
    remaining -= character.charCodeAt(0) > 127 ? 2 : 1;
    if (remaining < 0) return label + '…';
    label += character;
  }
  return label;
}

const FlowNode = memo(function FlowNode({
  node,
  transform,
  selected,
  onSelect,
}: {
  node: TraceCallNode;
  transform: string;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { entry, timestampNs } = node.row;
  const summary = summarizeTraceLog(entry.message);
  const { fields } = parseLog(entry.message);
  const request = formatTraceRequest(fields) ?? summary;
  const status = fields?.status;
  const duration = typeof fields?.durationMs === 'number' ? fields.durationMs + ' ms' : '';
  const address = entry.instanceAddress ?? (entry.instance || '—');
  const level = entry.level ?? '—';
  const badge = typeof status === 'number' ? `HTTP ${status}` : shortenLabel(level, 7);
  const failed = (status ?? 0) >= 400 || level === 'ERROR';
  const succeeded = status !== undefined && status >= 200 && status < 300;
  const kind = entry.service === 'gateway-service' ? '网关' : '服务';
  const title = [entry.service, address, summary, badge].filter(Boolean).join(' · ');
  const { width, height } = TRACE_NODE_SIZE;

  return (
    <g
      role="button"
      tabIndex={0}
      className={styles.node}
      transform={transform}
      data-call-id={node.id}
      aria-label={title}
      aria-haspopup="dialog"
      data-status={failed ? 'failed' : succeeded ? 'succeeded' : 'neutral'}
      data-selected={selected}
      onClick={(event) => {
        event.currentTarget.focus();
        onSelect(node.id);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(node.id);
        }
      }}
    >
      <title>{title}</title>
      <rect className={styles.nodeBox} width={width} height={height} rx="4" />
      <path
        className={styles.nodeHeader}
        d={`M 4 0.5 H ${width - 4} Q ${width - 0.5} 0.5 ${width - 0.5} 4 V 40 H .5 V 4 Q .5 .5 4 .5 Z`}
      />
      <path className={styles.nodeDivider} d={`M 0 40 H ${width} M 0 102 H ${width}`} />
      <text className={styles.nodeKind} x="12" y="25">
        {kind}
      </text>
      <svg x="48" width={width - 131} height="40" overflow="hidden">
        <text className={styles.nodeName} y="25">
          {shortenLabel(entry.service || '—', 18)}
        </text>
      </svg>
      <rect className={styles.statusBadge} x={width - 77} y="10" width="65" height="20" rx="4" />
      <text className={styles.statusLabel} x={width - 44.5} y="24" textAnchor="middle">
        {badge}
      </text>
      <text className={styles.nodeRoute} x="12" y="65">
        {shortenLabel(request, 34)}
      </text>
      <text className={styles.instanceLabel} x="12" y="88">
        实例
      </text>
      <text className={styles.nodeAddress} x="48" y="88">
        {shortenLabel(address, 30)}
      </text>
      <text className={styles.nodeTime} x="12" y="123">
        {formatTraceLogTime(timestampNs)}
      </text>
      {typeof status === 'number' && entry.level && (
        <text className={styles.level} x="173" y="123">
          {shortenLabel(level, 7)}
        </text>
      )}
      <text className={styles.metrics} x={width - 12} y="123" textAnchor="end">
        {shortenLabel(duration, 9)}
      </text>
    </g>
  );
});
