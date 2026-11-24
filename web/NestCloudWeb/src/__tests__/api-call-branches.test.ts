import { describe, expect, it } from 'vitest';
import {
  buildCallBranches,
  expandPathToMethod,
  httpEntryId,
} from '../modules/system/utils/apiCallBranches';

const node = (id: string) => ({ id, name: id, file: 'routes.ts', line: 12 });
const entry = node(httpEntryId);
const edge = (from: string, to: string) => ({ from, to });
const graph = (ids: string[], roots: string[], pairs: string[][]) => ({
  nodes: ids.map(node),
  roots,
  edges: pairs.map(([a, b]) => edge(a, b)),
});
const expanded = new Set<string>();

describe('HTTP 入口与方法折叠', () => {
  it('空的具名调用图仍有入口，多根和独立实际入口均锚定同一节点', () => {
    const empty = buildCallBranches(graph([], [], []), entry, expanded);
    expect(empty.nodes).toEqual([entry]);
    expect(empty.roots).toEqual([entry.id]);
    expect(empty.childCounts.get(entry.id)).toBe(0);
    const results = buildCallBranches(
      graph(['A', 'B', 'C'], ['A', 'bad'], [['A', 'B']]),
      entry,
      expanded,
      ['C', 'A'],
    );
    expect(results.edges).toEqual([edge(entry.id, 'A'), edge(entry.id, 'C'), edge('A', 'B')]);
  });

  it('折叠一侧共享调用时保留另一侧，嵌套折叠不会将孤立方法提为根', () => {
    const g = graph(
      ['a', 'b', 'shared', 'leaf', 'private'],
      ['a', 'b'],
      [
        ['a', 'shared'],
        ['a', 'private'],
        ['b', 'shared'],
        ['shared', 'leaf'],
        ['shared', 'a'],
      ],
    );
    const folded = buildCallBranches(g, entry, new Set(['a', 'shared']));
    expect(folded.nodes.map((n) => n.id)).toEqual([entry.id, 'a', 'b', 'shared']);
    expect(folded.edges).toEqual([edge(entry.id, 'a'), edge(entry.id, 'b'), edge('b', 'shared')]);
    expect(folded.childCounts.get('a')).toBe(2);
    expect(folded.hiddenCount).toBe(2);
    const onlyEntry = buildCallBranches(g, entry, new Set([entry.id]));
    expect(onlyEntry.nodes).toEqual([entry]);
    expect(onlyEntry.childCounts.get(entry.id)).toBe(2);
  });

  it('为缺根的环连通分量补一个入口，不把其后继也当作入口', () => {
    const g = graph(
      ['leaf', 'b', 'a', 'x'],
      [],
      [
        ['a', 'b'],
        ['b', 'a'],
        ['b', 'leaf'],
      ],
    );
    const full = buildCallBranches(g, entry, expanded);
    const roots = full.edges.filter((e) => e.from === entry.id).map((e) => e.to);
    expect(roots).toContain('x');
    expect(roots).not.toContain('leaf');
    expect(roots).toHaveLength(2);
    const cycleRoot = roots.find((id) => id !== 'x')!;
    const folded = buildCallBranches(g, entry, new Set([cycleRoot]));
    expect(folded.nodes.map((n) => n.id).sort()).toEqual([entry.id, 'x', cycleRoot].sort());
  });

  it('定位只展开一条需要打开最少折叠的路径，保留目标和旁支的收起状态', () => {
    const g = graph(
      ['a', 'b', 'c', 'd', 'target', 'other'],
      ['a', 'c'],
      [
        ['a', 'b'],
        ['b', 'target'],
        ['c', 'd'],
        ['d', 'target'],
        ['c', 'other'],
      ],
    );
    const full = buildCallBranches(g, entry, expanded);
    const before = new Set(['a', 'b', 'c', 'target', 'other']);
    expect(expandPathToMethod(full, before, 'target')).toEqual(
      new Set(['a', 'b', 'target', 'other']),
    );
    expect(expandPathToMethod(full, before, 'a')).toEqual(before);
    expect(expandPathToMethod(full, before, 'missing')).toEqual(before);
    expect(before.has('c')).toBe(true);
  });
});
