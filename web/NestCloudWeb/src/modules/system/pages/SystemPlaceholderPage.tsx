import type { PageRouteConfig } from '../../../app/routes/routeRegistry';

interface Props {
  config: PageRouteConfig;
}

export function SystemPlaceholderPage({ config }: Props) {
  return (
    <div className="page-card">
      <h1>{config.title}</h1>
      <p>{config.description}</p>
      <p>下一步会把 system-service 现有对应页面迁移到这里。</p>
    </div>
  );
}
