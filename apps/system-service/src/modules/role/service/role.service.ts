import { BaseService, ProjectException } from '@nest-cloud/sdk';
import { forwardRef, Injectable, Logger, Inject } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, ILike, In, Repository } from 'typeorm';
import { SYSTEM_SERVICE_NAME } from '../../../system-service.constants';
import { PageResult } from '../../../utils/pagination.types';
import { PaginationUtil } from '../../../utils/pagination.util';
import { MenuRouteItem } from '../../menu-route/entity/menu-route.entity';
import { MenuRoutePermissionService } from '../../menu-route/service/menu-route-permission.service';
import { MenuRouteUtil } from '../../menu-route/menu-route.util';
import { RuntimePermissionService } from '../../account/service/runtime-permission.service';
import { SessionPermissionService } from '../../account/service/session-permission.service';
import { OperationLogService } from '../../operation-log/service/operation-log.service';
import { PermissionService } from '../../permission/service/permission.service';
import { ROLE_CAPABILITIES } from '../role.constants';
import { RoleItem } from '../entity/role.entity';
import { RolePermissionItem } from '../entity/role-permission.entity';
import { RoleQueryForm } from '../form/role-query.form';
import { RolePermissionService } from './role-permission.service';
import { RoleMutationInput, RoleOptionRecord, RoleRecord, RoleRuntimePreview } from '../role.types';

interface NormalizedRoleMutationInput extends RoleMutationInput {
  permissionCodes: string[];
  permissionIds: number[];
}

@Injectable()
export class RoleService extends BaseService<RoleItem> {
  private readonly logger = new Logger(RoleService.name);

  constructor(
    @InjectRepository(RoleItem)
    protected readonly repository: Repository<RoleItem>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly rolePermissionService: RolePermissionService,
    private readonly menuRoutePermissionService: MenuRoutePermissionService,
    @InjectRepository(MenuRouteItem)
    private readonly menuRouteRepository: Repository<MenuRouteItem>,
    private readonly permissionService: PermissionService,
    private readonly operationLogService: OperationLogService,
    private readonly runtimePermissionService: RuntimePermissionService,
    @Inject(forwardRef(() => SessionPermissionService))
    private readonly sessionPermissionService: SessionPermissionService,
  ) {
    super(repository);
  }

  async getOverview() {
    return {
      service: SYSTEM_SERVICE_NAME,
      itemCount: await this.repository.count(),
      capabilities: [...ROLE_CAPABILITIES],
    };
  }

  async listItems(query: RoleQueryForm): Promise<PageResult<RoleRecord>> {
    const pageQuery = PaginationUtil.normalizePageQuery(query);
    const baseWhere: FindOptionsWhere<RoleItem> =
      query.isEnabled !== undefined ? { isEnabled: query.isEnabled } : {};
    const [items, total] = await this.repository.findAndCount({
      where: this.buildListWhere(baseWhere, query.keyword),
      order: PaginationUtil.buildOrder(query, {
        allowedSortFields: ['id', 'code', 'name', 'createdAt', 'updatedAt'],
        defaultOrder: { code: 'ASC' },
      }),
      skip: pageQuery.skip,
      take: pageQuery.take,
    });

    return PaginationUtil.buildPageResult(
      await Promise.all(items.map((item) => this.toRecord(item))),
      total,
      pageQuery,
    );
  }

  async getItem(id: number): Promise<RoleRecord> {
    const item = await this.findOne(id);
    if (!item) {
      throw new ProjectException(`Role not found: ${id}`);
    }
    return this.toRecord(item);
  }

  async listOptions(): Promise<RoleOptionRecord[]> {
    const items = await this.repository.find({
      where: { isEnabled: true },
      order: { code: 'ASC' },
    });
    return items.map((item) => this.toOptionRecord(item));
  }

  async getByCode(code: string): Promise<RoleItem | null> {
    return this.repository.findOne({ where: { code } });
  }

  async createItem(payload: RoleMutationInput): Promise<RoleRecord> {
    const normalizedPayload = await this.normalizePayload(payload);
    await this.assertCodeAvailable(normalizedPayload.code);
    const saved = await this.create(this.toEntityPayload(normalizedPayload));
    await this.syncRolePermissions(saved.id, normalizedPayload.permissionIds);
    this.runtimePermissionService.invalidateAll();
    this.logger.log(`Role created: ${saved.code}`);
    await this.operationLogService.log({
      module: 'role',
      action: 'item-create',
      targetType: 'role',
      targetId: saved.code,
      summary: `Role created: ${saved.code}`,
      operator: 'system-service',
    });
    return this.getItem(saved.id);
  }

  async updateItem(id: number, payload: RoleMutationInput): Promise<RoleRecord> {
    const current = await this.findOne(id);
    if (!current) {
      throw new ProjectException(`Role not found: ${id}`);
    }
    const normalizedPayload = await this.normalizePayload(payload);
    await this.assertCodeAvailable(normalizedPayload.code, id);
    const saved = await this.update(id, this.toEntityPayload(normalizedPayload));
    if (!saved) {
      throw new ProjectException(`Role not found: ${id}`);
    }
    await this.syncRolePermissions(saved.id, normalizedPayload.permissionIds);

    // 清理内存缓存
    this.runtimePermissionService.invalidateAll();

    // 批量更新所有拥有该角色的账户的 session 权限
    await this.sessionPermissionService.updateRolePermissions(saved.code);

    this.logger.log(`Role updated: ${saved.code}`);
    await this.operationLogService.log({
      module: 'role',
      action: 'item-update',
      targetType: 'role',
      targetId: saved.code,
      summary: `Role updated: ${saved.code}`,
      operator: 'system-service',
    });
    return this.getItem(saved.id);
  }

  async removeItem(id: number): Promise<RoleRecord> {
    const current = await this.findOne(id);
    if (!current) {
      throw new ProjectException(`Role not found: ${id}`);
    }
    await this.rolePermissionService.clearByRoleId(id);
    const record = await this.toRecord(current);
    await this.delete(id);

    // 清理内存缓存
    this.runtimePermissionService.invalidateAll();

    // 批量更新所有拥有该角色的账户的 session 权限
    await this.sessionPermissionService.updateRolePermissions(current.code);

    await this.operationLogService.log({
      module: 'role',
      action: 'item-delete',
      targetType: 'role',
      targetId: current.code,
      summary: `Role deleted: ${current.code}`,
      operator: 'system-service',
    });
    return record;
  }

  async getRuntimeByRoleCode(roleCode: string): Promise<RoleRuntimePreview> {
    const role = await this.getByCode(roleCode.trim());
    if (!role || !role.isEnabled) {
      throw new ProjectException(`Role not found or disabled: ${roleCode}`);
    }

    const permissionCodes = await this.getRolePermissionCodes(role.id, true);
    const menuRoutes = await this.menuRouteRepository.find({
      where: { isEnabled: true },
      order: {
        parentId: 'ASC',
        sort: 'ASC',
        id: 'ASC',
      },
    });

    const menuPermissionRelations = await this.menuRoutePermissionService.findByMenuRouteIds(
      menuRoutes.map((item) => item.id),
    );
    const permissionIds = [...new Set(menuPermissionRelations.map((rel) => rel.permissionId))];
    const permissionCodeMap = new Map<number, string>();
    if (permissionIds.length) {
      const permissions = await this.permissionService.findByIds(permissionIds);
      for (const p of permissions) {
        permissionCodeMap.set(p.id, p.code);
      }
    }
    const menuPermissionsMap = MenuRouteUtil.buildMenuPermissionsMap(
      menuPermissionRelations,
      permissionCodeMap,
    );

    return {
      roleCode: role.code,
      menuTree: MenuRouteUtil.toRuntimeTree(
        MenuRouteUtil.buildTree(
          MenuRouteUtil.filterVisibleMenuRoutes(
            menuRoutes,
            new Set(permissionCodes),
            menuPermissionsMap,
          ),
        ),
      ),
    };
  }

  private buildListWhere(
    baseWhere: FindOptionsWhere<RoleItem>,
    keyword?: string,
  ): FindOptionsWhere<RoleItem>[] {
    if (!keyword) {
      return [baseWhere];
    }

    const keywordLike = ILike(`%${keyword}%`);
    return [
      { ...baseWhere, code: keywordLike },
      { ...baseWhere, name: keywordLike },
      { ...baseWhere, description: keywordLike },
    ];
  }

  private async assertCodeAvailable(code: string, currentId?: number) {
    const normalizedCode = code.trim();
    if (!normalizedCode) {
      throw new ProjectException('Role code is required');
    }
    const existing = await this.repository.findOne({
      where: { code: normalizedCode },
    });
    if (existing && existing.id !== currentId) {
      throw new ProjectException(`Role code already exists: ${normalizedCode}`);
    }
  }

  /** 同步角色的权限关联表 */
  private async syncRolePermissions(roleId: number, permissionIds: number[]): Promise<void> {
    await this.rolePermissionService.clearByRoleId(roleId);

    if (!permissionIds.length) {
      return;
    }

    const rolePermissionRepo = this.dataSource.getRepository(RolePermissionItem);
    for (const permissionId of permissionIds) {
      await rolePermissionRepo.save(rolePermissionRepo.create({ roleId, permissionId }));
    }
  }

  private async normalizePayload(payload: RoleMutationInput): Promise<NormalizedRoleMutationInput> {
    const normalizedCodes = MenuRouteUtil.normalizePermissionCodes(payload.permissionCodes);
    if (!normalizedCodes.length) {
      return {
        ...payload,
        permissionCodes: [],
        permissionIds: [],
      };
    }

    const permissions = await this.permissionService.findByCodes(normalizedCodes);
    const permissionMap = new Map(permissions.map((item) => [item.code, item]));
    const missingCodes = normalizedCodes.filter((item) => !permissionMap.has(item));
    if (missingCodes.length) {
      throw new ProjectException(`Permission codes not found: ${missingCodes.join(', ')}`);
    }

    const disabledCodes = normalizedCodes.filter((item) => !permissionMap.get(item)?.isEnabled);
    if (disabledCodes.length) {
      throw new ProjectException(`Permission codes disabled: ${disabledCodes.join(', ')}`);
    }

    return {
      ...payload,
      permissionCodes: normalizedCodes,
      permissionIds: normalizedCodes.map((item) => permissionMap.get(item)!.id),
    };
  }

  private async getRolePermissionCodes(roleId: number, onlyEnabled = false): Promise<string[]> {
    // 通过本实体的 repository 查询关联表（允许）
    const rolePermissionRepo = this.dataSource.getRepository(RolePermissionItem);
    const relations = await rolePermissionRepo.find({ where: { roleId } });
    const permissionIds = relations.map((item) => item.permissionId);
    if (!permissionIds.length) {
      return [];
    }
    const items = await this.permissionService.findByIds(permissionIds, onlyEnabled);
    return items.map((item) => item.code);
  }

  private toEntityPayload(payload: RoleMutationInput): Partial<RoleItem> {
    const normalizedCode = payload.code.trim();
    if (!normalizedCode) {
      throw new ProjectException('Role code is required');
    }
    const normalizedName = payload.name.trim();
    if (!normalizedName) {
      throw new ProjectException('Role name is required');
    }
    return {
      code: normalizedCode,
      name: normalizedName,
      description: payload.description?.trim() || null,
      isEnabled: payload.isEnabled ?? true,
    };
  }

  private async toRecord(entity: RoleItem): Promise<RoleRecord> {
    return {
      id: entity.id,
      code: entity.code,
      name: entity.name,
      description: entity.description ?? undefined,
      isEnabled: entity.isEnabled,
      permissionCodes: await this.getRolePermissionCodes(entity.id),
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  private toOptionRecord(entity: RoleItem): RoleOptionRecord {
    return {
      code: entity.code,
      name: entity.name,
    };
  }
}
