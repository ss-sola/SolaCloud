import { graphBuilder } from './analyzer-graph.mjs';
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
  let build;
  return {
    framework: selected.framework,
    entry: selected.entry,
    routes,
    warnings: [...warnings],
    probeRoutes() {
      if (!routes.length) return [];
      build ??= graphBuilder(selected.root, syntax, catalog, program);
      return [...catalog.values()].map((registrations) => {
        const { id, method, path } = registrations[0].entry;
        return { id, method, path, roots: build(registrations, true) };
      });
    },
    graph(id) {
      if (!catalog.has(id)) throw new Error('所选接口不在当前项目清单中');
      build ??= graphBuilder(selected.root, syntax, catalog, program);
      return build(catalog.get(id));
    },
  };
}
