import { BaseService, ProjectException } from '@nest-cloud/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, Repository } from 'typeorm';
import { SYSTEM_SERVICE_NAME } from '../../../system-service.constants';
import { RuntimePermissionService } from '../../account/service/runtime-permission.service';
import { OperationLogService } from '../../operation-log/service/operation-log.service';
import { PermissionService } from '../../permission/service/permission.service';
import {
  MenuRouteBatchStatusInput,
  MenuRouteCreateInput,
  MenuRouteRecord,
  MenuRouteReorderInput,
  MenuRouteTreeRecord,
  MenuRouteUpdateInput,
} from '../menu-route.types';
import { MenuRouteUtil } from '../menu-route.util';
import { MenuRouteItem } from '../entity/menu-route.entity';
import { MenuRoutePermissionItem } from '../entity/menu-route-permission.entity';
import { MenuRouteQueryForm } from '../form/menu-route-query.form';
import { MenuRoutePermissionService } from './menu-route-permission.service';

/** 菜单管理能力集 */
const MENU_ROUTE_CAPABILITIES = ['item-crud', 'batch-status', 'tree-query', 'reorder'] as const;

@Injectable()
export class MenuRouteService extends BaseService<MenuRouteItem> {
  private readonly logger = new Logger(MenuRouteService.name);

  constructor(
    @InjectRepository(MenuRouteItem)
    protected readonly repository: Repository<MenuRouteItem>,
    private readonly menuRoutePermissionService: MenuRoutePermissionService,
    private readonly permissionService: PermissionService,
    private readonly operationLogService: OperationLogService,
    private readonly runtimePermissionService: RuntimePermissionService,
  ) {
    super(repository);
  }

  async getOverview() {
    return {
      service: SYSTEM_SERVICE_NAME,
      itemCount: await this.repository.count(),
      capabilities: [...MENU_ROUTE_CAPABILITIES],
    };
  }

  async listItems(query: MenuRouteQueryForm): Promise<MenuRouteRecord[]> {
    const where: Array<Record<string, unknown>> = [
      {
        ...(query.parentId !== undefined ? { parentId: query.parentId } : {}),
        ...(query.isEnabled !== undefined ? { isEnabled: query.isEnabled } : {}),
      },
    ];

    if (query.keyword) {
      const keywordLike = ILike(`%${query.keyword}%`);
      where.splice(
        0,
        1,
        {
          ...(query.parentId !== undefined ? { parentId: query.parentId } : {}),
          ...(query.isEnabled !== undefined ? { isEnabled: query.isEnabled } : {}),
          code: keywordLike,
        },
        {
          ...(query.parentId !== undefined ? { parentId: query.parentId } : {}),
          ...(query.isEnabled !== undefined ? { isEnabled: query.isEnabled } : {}),
          name: keywordLike,
        },
        {
          ...(query.parentId !== undefined ? { parentId: query.parentId } : {}),
          ...(query.isEnabled !== undefined ? { isEnabled: query.isEnabled } : {}),
          routeName: keywordLike,
        },
      );
    }

    const items = await this.repository.find({
      where,
      order: {
        parentId: 'ASC',
        sort: 'ASC',
        id: 'ASC',
      },
    });

    const permissionsMap = await this.buildPermissionsMap(items.map((item) => item.id));
    return items.map((item) => this.toRecord(item, permissionsMap.get(item.id) ?? []));
  }

  async listTree(query: MenuRouteQueryForm): Promise<MenuRouteTreeRecord[]> {
    return MenuRouteUtil.buildTree(await this.listItems(query));
  }

  async getItem(id: number): Promise<MenuRouteRecord> {
    const item = await this.findOne(id);
    if (!item) {
      throw new ProjectException(`Menu route not found: ${id}`);
    }

    const permissionsMap = await this.buildPermissionsMap([id]);
    return this.toRecord(item, permissionsMap.get(id) ?? []);
  }

  async createItem(payload: MenuRouteCreateInput): Promise<MenuRouteRecord> {
    await this.assertCodeAvailable(payload.code);
    await this.assertParentValid(payload.parentId);
    const normalizedCodes = MenuRouteUtil.normalizePermissionCodes(payload.permissionCodes);
    await this.permissionService.assertCodesExist(normalizedCodes);

    const saved = await this.create(this.toEntityPayload(payload, payload.code));
    await this.syncPermissionRelations(saved.id, normalizedCodes);
    this.runtimePermissionService.invalidateAll();
    this.logger.log(`Menu route created: ${saved.code}`);
    await this.operationLogService.log({
      module: 'menu-route',
      action: 'item-create',
      targetType: 'menu-route',
      targetId: saved.code,
      summary: `Menu route created: ${saved.code}`,
      operator: 'system-service',
    });
    return this.toRecord(saved, normalizedCodes);
  }

  async updateItem(id: number, payload: MenuRouteUpdateInput): Promise<MenuRouteRecord> {
    const current = await this.findOne(id);
    if (!current) {
      throw new ProjectException(`Menu route not found: ${id}`);
    }

    await this.assertParentValid(payload.parentId, id);
    const normalizedCodes = MenuRouteUtil.normalizePermissionCodes(payload.permissionCodes);
    await this.permissionService.assertCodesExist(normalizedCodes);

    const saved = await this.update(id, this.toEntityPayload(payload, current.code));
    if (!saved) {
      throw new ProjectException(`Menu route not found: ${id}`);
    }
    await this.syncPermissionRelations(saved.id, normalizedCodes);
    this.runtimePermissionService.invalidateAll();
    this.logger.log(`Menu route updated: ${saved.code}`);
    await this.operationLogService.log({
      module: 'menu-route',
      action: 'item-update',
      targetType: 'menu-route',
      targetId: saved.code,
      summary: `Menu route updated: ${saved.code}`,
      operator: 'system-service',
    });
    return this.toRecord(saved, normalizedCodes);
  }

  async batchUpdateStatus(payload: MenuRouteBatchStatusInput): Promise<MenuRouteRecord[]> {
    const ids = [...new Set(payload.ids)].filter((id) => Number.isInteger(id) && id > 0);
    if (!ids.length) {
      throw new ProjectException('Menu route ids are required');
    }

    const items = await this.repository.find({ where: { id: In(ids) } });
    if (items.length !== ids.length) {
      throw new ProjectException('Some menu routes were not found');
    }

    const savedItems = await Promise.all(
      items.map((item) => this.update(item.id, { isEnabled: payload.isEnabled })),
    );
    this.runtimePermissionService.invalidateAll();
    await this.operationLogService.log({
      module: 'menu-route',
      action: 'batch-status',
      targetType: 'menu-route',
      targetId: ids.join(','),
      summary: `Menu route batch status updated: ${ids.join(',')} -> ${payload.isEnabled ? 'enabled' : 'disabled'}`,
      operator: 'system-service',
    });
    const permissionsMap = await this.buildPermissionsMap(ids);
    return savedItems
      .filter((item): item is MenuRouteItem => item !== null)
      .map((item) => this.toRecord(item, permissionsMap.get(item.id) ?? []));
  }

  async reorderItems(payload: MenuRouteReorderInput): Promise<MenuRouteRecord[]> {
    const ids = [...new Set(payload.items.map((item) => item.id))];
    const currentItems = await this.repository.find({ where: { id: In(ids) } });
    if (currentItems.length !== ids.length) {
      throw new ProjectException('Some menu routes were not found');
    }

    const currentMap = new Map(currentItems.map((item) => [item.id, item]));
    const savedItems = await Promise.all(
      payload.items.map(async (item) => {
        const current = currentMap.get(item.id);
        if (!current) {
          throw new ProjectException(`Menu route not found: ${item.id}`);
        }
        const saved = await this.update(item.id, { sort: item.sort });
        if (!saved) {
          throw new ProjectException(`Menu route not found: ${item.id}`);
        }
        return saved;
      }),
    );
    this.runtimePermissionService.invalidateAll();
    await this.operationLogService.log({
      module: 'menu-route',
      action: 'reorder',
      targetType: 'menu-route',
      targetId: ids.join(','),
      summary: `Menu route reordered: ${payload.items.map((item) => `${item.id}:${item.sort}`).join(', ')}`,
      operator: 'system-service',
    });
    const permissionsMap = await this.buildPermissionsMap(ids);
    return savedItems
      .sort((left, right) => left.sort - right.sort || left.id - right.id)
      .map((item) => this.toRecord(item, permissionsMap.get(item.id) ?? []));
  }

  async removeItem(id: number): Promise<MenuRouteRecord> {
    const current = await this.findOne(id);
    if (!current) {
      throw new ProjectException(`Menu route not found: ${id}`);
    }

    const childCount = await this.repository.count({ where: { parentId: id } });
    if (childCount > 0) {
      throw new ProjectException(`Menu route ${current.code} still has ${childCount} child items`);
    }

    const permissionsMap = await this.buildPermissionsMap([id]);
    await this.menuRoutePermissionService.clearByMenuRouteId(id);
    await this.delete(id);
    this.runtimePermissionService.invalidateAll();
    await this.operationLogService.log({
      module: 'menu-route',
      action: 'item-delete',
      targetType: 'menu-route',
      targetId: current.code,
      summary: `Menu route deleted: ${current.code}`,
      operator: 'system-service',
    });
    return this.toRecord(current, permissionsMap.get(id) ?? []);
  }

  /** 同步种子数据的权限关联表 */
  async syncSeedPermissions(menuRouteId: number, permissionCodes: string[]): Promise<void> {
    await this.syncPermissionRelations(
      menuRouteId,
      MenuRouteUtil.normalizePermissionCodes(permissionCodes),
    );
  }

  private async syncPermissionRelations(
    menuRouteId: number,
    permissionCodes: string[],
  ): Promise<void> {
    await this.menuRoutePermissionService.clearByMenuRouteId(menuRouteId);
    if (!permissionCodes.length) {
      return;
    }
    const permissionIds = await this.permissionService.getIdsByCodes(permissionCodes);
    for (const permissionId of permissionIds) {
      await this.menuRoutePermissionService.create({ menuRouteId, permissionId });
    }
  }

  private async buildPermissionsMap(menuRouteIds: number[]): Promise<Map<number, string[]>> {
    const map = new Map<number, string[]>();
    if (!menuRouteIds.length) {
      return map;
    }
    const relations = await this.menuRoutePermissionService.findByMenuRouteIds(menuRouteIds);
    const permissionIds = [...new Set(relations.map((rel) => rel.permissionId))];
    const codeMap = await this.permissionService.getCodesByIds(permissionIds);
    for (const rel of relations) {
      const code = codeMap.get(rel.permissionId);
      if (code) {
        const codes = map.get(rel.menuRouteId) ?? [];
        codes.push(code);
        map.set(rel.menuRouteId, codes);
      }
    }
    return map;
  }

  private async assertCodeAvailable(code: string, currentId?: number) {
    MenuRouteUtil.assertRequired('code', code);
    const existing = await this.repository.findOne({ where: { code } });
    if (existing && existing.id !== currentId) {
      throw new ProjectException(`Menu route code already exists: ${code}`);
    }
  }

  private async assertParentValid(parentId?: number | null, currentId?: number) {
    if (!parentId) {
      return;
    }

    if (currentId && parentId === currentId) {
      throw new ProjectException('Menu route parent cannot be self');
    }

    let cursor = await this.repository.findOne({ where: { id: parentId } });
    if (!cursor) {
      throw new ProjectException(`Menu route parent not found: ${parentId}`);
    }

    while (cursor?.parentId) {
      if (cursor.parentId === currentId) {
        throw new ProjectException('Menu route parent cannot be a descendant');
      }

      cursor = await this.repository.findOne({
        where: { id: cursor.parentId },
      });
    }
  }

  private toEntityPayload(
    payload: MenuRouteCreateInput | MenuRouteUpdateInput,
    code: string,
  ): Partial<MenuRouteItem> {
    MenuRouteUtil.assertRequired('code', code);
    MenuRouteUtil.assertRequired('name', payload.name);

    return {
      parentId: payload.parentId ?? null,
      code: code.trim(),
      name: payload.name.trim(),
      routeName: payload.routeName?.trim() || null,
      redirect: payload.redirect?.trim() || null,
      icon: payload.icon?.trim() || null,
      sort: payload.sort ?? 0,
      isEnabled: payload.isEnabled ?? true,
      isGroup: payload.isGroup ?? false,
      hideHeader: payload.hideHeader ?? false,
      hideRoute: payload.hideRoute ?? false,
      routeRoot: payload.routeRoot?.trim() || null,
    };
  }

  private toRecord(entity: MenuRouteItem, permissionCodes: string[]): MenuRouteRecord {
    return {
      id: entity.id,
      code: entity.code,
      name: entity.name,
      parentId: entity.parentId ?? undefined,
      routeName: entity.routeName ?? undefined,
      redirect: entity.redirect ?? undefined,
      icon: entity.icon ?? undefined,
      sort: entity.sort,
      isEnabled: entity.isEnabled,
      isGroup: entity.isGroup,
      hideHeader: entity.hideHeader,
      hideRoute: entity.hideRoute,
      routeRoot: entity.routeRoot ?? undefined,
      permissionCodes: [...permissionCodes],
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
