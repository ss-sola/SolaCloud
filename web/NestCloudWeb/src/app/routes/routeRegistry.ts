import { getAllRoutes, getRouteByName, type RouteRoot } from './appRoutes';
import type { RuntimeMenuRoute } from '../../shared/api/systemApi';

export type { RouteRoot };

export interface PageRouteConfig {
  component: string;
  title: string;
  description: string;
  routeRoot?: RouteRoot;
  hideHeader?: boolean;
  hideInfoStrip?: boolean;
}

function buildPageConfigs(): Record<string, PageRouteConfig> {
  const result: Record<string, PageRouteConfig> = {};
  for (const route of getAllRoutes()) {
    result[route.name] = {
      component: route.name,
      title: route.meta.title,
      description: route.meta.description,
      routeRoot: route.meta.routeRoot,
      hideHeader: route.meta.hideHeader,
      hideInfoStrip: route.meta.hideInfoStrip,
    };
  }
  return result;
}

const pageConfigs = buildPageConfigs();

export class RouteRegistry {
  /**
   * 通过菜单项解析出前端完整路径。
   * 从路由表（按 routeName）查真实 path；
   * 若路由表无对应项，则返回 routeRoot 根路径。
   */
  static resolvePath(item: RuntimeMenuRoute): string {
    const routeName = item.routeName;
    if (routeName) {
      const route = getRouteByName(routeName);
      if (route) {
        return route.path;
      }
    }
    // fallback：无 routeName 或路由表无对应项，返回 routeRoot 根路径
    const routeRoot = RouteRegistry.getRouteRoot(item);
    return `/${routeRoot}`;
  }

  static getRouteRoot(item?: RuntimeMenuRoute | null): RouteRoot {
    return (
      RouteRegistry.getPageConfig(item?.routeName)?.routeRoot ??
      (item?.routeRoot === 'rag' ? 'rag' : 'system')
    );
  }

  static resolveRouteRootFromPath(pathname: string): RouteRoot | null {
    if (/^\/rag(?:\/|$)/.test(pathname)) {
      return 'rag';
    }
    if (/^\/system(?:\/|$)/.test(pathname)) {
      return 'system';
    }
    return null;
  }

  static getPageConfig(routeName?: string | null): PageRouteConfig | null {
    if (!routeName) {
      return null;
    }
    return pageConfigs[routeName] ?? null;
  }

  static isGroup(item: RuntimeMenuRoute): boolean {
    return item?.isGroup === true;
  }

  static findFirstPagePath(routes: RuntimeMenuRoute[], routeRoot?: RouteRoot): string | null {
    for (const item of routes) {
      if (item.isEnabled === false || item.hideRoute === true) {
        continue;
      }
      if (RouteRegistry.isGroup(item)) {
        const childPath = RouteRegistry.findFirstPagePath(item.children ?? [], routeRoot);
        if (childPath) {
          return childPath;
        }
        continue;
      }
      if (routeRoot && RouteRegistry.getRouteRoot(item) !== routeRoot) {
        continue;
      }
      if (RouteRegistry.getPageConfig(item.routeName)) {
        return RouteRegistry.resolvePath(item);
      }
    }
    return null;
  }

  static findMenuByPath(routes: RuntimeMenuRoute[], pathname: string): RuntimeMenuRoute | null {
    for (const item of routes) {
      if (RouteRegistry.resolvePath(item) === pathname) {
        return item;
      }
      const matchedChild = RouteRegistry.findMenuByPath(item.children ?? [], pathname);
      if (matchedChild) {
        return matchedChild;
      }
    }
    return null;
  }
}
