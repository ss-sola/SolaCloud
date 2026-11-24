import type { MethodGraph, MethodNode } from '../api/apiCallGraph';

export function isAnonymousMethod(node: MethodNode): boolean {
  if (typeof node.anonymous === 'boolean') return node.anonymous;
  // Old scanner/probe versions supplied a display label only. Match their
  // generated labels, leaving ordinary method names containing “回调” visible.
  return node.name === '匿名函数' || /\s回调$|(?:^|\s)回调 L\d+$/u.test(node.name);
}

/** Contract hidden paths without jumping across another visible method.
 * A cycle that returns to its visible caller remains a recursive edge. */
export function projectMethodGraph(
  graph: MethodGraph,
  visibleIds: ReadonlySet<string>,
): MethodGraph {
  const nodes = graph.nodes.filter((node) => visibleIds.has(node.id));
  if (!nodes.length) return { ...graph, nodes, edges: [], roots: [] };
  const visible = new Set(nodes.map((node) => node.id));
  const known = new Set(graph.nodes.map((node) => node.id));
  const outgoing = new Map<string, string[]>();
  for (const { from, to } of graph.edges) {
    if (!known.has(from) || !known.has(to)) continue;
    const neighbours = outgoing.get(from);
    if (neighbours) neighbours.push(to);
    else outgoing.set(from, [to]);
  }
  function nextVisible(starts: readonly string[]): string[] {
    const seen = new Set<string>();
    const found: string[] = [];
    const pending = [...starts];
    for (let offset = 0; offset < pending.length; offset++) {
      const id = pending[offset];
      if (seen.has(id)) continue;
      seen.add(id);
      if (visible.has(id)) found.push(id);
      else for (const child of outgoing.get(id) ?? []) pending.push(child);
    }
    return found;
  }
  const edges: MethodGraph['edges'] = [];
  for (const { id: from } of nodes) {
    for (const to of nextVisible(outgoing.get(from) ?? [])) edges.push({ from, to });
  }
  return { ...graph, nodes, roots: nextVisible(graph.roots), edges };
}
