import { expect, it } from 'vitest';
import { prepareCallConnectors } from '../modules/system/utils/apiCallConnector';

type Point = { x: number; y: number };
const points = (coords: Record<string, [number, number]>) =>
  new Map(
    Object.entries(coords).map(([id, [x, y]]) => [
      id,
      { x, y, node: { id, name: id, file: id + '.ts', line: 1 } },
    ]),
  );
const mix = (a: Point, b: Point, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

// Sample independently from the routing code (including the interiors of all
// quadratic and cubic curves and the cards at both ends).
function verify(path: string, rects: Point[], w: number, h: number) {
  expect(path.startsWith('M ')).toBe(true);
  const parts = path.split(/\s+/);
  let at = 0,
    origin = { x: 0, y: 0 };
  const point = () => ({ x: Number(parts[at++]), y: Number(parts[at++]) });
  while (at < parts.length) {
    const command = parts[at++];
    if (command === 'M') {
      origin = point();
      continue;
    }
    const control = [origin];
    const count = command === 'L' ? 1 : command === 'Q' ? 2 : command === 'C' ? 3 : 0;
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) control.push(point());
    const length = control
      .slice(1)
      .reduce((n, p, i) => n + Math.hypot(p.x - control[i].x, p.y - control[i].y), 0);
    for (let i = 1; i <= Math.ceil(length); i++) {
      const t = i / Math.ceil(length);
      let level = control;
      while (level.length > 1) level = level.slice(1).map((p, j) => mix(level[j], p, t));
      const { x, y } = level[0];
      for (const box of rects) {
        if (
          x > box.x + 0.001 &&
          x < box.x + w - 0.001 &&
          y > box.y + 0.001 &&
          y < box.y + h - 0.001
        )
          throw Error(`Path at (${x},${y}) entered a card at (${box.x},${box.y}): ${path}`);
      }
    }
    origin = control.at(-1)!;
  }
}

it('links near neighbours directly and routes past the intervening sibling in the same row', () => {
  const layout = points({
    validator: [0, 0],
    isTrusty: [266, 0],
    throwRequestError: [532, 0],
    checkVersion: [798, 0],
  });
  const route = prepareCallConnectors(layout, 238, 82);
  expect(route('validator', 'isTrusty')).toMatch(/^M [\d. ]+ L [\d. ]+$/);
  for (const to of ['throwRequestError', 'checkVersion']) {
    const path = route('validator', to);
    expect(path).toMatch(/ C | Q /);
    verify(path, [...layout.values()], 238, 82);
    expect(route('validator', to)).toBe(path);
  }
  expect(route('missing', 'isTrusty')).toBe('');
});

it('keeps curved self-calls, a shared callee, and opposing callers outside irregularly placed nodes', () => {
  const layout = points({
    from: [40, 42],
    sibling: [27, 180],
    middle: [190, 75],
    shared: [350, 97],
    other: [200, 242],
    side: [370, 218],
  });
  const route = prepareCallConnectors(layout, 128, 68);
  for (const [a, b] of [
    ['from', 'shared'],
    ['sibling', 'shared'],
    ['shared', 'from'],
    ['middle', 'middle'],
    ['other', 'from'],
    ['side', 'sibling'],
  ]) {
    verify(route(a, b), [...layout.values()], 128, 68);
  }
});

it('finds a rounded route through a dense staggered field without crossing cards', () => {
  const coords: Record<string, [number, number]> = {};
  for (let y = 0; y < 6; y++)
    for (let x = 0; x < 8; x++) coords[x + '-' + y] = [x * 77 + (y % 2) * 7, y * 45 + (x % 3) * 2];
  const field = points(coords),
    all = [...field.values()];
  const route = prepareCallConnectors(field, 65, 32);
  const long = route('1-1', '6-4');
  expect(long).toContain(' Q ');
  verify(long, all, 65, 32);
  for (const [a, b] of [
    ['5-2', '1-5'],
    ['7-5', '0-0'],
    ['4-4', '4-0'],
    ['3-3', '3-3'],
  ])
    verify(route(a, b), all, 65, 32);
});

it('indexes and reuses paths for a 1200-method graph', () => {
  const coords: Record<string, [number, number]> = {};
  for (let i = 0; i < 1200; i++)
    coords[String(i)] = [(i % 40) * 145 + (i % 3), Math.floor(i / 40) * 75 + (i % 5)];
  const graph = points(coords),
    route = prepareCallConnectors(graph, 128, 60);
  for (let i = 0; i < 1199; i++) {
    const from = String(i),
      to = String(i + 1);
    const line = route(from, to);
    expect(line).not.toBe('');
    expect(route(from, to)).toBe(line);
  }
  for (let i = 0; i < 130; i++) expect(route(String(i), String((i * 71 + 99) % 1200))).not.toBe('');
});
