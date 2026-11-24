import type { MethodGraph, MethodNode } from '../api/apiCallGraph';

// Source method IDs always end in a numeric offset.
export const httpEntryId = 'http:entry';
type Topology = Pick<MethodGraph, 'nodes' | 'edges' | 'roots'>;

function reachable(
  starts: Iterable<string>,
  children: ReadonlyMap<string, Set<string>>,
  { stop, seen = new Set<string>() }: { stop?: ReadonlySet<string>; seen?: Set<string> } = {},
) {
  const pending = [...starts];
  for (let index = 0; index < pending.length; index++) {
    const id = pending[index];
    if (seen.has(id)) continue;
    seen.add(id);
    if (!stop?.has(id)) for (const next of children.get(id) ?? []) pending.push(next);
  }
  return seen;
}

/** A rootless cycle can itself lead to a second cycle or a leaf. Reverse DFS finish order
 * visits source components before those descendants, irrespective of input node order. */
function attachDetachedComponents(
  ids: ReadonlySet<string>,
  roots: Set<string>,
  children: ReadonlyMap<string, Set<string>>,
) {
  const seen = reachable(roots, children);
  if (seen.size === ids.size) return;
  const visited = new Set(seen);
  const finished: string[] = [];
  for (const start of ids) {
    if (visited.has(start)) continue;
    const stack: { id: string; returning: boolean }[] = [{ id: start, returning: false }];
    while (stack.length) {
      const { id, returning } = stack.pop()!;
      if (returning) {
        finished.push(id);
        continue;
      }
      if (visited.has(id)) continue;
      visited.add(id);
      stack.push({ id, returning: true });
      for (const next of children.get(id) ?? []) {
        if (!visited.has(next)) stack.push({ id: next, returning: false });
      }
    }
  }
  for (let index = finished.length - 1; index >= 0; index--) {
    const candidate = finished[index];
    if (seen.has(candidate)) continue;
    roots.add(candidate);
    reachable([candidate], children, { seen });
  }
}

/** Anchor once using the complete topology, then hide only methods no longer reachable
 * through an expanded caller. Folding a parent cannot manufacture a new entry edge. */
export function buildCallBranches(
  graph: Topology,
  entry: MethodNode,
  collapsedIds: ReadonlySet<string>,
  observedRootIds: Iterable<string> = [],
) {
  const ids = new Set(graph.nodes.map((node) => node.id));
  const children = new Map<string, Set<string>>();
  for (const { from, to } of graph.edges) {
    if (!ids.has(from) || !ids.has(to)) continue;
    let group = children.get(from);
    if (!group) children.set(from, (group = new Set()));
    group.add(to);
  }
  const roots = new Set(graph.roots.filter((id) => ids.has(id)));
  for (const id of observedRootIds) if (ids.has(id)) roots.add(id);
  attachDetachedComponents(ids, roots, children);
  children.set(entry.id, roots);
  const visible = reachable([entry.id], children, { stop: collapsedIds });
  const nodes = [entry, ...graph.nodes.filter((node) => visible.has(node.id))];
  const edges: MethodGraph['edges'] = [];
  const childCounts = new Map<string, number>();
  for (const { id } of nodes) {
    const next = children.get(id);
    childCounts.set(id, next?.size ?? 0);
    if (next && !collapsedIds.has(id)) {
      for (const to of next) edges.push({ from: id, to });
    }
  }
  return { nodes, edges, roots: [entry.id], childCounts, hiddenCount: ids.size + 1 - nodes.length };
}

/** Find one route to a search result that opens the fewest folded callers. */
export function expandPathToMethod(
  expanded: Topology,
  collapsedIds: ReadonlySet<string>,
  targetId: string,
) {
  const collapsed = new Set(collapsedIds);
  const children = new Map<string, string[]>();
  for (const { from, to } of expanded.edges) {
    const next = children.get(from);
    if (next) next.push(to);
    else children.set(from, [to]);
  }
  type Step = { id: string; parent?: string };
  let wave: Step[] = expanded.roots.map((id) => ({ id }));
  const parents = new Map<string, string | undefined>();
  while (wave.length) {
    const delayed: Step[] = [];
    for (let index = 0; index < wave.length; index++) {
      const { id, parent } = wave[index];
      if (parents.has(id)) continue;
      parents.set(id, parent);
      if (id === targetId) {
        for (let at = parent; at !== undefined; at = parents.get(at)) collapsed.delete(at);
        return collapsed;
      }
      // Each wave costs one additional unfolded caller. Ordinary edges stay in
      // the current wave so already visible, shared destinations are preferred.
      const nextWave = collapsed.has(id) ? delayed : wave;
      for (const child of children.get(id) ?? []) {
        if (!parents.has(child)) nextWave.push({ id: child, parent: id });
      }
    }
    wave = delayed;
  }
  return collapsed;
}
