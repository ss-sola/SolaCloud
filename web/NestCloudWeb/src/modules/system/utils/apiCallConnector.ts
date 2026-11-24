import type { MethodNode } from '../api/apiCallGraph';

type Point = { x: number; y: number };
type Box = { left: number; right: number; top: number; bottom: number };
type Port = { tip: Point; outer: Point; dx: number; dy: number };
type Cell = Box & { links: Gate[] };
type Gate = { to: Cell; left: number; right: number; y: number };
type Visit = {
  cell: Cell;
  point: Point;
  previous?: Visit;
  start: Port;
  cost: number;
  score: number;
};
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const between = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const lerp = (a: Point, b: Point, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const xy = ({ x, y }: Point) => x + ' ' + y;

function bounds(points: Point[]): Box {
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}
function overlaps(a: Box, b: Box) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// Grid buckets keep nearby curves independent of the total number of cards.
// A very long segment scans the existing boxes instead of visiting empty buckets.
function obstacles(boxes: Box[], w: number, h: number) {
  const bins = new Map<string, Box[]>();
  const xBin = (x: number) => Math.floor(x / (w * 1.5));
  const yBin = (y: number) => Math.floor(y / (h * 1.5));
  for (const box of boxes) {
    for (let x = xBin(box.left); x <= xBin(box.right); x++)
      for (let y = yBin(box.top); y <= yBin(box.bottom); y++) {
        const key = x + ',' + y;
        const bin = bins.get(key);
        if (bin) bin.push(box);
        else bins.set(key, [box]);
      }
  }
  return (area: Box) => {
    const left = xBin(area.left),
      right = xBin(area.right),
      top = yBin(area.top),
      bottom = yBin(area.bottom);
    if ((right - left + 1) * (bottom - top + 1) > boxes.length)
      return boxes.filter((box) => overlaps(area, box));
    const found = new Set<Box>();
    for (let x = left; x <= right; x++)
      for (let y = top; y <= bottom; y++) {
        for (const box of bins.get(x + ',' + y) ?? []) if (overlaps(area, box)) found.add(box);
      }
    return [...found];
  };
}
type Nearby = ReturnType<typeof obstacles>;

function clearLine(a: Point, b: Point, nearby: Nearby) {
  for (const box of nearby(bounds([a, b]))) {
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const x0 = dx ? (box.left - a.x) / dx : -Infinity,
      x1 = dx ? (box.right - a.x) / dx : Infinity;
    const y0 = dy ? (box.top - a.y) / dy : -Infinity,
      y1 = dy ? (box.bottom - a.y) / dy : Infinity;
    if (
      Math.max(0, Math.min(x0, x1), Math.min(y0, y1)) <
      Math.min(1, Math.max(x0, x1), Math.max(y0, y1))
    )
      return false;
  }
  return true;
}

// Bézier curves stay inside their control hull. Subdivide inconclusive boxes
// and reject any remaining uncertainty, including very thin obstacles.
function clearCurve(points: Point[], boxes: Box[], depth = 0): boolean {
  const area = bounds(points);
  const hits = boxes.filter((box) => overlaps(area, box));
  if (!hits.length) return true;
  if (depth === 7) return false;
  const left = [points[0]],
    right = [points.at(-1)!];
  let level = points;
  while (level.length > 1) {
    level = level.slice(1).map((p, i) => lerp(level[i], p, 0.5));
    left.push(level[0]);
    right.unshift(level.at(-1)!);
  }
  return clearCurve(left, hits, depth + 1) && clearCurve(right, hits, depth + 1);
}

function ports(box: Box, target: boolean, stub: number): Port[] {
  const x = (box.left + box.right) / 2,
    y = (box.top + box.bottom) / 2;
  return [
    [box.right, y, 1, 0],
    [x, box.bottom, 0, 1],
    [box.left, y, -1, 0],
    [x, box.top, 0, -1],
  ].map(([x, y, dx, dy]) => ({
    tip: {
      x: x + dx * (target ? Math.min(2, stub) : 0),
      y: y + dy * (target ? Math.min(2, stub) : 0),
    },
    outer: { x: x + dx * stub, y: y + dy * stub },
    dx,
    dy,
  }));
}

function control(origin: Point, port: Port, reach: number, frame: Box): Point {
  return {
    x: between(origin.x + port.dx * reach, frame.left, frame.right),
    y: between(origin.y + port.dy * reach, frame.top, frame.bottom),
  };
}

function smoothDirect(a: Port, b: Port, nearby: Nearby, frame: Box) {
  const length = distance(a.tip, b.tip);
  if (
    (a.tip.x === b.tip.x || a.tip.y === b.tip.y) &&
    (b.tip.x - a.tip.x) * a.dx + (b.tip.y - a.tip.y) * a.dy > 0 &&
    a.dx === -b.dx &&
    a.dy === -b.dy &&
    clearLine(a.tip, b.tip, nearby)
  )
    return 'M ' + xy(a.tip) + ' L ' + xy(b.tip);
  const reach = Math.min(100, Math.max(8, length * 0.42));
  const first = control(a.tip, a, reach, frame);
  const second = control(b.tip, b, reach, frame);
  const curve = [a.tip, first, second, b.tip];
  return clearCurve(curve, nearby(bounds(curve)))
    ? 'M ' + xy(a.tip) + ' C ' + xy(first) + ' ' + xy(second) + ' ' + xy(b.tip)
    : '';
}

// Horizontal free-space decomposition. Unchanged openings share one cell over
// consecutive slabs. Gaps of positive width become traversable portals.
function channels(boxes: Box[], margin: number, frame: Box) {
  const sorted = boxes
    .map((b) => ({
      left: b.left - margin,
      right: b.right + margin,
      top: b.top - margin,
      bottom: b.bottom + margin,
    }))
    .sort((a, b) => a.left - b.left);
  const ys = [...new Set(sorted.flatMap((b) => [b.top, b.bottom]))].sort((a, b) => a - b);
  const { left, right } = frame;
  ys.unshift(frame.top);
  ys.push(frame.bottom);
  const slabs: Cell[][] = [];
  let previous: Cell[] = [];
  for (let i = 0; i < ys.length - 1; i++) {
    const top = ys[i],
      bottom = ys[i + 1];
    const reuse = new Map(previous.map((c) => [c.left + ',' + c.right, c]));
    const current: Cell[] = [];
    function opening(l: number, r: number) {
      if (l >= r) return;
      const cell = reuse.get(l + ',' + r) ?? { left: l, right: r, top, bottom, links: [] };
      cell.bottom = bottom;
      current.push(cell);
    }
    let x = left;
    for (const b of sorted) {
      if (b.top >= bottom || b.bottom <= top) continue;
      opening(x, b.left);
      x = Math.max(x, b.right);
    }
    opening(x, right);
    let a = 0,
      b = 0;
    while (a < previous.length && b < current.length) {
      const prev = previous[a],
        next = current[b];
      const l = Math.max(prev.left, next.left),
        r = Math.min(prev.right, next.right);
      if (prev !== next && r > l) {
        prev.links.push({ to: next, left: l, right: r, y: top });
        next.links.push({ to: prev, left: l, right: r, y: top });
      }
      if (prev.right <= next.right) a++;
      if (next.right <= prev.right) b++;
    }
    slabs.push(current);
    previous = current;
  }
  return (p: Point): Cell[] => {
    let lo = 0,
      hi = ys.length - 1;
    while (hi - lo > 1) {
      const mid = (hi + lo) >>> 1;
      if (ys[mid] <= p.y) lo = mid;
      else hi = mid;
    }
    const rows = lo > 0 && ys[lo] === p.y ? [slabs[lo - 1], slabs[lo]] : [slabs[lo]];
    const hits = new Set<Cell>();
    for (const row of rows)
      for (const cell of row)
        if (p.x >= cell.left && p.x <= cell.right && p.y >= cell.top && p.y <= cell.bottom)
          hits.add(cell);
    return [...hits];
  };
}

// Search all four start ports together, visiting the most promising cell first.
class Frontier {
  items: Visit[] = [];
  push(v: Visit) {
    let i = this.items.length;
    this.items.push(v);
    while (i > 0) {
      const parent = (i - 1) >>> 1;
      if (this.items[parent].score <= v.score) break;
      this.items[i] = this.items[parent];
      i = parent;
    }
    this.items[i] = v;
  }
  pop() {
    const first = this.items[0],
      last = this.items.pop();
    if (!last || !this.items.length) return first;
    let i = 0;
    while (i * 2 + 1 < this.items.length) {
      let child = i * 2 + 1;
      if (child + 1 < this.items.length && this.items[child + 1].score < this.items[child].score)
        child++;
      if (this.items[child].score >= last.score) break;
      this.items[i] = this.items[child];
      i = child;
    }
    this.items[i] = last;
    return first;
  }
}

function detour(a: Port[], b: Port[], locate: ReturnType<typeof channels>, nearby: Nearby) {
  const ends = new Map<Cell, Port[]>();
  for (const port of b)
    if (clearLine(port.tip, port.outer, nearby)) {
      for (const cell of locate(port.outer)) {
        const available = ends.get(cell);
        if (available) available.push(port);
        else ends.set(cell, [port]);
      }
    }
  if (!ends.size) return '';
  const estimate = (p: Point) => Math.min(...b.map((port) => distance(p, port.outer)));
  const frontier = new Frontier(),
    visited = new Set<Cell>();
  for (const start of a)
    if (clearLine(start.tip, start.outer, nearby)) {
      for (const cell of locate(start.outer))
        frontier.push({ cell, start, point: start.outer, cost: 0, score: estimate(start.outer) });
    }
  while (frontier.items.length) {
    const step = frontier.pop();
    if (visited.has(step.cell)) continue;
    visited.add(step.cell);
    const targets = ends.get(step.cell);
    if (targets) {
      const goal = targets.reduce((a, b) =>
        distance(step.point, a.outer) <= distance(step.point, b.outer) ? a : b,
      );
      const through: Point[] = [];
      for (let at: Visit | undefined = step; at; at = at.previous) through.push(at.point);
      through.reverse();
      through.push(goal.outer);
      // Each consecutive pair lies in a convex free cell. Remove unnecessary
      // portal points only when the resulting chord clears all actual cards.
      const short = [step.start.tip, through[0]];
      for (let i = 0; i < through.length - 1;) {
        let next = i + 1;
        while (next + 1 < through.length && clearLine(through[i], through[next + 1], nearby))
          next++;
        short.push(through[next]);
        i = next;
      }
      short.push(goal.tip);
      return rounded(short, nearby);
    }
    for (const gate of step.cell.links) {
      if (visited.has(gate.to)) continue;
      const inset = Math.min(2, (gate.right - gate.left) / 2);
      const point = { x: between(step.point.x, gate.left + inset, gate.right - inset), y: gate.y };
      const cost = step.cost + distance(step.point, point) + 1;
      frontier.push({
        cell: gate.to,
        start: step.start,
        point,
        previous: step,
        cost,
        score: cost + estimate(point),
      });
    }
  }
  return '';
}

function rounded(points: Point[], nearby: Nearby) {
  const p = points.filter((v, i) => i === 0 || distance(v, points[i - 1]) > 0.001);
  let path = 'M ' + xy(p[0]);
  for (let i = 1; i < p.length - 1; i++) {
    const before = distance(p[i], p[i - 1]),
      after = distance(p[i], p[i + 1]);
    const radius = Math.min(12, before / 2, after / 2);
    const a = lerp(p[i], p[i - 1], radius / before),
      b = lerp(p[i], p[i + 1], radius / after);
    const curve = [a, p[i], b];
    path += clearCurve(curve, nearby(bounds(curve)))
      ? ' L ' + xy(a) + ' Q ' + xy(p[i]) + ' ' + xy(b)
      : ' L ' + xy(p[i]);
  }
  return path + ' L ' + xy(p.at(-1)!);
}

export function prepareCallConnectors(
  positions: ReadonlyMap<string, { node: MethodNode; x: number; y: number }>,
  cardWidth: number,
  cardHeight: number,
) {
  if (!(cardWidth > 0 && cardHeight > 0) || !Number.isFinite(cardWidth + cardHeight))
    return (_from: string, _to: string) => '';
  const byId = new Map(
    [...positions].map(([id, p]) => [
      id,
      { left: p.x, top: p.y, right: p.x + cardWidth, bottom: p.y + cardHeight },
    ]),
  );
  const boxes = [...byId.values()];
  const frame = {
    left: Math.min(...boxes.map((b) => b.left)) - 12,
    right: Math.max(...boxes.map((b) => b.right)) + 12,
    top: Math.min(...boxes.map((b) => b.top)) - 12,
    bottom: Math.max(...boxes.map((b) => b.bottom)) + 12,
  };
  const nearby = obstacles(boxes, cardWidth, cardHeight);
  const cache = new Map<string, string>();
  const spaces = new Map<number, ReturnType<typeof channels>>();
  function route(from: Box, to: Box) {
    const a = ports(from, false, 10),
      b = ports(to, true, 10);
    if (from === to) {
      for (const reach of [28, 10, 3])
        for (const port of a) {
          const spread = Math.min(12, (port.dx ? cardHeight : cardWidth) / 4);
          const start = { x: port.tip.x + port.dy * spread, y: port.tip.y - port.dx * spread };
          const end = {
            x: port.tip.x - port.dy * spread + 2 * port.dx,
            y: port.tip.y + port.dx * spread + 2 * port.dy,
          };
          const first = control(start, port, reach, frame);
          const last = control(end, port, reach, frame);
          const curve = [start, first, last, end];
          if (clearCurve(curve, nearby(bounds(curve))))
            return 'M ' + xy(start) + ' C ' + xy(first) + ' ' + xy(last) + ' ' + xy(end);
        }
      return '';
    }
    const pairs = a
      .flatMap((start) =>
        b.map((end) => ({ start, end, length: distance(start.outer, end.outer) })),
      )
      .sort((u, v) => u.length - v.length);
    for (const { start, end } of pairs) {
      const path = smoothDirect(start, end, nearby, frame);
      if (path) return path;
    }
    for (const margin of [5, 0]) {
      let locate = spaces.get(margin);
      if (!locate) {
        locate = channels(boxes, margin, frame);
        spaces.set(margin, locate);
      }
      const path = detour(
        margin ? a : ports(from, false, 0),
        margin ? b : ports(to, true, 0),
        locate,
        nearby,
      );
      if (path) return path;
    }
    return '';
  }
  return (from: string, to: string) => {
    const a = byId.get(from),
      b = byId.get(to);
    if (!a || !b) return '';
    const key = from + '\0' + to;
    const known = cache.get(key);
    if (known !== undefined) return known;
    const path = route(a, b);
    cache.set(key, path);
    return path;
  };
}
