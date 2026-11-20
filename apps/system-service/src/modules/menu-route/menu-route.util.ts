import { ProjectException } from '@nest-cloud/sdk';
import {
  MenuRouteRecord,
  MenuRouteTreeRecord,
  RuntimeMenuRouteTreeRecord,
} from './menu-route.types';
import { MenuRouteItem } from './entity/menu-route.entity';
import { MenuRoutePermissionItem } from './entity/menu-route-permission.entity';

/** Stateless helpers shared by menu-route controller and service. */
export class MenuRouteUtil {
  static normalizePermissionCodes(value?: string[] | null): string[] {
    if (!value?.length) {
      return [];
    }

    return [...new Set(value.map((item) => item.trim()).filter((item) => !!item))];
  }

  static buildTree(records: MenuRouteRecord[]): MenuRouteTreeRecord[] {
    const childrenMap = new Map<number, MenuRouteTreeRecord[]>();
    const roots: MenuRouteTreeRecord[] = [];

    for (const record of records) {
      const node: MenuRouteTreeRecord = {
        ...record,
        children: childrenMap.get(record.id) ?? [],
      };
      childrenMap.set(record.id, node.children);

      if (!record.parentId) {
        roots.push(node);
        continue;
      }

      const parentChildren = childrenMap.get(record.parentId) ?? [];
      parentChildren.push(node);
      childrenMap.set(record.parentId, parentChildren);
    }

    return roots;
  }

  static toRuntimeTree(records: MenuRouteTreeRecord[]): RuntimeMenuRouteTreeRecord[] {
    return records.map(({ permissionCodes, createdAt, updatedAt, children, ...record }) => ({
      ...record,
      children: MenuRouteUtil.toRuntimeTree(children),
    }));
  }

  static assertRequired(field: string, value?: string | null) {
    if (!value?.trim()) {
      throw new ProjectException(`Menu route ${field} is required`);
    }
  }

  /**
   * Build a map of menu route ID to permission codes from menu-route-permission relations.
   * Requires permissionCodeMap to translate permissionId to code.
   */
  static buildMenuPermissionsMap(
    relations: MenuRoutePermissionItem[],
    permissionCodeMap: Map<number, string>,
  ): Map<number, string[]> {
    const map = new Map<number, string[]>();
    for (const rel of relations) {
      const code = permissionCodeMap.get(rel.permissionId);
      if (code) {
        const codes = map.get(rel.menuRouteId) ?? [];
        codes.push(code);
        map.set(rel.menuRouteId, codes);
      }
    }
    return map;
  }

  /**
   * Filter menu routes to only those visible to the given permission set.
   * Returns MenuRouteRecord array including all visible routes and their ancestors.
   */
  static filterVisibleMenuRoutes(
    menuRoutes: MenuRouteItem[],
    permissionCodeSet: Set<string>,
    permissionsMap: Map<number, string[]>,
  ): MenuRouteRecord[] {
    const menuRouteMap = new Map(menuRoutes.map((item) => [item.id, item]));
    const visibleIds = new Set<number>();

    for (const item of menuRoutes) {
      if (!MenuRouteUtil.shouldExpose(item, permissionCodeSet, permissionsMap)) {
        continue;
      }
      let current: MenuRouteItem | undefined = item;
      while (current) {
        visibleIds.add(current.id);
        current = current.parentId ? menuRouteMap.get(current.parentId) : undefined;
      }
    }

    return menuRoutes
      .filter((item) => visibleIds.has(item.id))
      .map((item) => MenuRouteUtil.toMenuRouteRecord(item, permissionsMap.get(item.id) ?? []));
  }

  private static shouldExpose(
    item: MenuRouteItem,
    permissionCodeSet: Set<string>,
    permissionsMap: Map<number, string[]>,
  ): boolean {
    const itemPermissionCodes = MenuRouteUtil.normalizePermissionCodes(
      permissionsMap.get(item.id) ?? [],
    );
    if (!itemPermissionCodes.length) {
      return true;
    }
    return itemPermissionCodes.some((code) => permissionCodeSet.has(code));
  }

  private static toMenuRouteRecord(
    item: MenuRouteItem,
    permissionCodes: string[],
  ): MenuRouteRecord {
    return {
      id: item.id,
      code: item.code,
      name: item.name,
      parentId: item.parentId ?? undefined,
      routeName: item.routeName ?? undefined,
      redirect: item.redirect ?? undefined,
      icon: item.icon ?? undefined,
      sort: item.sort,
      isEnabled: item.isEnabled,
      isGroup: item.isGroup,
      hideHeader: item.hideHeader,
      hideRoute: item.hideRoute,
      routeRoot: item.routeRoot ?? undefined,
      permissionCodes: [...permissionCodes],
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }
}
