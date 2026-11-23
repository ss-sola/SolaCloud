import { memo, useEffect, useId, useRef, useState } from 'react';
import type { layoutTraceCallTree } from '../utils/traceLogPresentation';
import styles from './TraceFlowEdge.module.css';

type Edge = ReturnType<typeof layoutTraceCallTree>['edges'][number];
const TRAVEL_MS = [1700, 2200, 2800] as const;
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

// Only visible rails need moving SVG elements. Share the observer across the diagram.
let visibility: IntersectionObserver | undefined;
const visibilityListeners = new Map<Element, (visible: boolean) => void>();

function observeEdge(edge: SVGGElement, onVisible: (visible: boolean) => void) {
  if (typeof IntersectionObserver === 'undefined') {
    onVisible(true);
    return;
  }
  visibility ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      visibilityListeners.get(entry.target)?.(entry.isIntersecting);
    }
  });
  visibilityListeners.set(edge, onVisible);
  visibility.observe(edge);
  return () => {
    visibility?.unobserve(edge);
    visibilityListeners.delete(edge);
    if (visibilityListeners.size === 0) {
      visibility?.disconnect();
      visibility = undefined;
    }
  };
}

function phaseOffset(id: string, duration: number) {
  let value = 0;
  for (const character of id) value = (Math.imul(value, 31) + character.charCodeAt(0)) >>> 0;
  return value % duration;
}

export const TraceFlowEdge = memo(function TraceFlowEdge({
  edge,
  selectedId,
}: {
  edge: Edge;
  selectedId?: string;
}) {
  const group = useRef<SVGGElement>(null);
  const [moving, setMoving] = useState(false);
  const pathId = useId();
  const clipId = pathId + '-gap';
  const trailId = pathId + '-trail';
  const glowId = pathId + '-glow';
  const highlighted = selectedId === edge.id || selectedId === edge.parentId;
  // Leave at least 90 drawing units per pulse so a short hop has a distinct leading light.
  const span = Math.hypot(edge.to.x - edge.from.x, edge.to.y - edge.from.y);
  const count = Math.max(1, Math.min(3, Math.floor(span / 90)));
  const duration = TRAVEL_MS[count - 1] * (edge.failed ? 2 : 1);
  const phase = phaseOffset(edge.id, duration);

  useEffect(() => {
    if (!group.current) return;
    const preference = window.matchMedia(REDUCED_MOTION);
    let inView = false;
    const sync = () => setMoving(inView && !preference.matches);
    const unobserve = observeEdge(group.current, (visible) => {
      inView = visible;
      sync();
    });
    preference.addEventListener('change', sync);
    return () => {
      unobserve?.();
      preference.removeEventListener('change', sync);
    };
  }, []);

  return (
    <g
      ref={group}
      className={styles.edge}
      aria-hidden="true"
      data-failed={edge.failed}
      data-priority={edge.highPriority}
      data-highlight={highlighted}
      data-dimmed={Boolean(selectedId) && !highlighted}
    >
      <path d={edge.path} className={styles.halo} />
      <path d={edge.path} className={styles.glow} />
      <path id={pathId} d={edge.path} className={styles.track} />
      <defs>
        <linearGradient id={trailId}>
          <stop offset="0" stopColor="var(--signal-tail)" stopOpacity="0" />
          <stop offset=".42" stopColor="var(--signal-tail)" stopOpacity=".65" />
          <stop offset=".80" stopColor="var(--signal)" />
          <stop offset="1" stopColor="var(--core)" />
        </linearGradient>
        <radialGradient id={glowId}>
          <stop stopColor="var(--signal)" stopOpacity=".84" />
          <stop offset=".42" stopColor="var(--signal)" stopOpacity=".44" />
          <stop offset="1" stopColor="var(--signal)" stopOpacity="0" />
        </radialGradient>
        <clipPath id={clipId}>
          <rect
            x={Math.min(edge.from.x, edge.to.x) - 20}
            y={edge.from.y}
            width={Math.abs(edge.to.x - edge.from.x) + 40}
            height={edge.to.y - edge.from.y}
          />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {moving &&
          Array.from({ length: count }, (_, index) => {
            const begin = `-${(phase + (index * duration) / count) % duration}ms`;
            return (
              <g key={index} data-trace-flow="" className={styles.particle}>
                <animateMotion
                  dur={`${duration}ms`}
                  begin={begin}
                  repeatCount="indefinite"
                  rotate="auto"
                >
                  <mpath href={`#${pathId}`} />
                </animateMotion>
                <animate
                  attributeName="opacity"
                  values="0;1;1;0"
                  keyTimes="0;.06;.94;1"
                  dur={`${duration}ms`}
                  begin={begin}
                  repeatCount="indefinite"
                />
                <ellipse cx="-1" rx="9" ry="5.5" fill={`url(#${glowId})`} />
                <path
                  d="M -16 0 Q -9 -.7 -2.5 -2.1 Q 1.5 -2.3 2 0 Q 1.5 2.3 -2.5 2.1 Q -9 .7 -16 0 Z"
                  fill={`url(#${trailId})`}
                />
                <circle className={styles.core} r="2.7" />
              </g>
            );
          })}
      </g>
      <path className={styles.hit} d={edge.path} />
      <circle className={styles.port} cx={edge.from.x} cy={edge.from.y} r="6" />
      <circle className={styles.port} cx={edge.to.x} cy={edge.to.y} r="6" />
    </g>
  );
});
