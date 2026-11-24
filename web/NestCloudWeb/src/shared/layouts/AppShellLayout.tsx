import { Suspense, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { RouteRegistry } from '../../app/routes/routeRegistry';
import { getRouteByPath } from '../../app/routes/appRoutes';
import { useAuthStore } from '../../app/state/authStore';
import { SystemPageFrame } from '../../modules/system/pages/SystemPageFrame';
import {
  SystemPageFrameProvider,
  type SystemPageFrameState,
} from '../../modules/system/pages/SystemPageFrameContext';
import type { RuntimeMenuRoute } from '../api/systemApi';
import { resolveMenuIconUrl } from '../menuIconResolver';
import { TopbarActions } from './TopbarActions';

interface MenuNode {
  id: string;
  label: string;
  path: string;
  children: MenuNode[];
  isGroup: boolean;
  iconUrl?: string;
}

interface RenderMenuOptions {
  collapsedGroupIds: Set<string>;
  onToggleGroup: (groupId: string) => void;
}

interface DomainMeta {
  brandTitle: string;
  serviceLabel: string;
  emptyDescription: string;
}

function buildMenuTree(routes: RuntimeMenuRoute[]): MenuNode[] {
  return routes
    .filter((item) => item.isEnabled !== false)
    .map((item) => ({
      id: String(item.id),
      label: item.name,
      path: RouteRegistry.resolvePath(item),
      children: buildMenuTree(item.children ?? []),
      isGroup: RouteRegistry.isGroup(item),
      iconUrl: resolveMenuIconUrl(item.icon),
    }));
}

function getDepthStyle(depth: number): CSSProperties {
  return { '--sidebar-depth': depth } as CSSProperties;
}

function renderMenuLabel(label: string, iconUrl?: string) {
  return (
    <span style={{ alignItems: 'center', display: 'inline-flex', gap: 8 }}>
      {iconUrl ? (
        <img className="menu-icon" src={iconUrl} alt="" aria-hidden="true" width={16} height={16} />
      ) : null}
      <span>{label}</span>
    </span>
  );
}

function findAncestorGroupIds(items: MenuNode[], pathname: string, trail: string[] = []): string[] {
  for (const item of items) {
    if (item.isGroup) {
      const matchedChildTrail = findAncestorGroupIds(item.children, pathname, [...trail, item.id]);
      if (matchedChildTrail.length) {
        return matchedChildTrail;
      }
      continue;
    }
    if (item.path === pathname) {
      return trail;
    }
  }
  return [];
}

function renderMenuItems(items: MenuNode[], options: RenderMenuOptions, depth = 0) {
  return items.map((item) => {
    if (item.isGroup) {
      const collapsed = options.collapsedGroupIds.has(item.id);
      return (
        <div
          key={item.id}
          className="sidebar-group"
          data-collapsed={collapsed ? 'true' : 'false'}
          style={getDepthStyle(depth)}
        >
          <button
            type="button"
            className="sidebar-group-toggle"
            aria-expanded={collapsed ? 'false' : 'true'}
            onClick={() => options.onToggleGroup(item.id)}
          >
            <span className="sidebar-group-arrow" aria-hidden="true">
              ▾
            </span>
            <span className="sidebar-group-label">{renderMenuLabel(item.label, item.iconUrl)}</span>
          </button>
          <div className="sidebar-group-body" hidden={collapsed}>
            {renderMenuItems(item.children, options, depth + 1)}
          </div>
        </div>
      );
    }

    return (
      <NavLink
        key={item.id}
        to={item.path}
        end
        className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
        style={getDepthStyle(depth)}
      >
        {renderMenuLabel(item.label, item.iconUrl)}
      </NavLink>
    );
  });
}

const domainMeta: DomainMeta = {
  brandTitle: 'SYSTEM',
  serviceLabel: '服务：system-service',
  emptyDescription: '当前路径未匹配到可用菜单组件。',
};

function buildDefaultPageFrameState(title: string, description: string): SystemPageFrameState {
  return {
    title,
    description,
    serviceLabel: domainMeta.serviceLabel,
    capabilityLabel: '能力数：-',
    descriptionLabel: `当前页功能：${description}`,
  };
}


export function AppShellLayout() {
  const menuTree = useAuthStore((state) => state.menuTree);
  const location = useLocation();
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set());

  const menu = useMemo(() => buildMenuTree(menuTree), [menuTree]);

  const currentMenu = useMemo(
    () => RouteRegistry.findMenuByPath(menuTree, location.pathname),
    [location.pathname, menuTree],
  );

  // routeName = 菜单 routeName 字段（语义上即路由名称）
  const currentRouteName = currentMenu?.routeName ?? null;
  const currentRouteFromTable = getRouteByPath(location.pathname);

  const currentPageConfig = RouteRegistry.getPageConfig(currentRouteName);
  const currentRouteRoot =
    (currentMenu ? RouteRegistry.getRouteRoot(currentMenu) : null) ??
    RouteRegistry.resolveRouteRootFromPath(location.pathname);

  const defaultPagePath = useMemo(() => RouteRegistry.findFirstPagePath(menuTree), [menuTree]);
  const currentRootDefaultPath = useMemo(
    () => (currentRouteRoot ? RouteRegistry.findFirstPagePath(menuTree, currentRouteRoot) : null),
    [currentRouteRoot, menuTree],
  );

  const redirectPath = useMemo(() => {
    if (location.pathname === '/') {
      return defaultPagePath;
    }
    if (!currentRouteRoot) {
      return defaultPagePath && location.pathname !== defaultPagePath ? defaultPagePath : null;
    }
    if (!currentRootDefaultPath) {
      return defaultPagePath && location.pathname !== defaultPagePath ? defaultPagePath : null;
    }
    if (
      location.pathname !== currentRootDefaultPath &&
      (!currentMenu || RouteRegistry.isGroup(currentMenu) || !currentRouteFromTable?.component)
    ) {
      return currentRootDefaultPath;
    }
    return null;
  }, [
    currentMenu,
    currentRootDefaultPath,
    currentRouteRoot,
    currentRouteFromTable,
    defaultPagePath,
    location.pathname,
  ]);

  const expandedGroupIds = useMemo(
    () => findAncestorGroupIds(menu, location.pathname),
    [location.pathname, menu],
  );

  // 路由表中是否有对应路径的已注册页面组件
  const hasRegisteredRoute = currentRouteFromTable?.component != null;

  const shouldRenderSystemPage = hasRegisteredRoute && currentMenu != null;

  // 从路由表读 meta，优先于菜单 meta
  const activeRouteMeta = currentRouteFromTable?.meta;
  const hideAside = currentMenu?.hideRoute ?? false;
  const hideHeader =
    hideAside ||
    currentMenu?.hideHeader ||
    getRouteByPath(location.pathname)?.meta?.hideHeader ||
    false;

  const currentTitle =
    activeRouteMeta?.title ??
    currentPageConfig?.title ??
    currentMenu?.name ??
    domainMeta.brandTitle;
  const currentDescription =
    activeRouteMeta?.description ?? currentPageConfig?.description ?? domainMeta.emptyDescription;

  const frameTitle = shouldRenderSystemPage ? currentTitle : domainMeta.brandTitle;
  const initialFrameState = useMemo(
    () => buildDefaultPageFrameState(frameTitle, currentDescription),
    [frameTitle, currentDescription],
  );
  const PageComponent = shouldRenderSystemPage ? currentRouteFromTable.component : null;

  useEffect(() => {
    if (expandedGroupIds.length === 0) {
      return;
    }
    setCollapsedGroupIds((previous) => {
      let changed = false;
      const next = new Set(previous);
      expandedGroupIds.forEach((groupId) => {
        if (next.delete(groupId)) {
          changed = true;
        }
      });
      return changed ? next : previous;
    });
  }, [expandedGroupIds]);

  if (redirectPath) {
    return <Navigate to={redirectPath} replace />;
  }

  return (
    <SystemPageFrameProvider initialState={initialFrameState}>
      <SystemPageFrame
        hideHeader={hideHeader}
        viewportWorkspace={activeRouteMeta?.viewportWorkspace}
        toolbarRight={<TopbarActions />}
        sidebar={!hideAside && (
          <aside className="system-sidebar">
            <div className="brand-card">
              <div className="brand-title">NEST CLOUD</div>
              <div className="brand-subtitle">统一前端基座</div>
            </div>
            <nav className="sidebar-nav" aria-label="管理模块切换">
              {renderMenuItems(menu, {
                collapsedGroupIds,
                onToggleGroup(groupId) {
                  setCollapsedGroupIds((previous) => {
                    const next = new Set(previous);
                    if (next.has(groupId)) {
                      next.delete(groupId);
                    } else {
                      next.add(groupId);
                    }
                    return next;
                  });
                },
              })}
            </nav>
          </aside>
        )}
      >
        {PageComponent ? (
          <Suspense fallback={<div className="page-loading">正在加载页面...</div>}>
            <PageComponent />
          </Suspense>
        ) : (
          <Outlet />
        )}
      </SystemPageFrame>
    </SystemPageFrameProvider>
  );
}
