import type { MenuRouteItem } from '../api/menuRouteApi';
import type { SortDirection } from '../hooks/usePageTableState';

export interface MenuRouteTreeRow {
  item: MenuRouteItem;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
}

export interface MenuRouteParentOption {
  id: number;
  label: string;
}

export class MenuRouteTreeUtil {
  static buildRows(
    items: MenuRouteItem[],
    collapsedIds: Set<number>,
    sortField?: string,
    sortDirection?: SortDirection,
  ): MenuRouteTreeRow[] {
    const childrenMap = MenuRouteTreeUtil.buildChildrenMap(items);
    const itemMap = new Map(items.map((item) => [item.id, item]));
    const roots = items.filter((item) => !item.parentId || !itemMap.has(item.parentId));
    const rows: MenuRouteTreeRow[] = [];

    MenuRouteTreeUtil.appendRows(
      rows,
      roots,
      0,
      childrenMap,
      collapsedIds,
      sortField,
      sortDirection,
    );

    return rows;
  }

  static buildParentOptions(
    items: MenuRouteItem[],
    excludeId?: number,
    sortField?: string,
    sortDirection?: SortDirection,
  ): MenuRouteParentOption[] {
    const blockedIds = excludeId
      ? MenuRouteTreeUtil.collectDescendantIds(items, excludeId)
      : new Set<number>();
    if (excludeId) {
      blockedIds.add(excludeId);
    }

    return MenuRouteTreeUtil.buildRows(items, new Set<number>(), sortField, sortDirection)
      .filter(({ item }) => !blockedIds.has(item.id))
      .map(({ item, depth }) => ({
        id: item.id,
        label: `${'　'.repeat(depth)}${item.name}`,
      }));
  }

  static resolveParentName(items: MenuRouteItem[], parentId?: number | null): string {
    if (!parentId) {
      return '-';
    }

    const parent = items.find((item) => item.id === parentId);
    return parent?.name ?? String(parentId);
  }

  private static appendRows(
    rows: MenuRouteTreeRow[],
    nodes: MenuRouteItem[],
    depth: number,
    childrenMap: Map<number, MenuRouteItem[]>,
    collapsedIds: Set<number>,
    sortField?: string,
    sortDirection?: SortDirection,
  ) {
    MenuRouteTreeUtil.sortNodes(nodes, sortField, sortDirection).forEach((item) => {
      const children = childrenMap.get(item.id) ?? [];
      const collapsed = collapsedIds.has(item.id);
      rows.push({
        item,
        depth,
        hasChildren: children.length > 0,
        collapsed,
      });

      if (!collapsed) {
        MenuRouteTreeUtil.appendRows(
          rows,
          children,
          depth + 1,
          childrenMap,
          collapsedIds,
          sortField,
          sortDirection,
        );
      }
    });
  }

  private static buildChildrenMap(items: MenuRouteItem[]) {
    const itemMap = new Map(items.map((item) => [item.id, item]));
    const childrenMap = new Map<number, MenuRouteItem[]>();

    items.forEach((item) => {
      if (!item.parentId || !itemMap.has(item.parentId)) {
        return;
      }

      const children = childrenMap.get(item.parentId) ?? [];
      children.push(item);
      childrenMap.set(item.parentId, children);
    });

    return childrenMap;
  }

  private static collectDescendantIds(items: MenuRouteItem[], id: number): Set<number> {
    const descendants = new Set<number>();

    const appendChildren = (parentId: number) => {
      items
        .filter((item) => item.parentId === parentId)
        .forEach((item) => {
          if (descendants.has(item.id)) {
            return;
          }
          descendants.add(item.id);
          appendChildren(item.id);
        });
    };

    appendChildren(id);

    return descendants;
  }

  private static sortNodes(
    nodes: MenuRouteItem[],
    sortField?: string,
    sortDirection?: SortDirection,
  ) {
    if (!sortField || !sortDirection) {
      return [...nodes];
    }

    const directionFactor = sortDirection === 'desc' ? -1 : 1;
    return [...nodes].sort((left, right) => {
      const result = MenuRouteTreeUtil.compareValues(
        MenuRouteTreeUtil.getSortValue(left, sortField),
        MenuRouteTreeUtil.getSortValue(right, sortField),
      );
      return result * directionFactor || left.id - right.id;
    });
  }

  private static getSortValue(item: MenuRouteItem, field: string) {
    if (field === 'updatedAt') {
      return item.updatedAt ? new Date(item.updatedAt).getTime() : 0;
    }

    if (field === 'parentId') {
      return item.parentId ?? 0;
    }

    return (item as unknown as Record<string, unknown>)[field] ?? '';
  }

  private static compareValues(left: unknown, right: unknown) {
    if (typeof left === 'number' && typeof right === 'number') {
      return left - right;
    }

    return String(left).localeCompare(String(right), 'zh-CN');
  }
}
