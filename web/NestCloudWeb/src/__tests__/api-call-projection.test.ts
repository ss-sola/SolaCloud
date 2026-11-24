import { describe, expect, it } from 'vitest';
import type { MethodGraph, MethodNode } from '../modules/system/api/apiCallGraph';
import { isAnonymousMethod, projectMethodGraph } from '../modules/system/utils/apiCallProjection';

const node = (id: string, anonymous?: boolean): MethodNode => ({
  id,
  name: id,
  file: 'src/test.ts',
  line: 1,
  anonymous,
});
const edge = (from: string, to: string) => ({ from, to });

describe('方法调用图投影', () => {
  it('优先沿用源码分类，仅对旧图识别生成标签', () => {
    expect(isAnonymousMethod(node('保存回调'))).toBe(false);
    expect(isAnonymousMethod(node('router.get 回调'))).toBe(true);
    expect(isAnonymousMethod(node('回调 L12'))).toBe(true);
    expect(isAnonymousMethod(node('回调 L12', false))).toBe(false);
    expect(isAnonymousMethod(node('匿名函数', false))).toBe(false);
    expect(isAnonymousMethod(node('命名箭头', false))).toBe(false);
    expect(isAnonymousMethod(node('中间件', true))).toBe(true);
  });

  it('提升隐藏入口、绕过被排除的方法和匿名回调、合并重复边并保留递归', () => {
    const graph: MethodGraph = {
      nodes: ['入口', '甲', '匿名', '排除', '乙', '丙', '独立'].map((id) => node(id)),
      roots: ['入口', '独立'],
      edges: [
        edge('入口', '甲'),
        edge('入口', '匿名'),
        edge('甲', '匿名'),
        edge('匿名', '排除'),
        edge('排除', '匿名'),
        edge('排除', '甲'),
        edge('排除', '乙'),
        edge('甲', '乙'),
        edge('乙', '丙'),
      ],
      warnings: ['局部动态调用'],
    };
    const projected = projectMethodGraph(graph, new Set(['甲', '乙', '丙', '独立']));
    expect(projected.roots).toEqual(['独立', '甲', '乙']);
    expect(projected.edges).toEqual([edge('甲', '乙'), edge('甲', '甲'), edge('乙', '丙')]);
    expect(projected.nodes.map((item) => item.id)).toEqual(['甲', '乙', '丙', '独立']);
    expect(projected.warnings).toEqual(graph.warnings);
    expect(graph.edges).toHaveLength(9);
  });

  it('深链与隐藏环迭代收敛，全隐藏时返回空图', () => {
    const len = 6000;
    const nodes = Array.from({ length: len }, (_, i) => node(String(i)));
    const edges = nodes.slice(1).map(({ id }, i) => edge(String(i), id));
    edges.push(edge(String(len - 2), '1'));
    const graph = { nodes, edges, roots: ['0'], warnings: [] };
    expect(projectMethodGraph(graph, new Set(['0', String(len - 1)])).edges).toEqual([
      edge('0', String(len - 1)),
    ]);
    expect(projectMethodGraph(graph, new Set())).toEqual({
      nodes: [],
      edges: [],
      roots: [],
      warnings: [],
    });
  });
});
