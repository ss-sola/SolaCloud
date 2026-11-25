import path from 'node:path';
import { graphBuilder, localProgram } from './analyzer-graph.mjs';
import { selectProjectStrategy } from './project-strategies.mjs';

export function createAnalyzer(project) {
  const selected = selectProjectStrategy(project);
  const { catalog, syntax, warnings, program } = selected.discover?.() ?? {
    catalog: new Map(),
    syntax: new Map(),
    warnings: [selected.warning],
  };
  const routes = [...catalog.values()]
    .map(([r]) => r.entry)
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  const workers = selected.discoverWorkers?.();
  const workerEntries = workers?.workerEntries ?? [];
  let build;
  function builder() {
    return (build ??= graphBuilder(
      selected.root,
      syntax,
      catalog,
      program ??
        localProgram(
          selected.root,
          syntax,
          workerEntries.map((file) => path.resolve(selected.root, file)),
        ),
    ));
  }
  return {
    framework: selected.framework,
    entry: selected.entry,
    workerEntries,
    routes,
    warnings: [...warnings, ...(workers?.warnings ?? [])],
    probeRoutes() {
      if (!routes.length) return [];
      return [...catalog.values()].map((registrations) => {
        const { id, method, path } = registrations[0].entry;
        return { id, method, path, roots: builder()(registrations, true) };
      });
    },
    graph(id) {
      if (!catalog.has(id)) throw new Error('所选接口不在当前项目清单中');
      return builder()(catalog.get(id));
    },
  };
}
