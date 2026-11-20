import {
  ConfigKeys,
  getConfig,
  RedisSessionStore,
  SHARED_AUTH_SESSION_KEY_PREFIX,
  SHARED_AUTH_SESSION_TTL_MS,
} from '@nest-cloud/sdk';
import { forwardRef, Injectable, Logger, Inject } from '@nestjs/common';
import { In } from 'typeorm';
import { buildRoleAccountsKey } from '../../../constants/session-permission.constants';
import { RuntimePermissionService } from './runtime-permission.service';
import { AccountRoleService } from './account-role.service';
import { RoleItem } from '../../role/entity/role.entity';
import { RoleService } from '../../role/service/role.service';

@Injectable()
export class SessionPermissionService {
  private readonly logger = new Logger(SessionPermissionService.name);
  private readonly sessionStore: RedisSessionStore | null;

  constructor(
    private readonly accountRoleService: AccountRoleService,
    @Inject(forwardRef(() => RoleService))
    private readonly roleService: RoleService,
    private readonly runtimePermissionService: RuntimePermissionService,
  ) {
    // 初始化 RedisSessionStore
    const redisUrl = getConfig<string | undefined>(ConfigKeys.SessionRedisUrl, undefined, false);
    if (redisUrl) {
      this.sessionStore = new RedisSessionStore({
        redisUrl,
        keyPrefix: getConfig<string>(ConfigKeys.SessionKeyPrefix, SHARED_AUTH_SESSION_KEY_PREFIX),
        ttlMs: getConfig<number>(ConfigKeys.SessionTtlMs, SHARED_AUTH_SESSION_TTL_MS),
      });
    } else {
      this.sessionStore = null;
    }
  }

  /**
   * 更新指定账户的所有 session 中的权限码
   */
  async updateAccountPermissions(accountId: number): Promise<void> {
    if (!this.sessionStore) {
      this.logger.warn('Session store not available, skip updating session permissions');
      return;
    }

    try {
      const runtime = await this.runtimePermissionService.getRuntimeByAccountId(accountId);
      const updatedCount = await this.sessionStore.updateAccountPermissions(
        accountId,
        runtime.permissionCodes,
      );
      this.logger.log(`Updated ${updatedCount} session(s) for account ${accountId}`);
    } catch (error) {
      this.logger.error(
        `Failed to update session permissions for account ${accountId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 角色权限变更时，批量更新所有拥有该角色的账户的 session
   */
  async updateRolePermissions(roleCode: string): Promise<void> {
    if (!this.sessionStore) {
      this.logger.warn('Session store not available, skip updating role permissions');
      return;
    }

    try {
      // 从 Redis Set 中获取所有拥有该角色的账户 ID
      const redis = this.sessionStore.getRedisClient();
      const accountIds = await redis.smembers(buildRoleAccountsKey(roleCode));

      if (accountIds.length === 0) {
        this.logger.log(`No accounts found for role ${roleCode}`);
        return;
      }

      // 为每个账户重新计算权限码
      const updates = new Map<number, string[]>();
      for (const accountIdStr of accountIds) {
        const accountId = parseInt(accountIdStr, 10);
        if (isNaN(accountId)) continue;

        try {
          const runtime = await this.runtimePermissionService.getRuntimeByAccountId(accountId);
          updates.set(accountId, runtime.permissionCodes);
        } catch (error) {
          this.logger.warn(
            `Failed to get permissions for account ${accountId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      // 批量更新 session
      const updatedCount = await this.sessionStore.updateMultipleAccountsPermissions(updates);
      this.logger.log(
        `Updated ${updatedCount} session(s) for role ${roleCode} (${updates.size} accounts)`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update session permissions for role ${roleCode}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 维护角色账户索引：登录时或账户角色变更时调用
   * @param accountId 账户 ID
   * @param oldRoleCodes 旧角色列表（可选，仅在更新时提供）
   * @param newRoleCodes 新角色列表
   */
  async maintainRoleAccountIndex(
    accountId: number,
    oldRoleCodes: string[],
    newRoleCodes: string[],
  ): Promise<void> {
    if (!this.sessionStore) {
      return;
    }

    try {
      const redis = this.sessionStore.getRedisClient();

      // 移除旧角色的索引
      for (const roleCode of oldRoleCodes) {
        if (!newRoleCodes.includes(roleCode)) {
          await redis.srem(buildRoleAccountsKey(roleCode), accountId.toString());
        }
      }

      // 添加新角色的索引
      for (const roleCode of newRoleCodes) {
        if (!oldRoleCodes.includes(roleCode)) {
          await redis.sadd(buildRoleAccountsKey(roleCode), accountId.toString());
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to maintain role account index for account ${accountId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 登录时建立角色账户索引
   */
  async addAccountToRoleIndex(accountId: number, roleCodes: string[]): Promise<void> {
    await this.maintainRoleAccountIndex(accountId, [], roleCodes);
  }

  /**
   * 删除账户时清理角色账户索引
   */
  async removeAccountFromRoleIndex(accountId: number): Promise<void> {
    if (!this.sessionStore) {
      return;
    }

    try {
      // 查询账户的所有角色
      const relations = await this.accountRoleService.findByAccountId(accountId);
      const roleIds = relations.map((r) => r.roleId);

      if (roleIds.length === 0) {
        return;
      }

      const roles = (await this.roleService.findAll({
        where: { id: In(roleIds) },
      })) as RoleItem[];
      const roleCodes = roles.map((r) => r.code);

      // 从所有角色的 Set 中移除该账户
      const redis = this.sessionStore.getRedisClient();
      for (const roleCode of roleCodes) {
        await redis.srem(buildRoleAccountsKey(roleCode), accountId.toString());
      }
    } catch (error) {
      this.logger.error(
        `Failed to remove account ${accountId} from role index: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
