import { ProjectException } from '@nest-cloud/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { MenuRouteItem } from '../../menu-route/entity/menu-route.entity';
import { MenuRoutePermissionItem } from '../../menu-route/entity/menu-route-permission.entity';
import { MenuRouteUtil } from '../../menu-route/menu-route.util';
import { PermissionItem } from '../../permission/entity/permission.entity';
import { RoleItem } from '../../role/entity/role.entity';
import { RolePermissionItem } from '../../role/entity/role-permission.entity';
import { AccountRuntimePermission, PermissionCheckResult } from '../account.types';
import { AccountItem } from '../entity/account.entity';
import { AccountRoleItem } from '../entity/account-role.entity';

@Injectable()
export class RuntimePermissionService {
  private readonly logger = new Logger(RuntimePermissionService.name);
  private readonly runtimeCache = new Map<number, AccountRuntimePermission>();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getRuntimeByAccountId(accountId: number): Promise<AccountRuntimePermission> {
    // const cached = this.runtimeCache.get(accountId);
    // if (cached) {
    //   return cached;
    // }

    const account = await this.accountRepository.findOne({
      where: { id: accountId },
    });
    if (!account || !account.isEnabled) {
      throw new ProjectException(`Account not found or disabled: ${accountId}`);
    }

    const roles = await this.getEnabledRoles(account.id);
    const permissionCodes = await this.getPermissionCodes(roles.map((item) => item.id));
    const menuRoutes = await this.menuRouteRepository.find({
      where: { isEnabled: true },
      order: { parentId: 'ASC', sort: 'ASC', id: 'ASC' },
    });

    const menuPermissionRelations = await this.menuRoutePermissionRepository.find({
      where: { menuRouteId: In(menuRoutes.map((item) => item.id)) },
    });
    const permissionIds = [...new Set(menuPermissionRelations.map((rel) => rel.permissionId))];
    const permissionCodeMap = new Map<number, string>();
    if (permissionIds.length) {
      const permissions = await this.permissionRepository.find({
        where: { id: In(permissionIds) },
      });
      for (const p of permissions) {
        permissionCodeMap.set(p.id, p.code);
      }
    }
    const menuPermissionsMap = MenuRouteUtil.buildMenuPermissionsMap(
      menuPermissionRelations,
      permissionCodeMap,
    );

    const runtime = {
      account: {
        id: account.id,
        accountName: account.accountName,
        displayName: account.displayName,
        avatarUrl: account.avatarUrl ?? undefined,
      },
      roleCodes: roles.map((item) => item.code),
      permissionCodes,
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
    this.runtimeCache.set(accountId, runtime);
    return runtime;
  }

  async checkPermissions(
    accountId: number,
    permissionCodes: string[],
  ): Promise<PermissionCheckResult> {
    const runtime = await this.getRuntimeByAccountId(accountId);
    const runtimePermissionSet = new Set(runtime.permissionCodes);
    const normalizedCodes = [
      ...new Set(permissionCodes.map((item) => item.trim()).filter(Boolean)),
    ];
    const missingPermissionCodes = normalizedCodes.filter(
      (item) => !runtimePermissionSet.has(item),
    );
    return {
      allowed: missingPermissionCodes.length === 0,
      missingPermissionCodes,
    };
  }

  async hasCurrentPermission(accountId: number, code: string): Promise<boolean> {
    const roles = await this.getEnabledRoles(accountId);
    const permissions = await this.getPermissionCodes(roles.map((role) => role.id));
    return permissions.includes(code);
  }

  invalidateAccount(accountId: number): void {
    this.runtimeCache.delete(accountId);
  }

  invalidateAll(): void {
    this.runtimeCache.clear();
  }

  private async getEnabledRoles(accountId: number): Promise<RoleItem[]> {
    const relations = await this.accountRoleRepository.find({
      where: { accountId },
    });
    const roleIds = relations.map((item) => item.roleId);
    if (!roleIds.length) {
      return [];
    }
    return this.roleRepository.find({
      where: { id: In(roleIds), isEnabled: true },
      order: { code: 'ASC' },
    });
  }

  private async getPermissionCodes(roleIds: number[]): Promise<string[]> {
    if (!roleIds.length) {
      return [];
    }
    const relations = await this.rolePermissionRepository.find({
      where: { roleId: In(roleIds) },
    });
    const permissionIds = [...new Set(relations.map((item) => item.permissionId))];
    if (!permissionIds.length) {
      return [];
    }
    const permissions = await this.permissionRepository.find({
      where: { id: In(permissionIds), isEnabled: true },
      order: { code: 'ASC' },
    });
    return [...new Set(permissions.map((item) => item.code))].sort();
  }

  private get accountRepository() {
    return this.dataSource.getRepository(AccountItem);
  }

  private get accountRoleRepository() {
    return this.dataSource.getRepository(AccountRoleItem);
  }

  private get roleRepository() {
    return this.dataSource.getRepository(RoleItem);
  }

  private get rolePermissionRepository() {
    return this.dataSource.getRepository(RolePermissionItem);
  }

  private get permissionRepository() {
    return this.dataSource.getRepository(PermissionItem);
  }

  private get menuRouteRepository() {
    return this.dataSource.getRepository(MenuRouteItem);
  }

  private get menuRoutePermissionRepository() {
    return this.dataSource.getRepository(MenuRoutePermissionItem);
  }
}
