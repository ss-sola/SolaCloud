export interface Route {
  id: string;
  method: string;
  path: string;
  file: string;
  line: number;
}
export interface Catalog {
  framework: 'koa' | 'nestjs' | 'unknown';
  entry?: string;
  routes: Route[];
  warnings: string[];
}
export interface Graph {
  roots: string[];
  nodes: {
    id: string;
    name: string;
    file: string;
    line: number;
    anonymous?: boolean;
    computationOnly?: boolean;
  }[];
  edges: { from: string; to: string }[];
  warnings: string[];
}
export interface ProbeRoute extends Pick<Route, 'id' | 'method' | 'path'> {
  roots: string[];
}

export interface ProbeTarget {
  project: string;
  framework: Exclude<Catalog['framework'], 'unknown'>;
  entry: string;
  routes: ProbeRoute[];
  computations: (routeId: string) => ReadonlySet<string> | undefined;
}
