import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';

type Point = { x: number; y: number };
type Camera = Point & { zoom: number };
type Contact = { start: Point; point: Point };

export const MIN_TRACE_ZOOM = 0.25;
export const MAX_TRACE_ZOOM = 2;
const DRAG_THRESHOLD = 5;

export function useTraceDiagramCamera({ width, height }: { width: number; height: number }) {
  const viewport = useRef<HTMLDivElement>(null);
  const current = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const [camera, setCamera] = useState(current.current);
  const contacts = useRef(new Map<number, Contact>());
  const suppressClick = useRef(false);
  const dragging = useRef(false);

  function update(next: Camera) {
    current.current = next;
    setCamera(next);
  }

  useLayoutEffect(() => {
    const area = viewport.current;
    if (!area) return;
    update({ x: (area.clientWidth - width) / 2, y: 0, zoom: 1 });

    let previousWidth = area.clientWidth;
    const resize = new ResizeObserver(() => {
      const difference = area.clientWidth - previousWidth;
      previousWidth = area.clientWidth;
      if (difference) update({ ...current.current, x: current.current.x + difference / 2 });
    });
    resize.observe(area);

    function wheel(event: WheelEvent) {
      event.preventDefault();
      const area = event.currentTarget as HTMLDivElement;
      const rect = area.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? area.clientHeight : 1;
      const factor = Math.exp(-event.deltaY * units * 0.002);
      update(scaleCamera(current.current, current.current.zoom * factor, anchor, anchor));
    }

    area.addEventListener('wheel', wheel, { passive: false });
    return () => {
      resize.disconnect();
      area.removeEventListener('wheel', wheel);
    };
  }, [width, height]);

  function fit() {
    const area = viewport.current;
    if (!area) return;
    const zoom = Math.min(1, area.clientWidth / width, area.clientHeight / height);
    update({
      x: (area.clientWidth - width * zoom) / 2,
      y: (area.clientHeight - height * zoom) / 2,
      zoom,
    });
  }

  function zoomFromCenter(value: number) {
    const area = viewport.current;
    if (!area) return;
    const center = { x: area.clientWidth / 2, y: area.clientHeight / 2 };
    update(scaleCamera(current.current, value, center, center));
  }

  function panBy(x: number, y: number) {
    const before = current.current;
    update({ ...before, x: before.x + x, y: before.y + y });
  }

  function localPoint(event: PointerEvent<HTMLDivElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function beginDrag(area: HTMLDivElement) {
    dragging.current = true;
    suppressClick.current = true;
    area.dataset.panning = 'true';
    for (const id of contacts.current.keys()) area.setPointerCapture(id);
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || contacts.current.size >= 2) return;
    const point = localPoint(event);
    if (!contacts.current.size) suppressClick.current = false;
    contacts.current.set(event.pointerId, { start: point, point });
    if (contacts.current.size === 2) beginDrag(event.currentTarget);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const contact = contacts.current.get(event.pointerId);
    if (!contact) return;
    const point = localPoint(event);
    const previousPoint = contact.point;
    contact.point = point;
    const other = [...contacts.current.values()].find((value) => value !== contact);
    if (other) {
      const before = midpoint(previousPoint, other.point);
      const after = midpoint(point, other.point);
      const factor =
        distance(point, other.point) / Math.max(1, distance(previousPoint, other.point));
      update(scaleCamera(current.current, current.current.zoom * factor, before, after));
      return;
    }
    if (!dragging.current) {
      if (distance(point, contact.start) < DRAG_THRESHOLD) return;
      beginDrag(event.currentTarget);
      panBy(point.x - contact.start.x, point.y - contact.start.y);
      return;
    }
    panBy(point.x - previousPoint.x, point.y - previousPoint.y);
  }

  function pointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (!contacts.current.delete(event.pointerId) || contacts.current.size) return;
    dragging.current = false;
    delete event.currentTarget.dataset.panning;
  }

  return {
    camera,
    viewport,
    fit,
    zoomFromCenter,
    panBy,
    suppressClick,
    pointerDown,
    pointerMove,
    pointerEnd,
    dragging,
  };
}

function distance(first: Point, second: Point) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function midpoint(first: Point, second: Point): Point {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function scaleCamera(camera: Camera, desired: number, from: Point, to: Point): Camera {
  const zoom = Math.max(Math.min(camera.zoom, MIN_TRACE_ZOOM), Math.min(MAX_TRACE_ZOOM, desired));
  const factor = zoom / camera.zoom;
  return { zoom, x: to.x - (from.x - camera.x) * factor, y: to.y - (from.y - camera.y) * factor };
}
