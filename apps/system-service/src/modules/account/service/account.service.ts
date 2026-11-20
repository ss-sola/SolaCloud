import { BaseService, getConfig, ProjectException } from '@nest-cloud/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, ILike, In, Repository } from 'typeorm';
import { PageResult } from '../../../utils/pagination.types';
import { PaginationUtil } from '../../../utils/pagination.util';
import { LoginLogService } from './login-log.service';
import {
  ACCOUNT_AVATAR_UPLOAD_BUSINESS_TYPE,
  ACCOUNT_AVATAR_UPLOAD_SCENE,
  ACCOUNT_AVATAR_UPLOAD_URL,
  ACCOUNT_CAPABILITIES,
} from '../account.constants';
import {
  AccountMutationInput,
  AccountOptionRecord,
  AccountRecord,
  AccountSessionPayload,
  LoginLogInput,
} from '../account.types';
import { AccountItem } from '../entity/account.entity';
import { AccountRoleItem } from '../entity/account-role.entity';
import { AccountQueryForm } from '../form/account-query.form';
import { RoleItem } from '../../role/entity/role.entity';
import { RoleService } from '../../role/service/role.service';
import { SystemConfigKeys } from '../../../config-keys';
import { SYSTEM_SERVICE_NAME } from '../../../system-service.constants';
import { PasswordUtil } from '../../../utils/password.util';
import { RuntimePermissionService } from './runtime-permission.service';
import { SessionPermissionService } from './session-permission.service';
import { OperationLogService } from '../../operation-log/service/operation-log.service';
import { AccountRoleService } from './account-role.service';

const MAX_LOGIN_FAILURES = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

@Injectable()
export class AccountService extends BaseService<AccountItem> {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    @InjectRepository(AccountItem)
    accountRepo: Repository<AccountItem>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly accountRoleService: AccountRoleService,
    private readonly runtimePermissionService: RuntimePermissionService,
    private readonly sessionPermissionService: SessionPermissionService,
    private readonly operationLogService: OperationLogService,
    private readonly loginLogService: LoginLogService,
    private readonly roleService: RoleService,
  ) {
    super(accountRepo);
  }

  async getOverview() {
    return {
      service: SYSTEM_SERVICE_NAME,
      itemCount: await this.repository.count(),
      capabilities: [...ACCOUNT_CAPABILITIES],
      avatarUpload: {
        uploadUrl: getConfig<string>(
          SystemConfigKeys.AccountAvatarUploadUrl,
          ACCOUNT_AVATAR_UPLOAD_URL,
          false,
        ),
        scene: getConfig<string>(
          SystemConfigKeys.AccountAvatarUploadScene,
          ACCOUNT_AVATAR_UPLOAD_SCENE,
          false,
        ),
        businessType: ACCOUNT_AVATAR_UPLOAD_BUSINESS_TYPE,
        isTemporary: false,
      },
    };
  }

  async listItems(query: AccountQueryForm): Promise<PageResult<AccountRecord>> {
    const pageQuery = PaginationUtil.normalizePageQuery(query);
    const baseWhere: FindOptionsWhere<AccountItem> =
      query.isEnabled !== undefined ? { isEnabled: query.isEnabled } : {};
    const [items, total] = await this.repository.findAndCount({
      where: this.buildListWhere(baseWhere, query.keyword),
      order: PaginationUtil.buildOrder(query, {
        allowedSortFields: [
          'id',
          'accountName',
          'displayName',
          'lastLoginAt',
          'createdAt',
          'updatedAt',
        ],
        defaultOrder: { accountName: 'ASC' },
      }),
      skip: pageQuery.skip,
      take: pageQuery.take,
    });
    const roleCodeMap = await this.getRoleCodesByAccountIds(items.map((item) => item.id));
    return PaginationUtil.buildPageResult(
      await Promise.all(items.map((item) => this.toRecord(item, roleCodeMap.get(item.id) ?? []))),
      total,
      pageQuery,
    );
  }

  async listOptions(): Promise<AccountOptionRecord[]> {
    const items = await this.repository.find({
      where: { isEnabled: true },
      order: { accountName: 'ASC' },
    });
    return items.map((item) => this.toOptionRecord(item));
  }

  async getItem(id: number): Promise<AccountRecord> {
    const item = await this.findAccount(id);
    return this.toRecord(item);
  }

  async createItem(payload: AccountMutationInput): Promise<AccountRecord> {
    await this.assertAccountNameAvailable(payload.accountName);
    if (!payload.password) {
      throw new ProjectException('Account password is required');
    }
    const saved = await this.create(this.toEntityPayload(payload));
    await this.logOperation('account', 'item-create', saved.accountName);
    return this.toRecord(saved);
  }

  async updateItem(id: number, payload: AccountMutationInput): Promise<AccountRecord> {
    const current = await this.findAccount(id);
    const oldRoleCodes = await this.getRoleCodes(id);

    await this.assertAccountNameAvailable(payload.accountName, id);
    const saved = await this.update(id, this.toEntityPayload(payload, current));
    if (!saved) {
      throw new ProjectException(`Account not found: ${id}`);
    }

    const newRoleCodes = await this.getRoleCodes(saved.id);

    // 清理内存缓存
    this.runtimePermissionService.invalidateAccount(saved.id);

    // 更新 session 权限和角色索引
    await this.sessionPermissionService.maintainRoleAccountIndex(
      saved.id,
      oldRoleCodes,
      newRoleCodes,
    );
    await this.sessionPermissionService.updateAccountPermissions(saved.id);

    await this.logOperation('account', 'item-update', saved.accountName);
    return this.toRecord(saved, newRoleCodes);
  }

  async removeItem(id: number): Promise<AccountRecord> {
    const current = await this.findAccount(id);
    const record = await this.toRecord(current);
    await this.accountRoleService.clearByAccountId(id);
    await this.delete(id);
    this.runtimePermissionService.invalidateAccount(id);

    // 清理角色索引
    await this.sessionPermissionService.removeAccountFromRoleIndex(id);

    await this.logOperation('account', 'item-delete', current.accountName);
    return record;
  }

  async resetPassword(id: number, password: string): Promise<AccountRecord> {
    const current = await this.findAccount(id);
    current.passwordHash = PasswordUtil.hash(password);
    current.statusVersion += 1;
    current.failedLoginCount = 0;
    current.lockedUntil = null;
    const saved = await this.repository.save(current);
    this.runtimePermissionService.invalidateAccount(saved.id);
    await this.operationLogService.log({
      module: 'account',
      action: 'password-reset',
      targetType: 'account',
      targetId: saved.accountName,
      summary: `Account password reset: ${saved.accountName}`,
      operator: 'system-service',
    });
    await this.loginLogService.log({
      accountId: saved.id,
      accountName: saved.accountName,
      eventType: 'password-reset',
      success: true,
      message: 'Account password reset',
    });
    return this.toRecord(saved);
  }

  async login(
    accountName: string,
    password: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<AccountSessionPayload> {
    const account = await this.repository.findOne({
      where: { accountName: accountName.trim() },
    });
    if (!account) {
      await this.logLogin({
        accountName,
        eventType: 'login-failure',
        success: false,
        message: 'Account not found',
        ...meta,
      });
      throw new ProjectException('Invalid account or password');
    }
    if (!account.isEnabled) {
      await this.logLogin({
        accountId: account.id,
        accountName: account.accountName,
        eventType: 'login-failure',
        success: false,
        message: 'Account disabled',
        ...meta,
      });
      throw new ProjectException('Account disabled');
    }
    if (account.lockedUntil && account.lockedUntil.getTime() > Date.now()) {
      await this.logLogin({
        accountId: account.id,
        accountName: account.accountName,
        eventType: 'login-failure',
        success: false,
        message: 'Account locked',
        ...meta,
      });
      throw new ProjectException('Account locked');
    }
    if (!PasswordUtil.verify(password, account.passwordHash)) {
      await this.handleLoginFailure(account, meta);
      throw new ProjectException('Invalid account or password');
    }

    account.failedLoginCount = 0;
    account.lockedUntil = null;
    account.lastLoginAt = new Date();
    const saved = await this.repository.save(account);
    await this.logLogin({
      accountId: saved.id,
      accountName: saved.accountName,
      eventType: 'login-success',
      success: true,
      message: 'Login success',
      ...meta,
    });
    const runtime = await this.runtimePermissionService.getRuntimeByAccountId(saved.id);

    // 登录时建立角色账户索引
    await this.sessionPermissionService.addAccountToRoleIndex(saved.id, runtime.roleCodes);

    return this.buildSessionPayload(
      saved,
      runtime.permissionCodes,
      saved.lastLoginAt?.toISOString(),
    );
  }

  async refreshSession(payload?: AccountSessionPayload): Promise<AccountSessionPayload> {
    const account = await this.validateSession(payload);
    const runtime = await this.runtimePermissionService.getRuntimeByAccountId(account.id);
    return this.buildSessionPayload(account, runtime.permissionCodes, payload?.loginAt);
  }

  async logout(
    payload: AccountSessionPayload | undefined,
    meta: { ip?: string; userAgent?: string },
  ): Promise<void> {
    if (!payload?.accountId) {
      return;
    }
    const account = await this.findAccount(payload.accountId);
    await this.logLogin({
      accountId: account.id,
      accountName: account.accountName,
      eventType: 'logout',
      success: true,
      message: 'Logout success',
      ...meta,
    });
  }

  async validateSession(payload?: AccountSessionPayload): Promise<AccountItem> {
    if (!payload?.accountId) {
      throw new ProjectException('Account session not found');
    }
    const account = await this.findAccount(payload.accountId);
    if (!account.isEnabled || account.statusVersion !== payload.statusVersion) {
      throw new ProjectException('Account session expired');
    }
    return account;
  }

  async saveRoleCodes(accountId: number, roleCodes: string[]): Promise<AccountRecord> {
    const account = await this.findAccount(accountId);
    const normalizedCodes = [...new Set(roleCodes.map((item) => item.trim()).filter(Boolean))];
    const roles = normalizedCodes.length
      ? await this.roleService.findAll({
          where: { code: In(normalizedCodes), isEnabled: true } as any,
        })
      : [];
    const roleMap = new Map(roles.map((item) => [item.code, item]));
    const missingCodes = normalizedCodes.filter((item) => !roleMap.has(item));
    if (missingCodes.length) {
      throw new ProjectException(`Role codes not found or disabled: ${missingCodes.join(', ')}`);
    }

    // 清除旧关联，使用本实体的 repository（允许）
    await this.accountRoleService.clearByAccountId(accountId);
    for (const role of roles) {
      await this.accountRoleService.create({ accountId, roleId: role.id });
    }
    this.runtimePermissionService.invalidateAccount(accountId);
    await this.logOperation(
      'account-role',
      'binding-save',
      `${account.accountName}: ${normalizedCodes.join(',')}`,
    );
    return this.toRecord(account);
  }

  async listAccountsByRoleCode(roleCode: string): Promise<AccountRecord[]> {
    const role = await this.roleService.getByCode(roleCode);
    if (!role) {
      return [];
    }
    const relations = await this.accountRoleService.findByRoleId(role.id);
    const accountIds = relations.map((item) => item.accountId);
    if (!accountIds.length) {
      return [];
    }
    const accounts = await this.repository.find({
      where: { id: In(accountIds) },
      order: { accountName: 'ASC' },
    });
    return Promise.all(accounts.map((item) => this.toRecord(item)));
  }

  private buildListWhere(
    baseWhere: FindOptionsWhere<AccountItem>,
    keyword?: string,
  ): FindOptionsWhere<AccountItem>[] {
    if (!keyword) {
      return [baseWhere];
    }

    const keywordLike = ILike(`%${keyword}%`);
    return [
      { ...baseWhere, accountName: keywordLike },
      { ...baseWhere, displayName: keywordLike },
      { ...baseWhere, remark: keywordLike },
    ];
  }

  private async handleLoginFailure(
    account: AccountItem,
    meta: { ip?: string; userAgent?: string },
  ) {
    account.failedLoginCount += 1;
    const locked = account.failedLoginCount >= MAX_LOGIN_FAILURES;
    if (locked) {
      account.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
      account.statusVersion += 1;
    }
    await this.repository.save(account);
    await this.logLogin({
      accountId: account.id,
      accountName: account.accountName,
      eventType: 'login-failure',
      success: false,
      message: 'Invalid password',
      ...meta,
    });
    if (locked) {
      await this.logLogin({
        accountId: account.id,
        accountName: account.accountName,
        eventType: 'lock',
        success: true,
        message: 'Account locked due to login failures',
        ...meta,
      });
    }
  }

  private async findAccount(id: number): Promise<AccountItem> {
    const item = await this.findOne(id);
    if (!item) {
      throw new ProjectException(`Account not found: ${id}`);
    }
    return item;
  }

  private async assertAccountNameAvailable(accountName: string, currentId?: number) {
    const normalizedName = accountName.trim();
    if (!normalizedName) {
      throw new ProjectException('Account name is required');
    }
    const existing = await this.repository.findOne({
      where: { accountName: normalizedName },
    });
    if (existing && existing.id !== currentId) {
      throw new ProjectException(`Account name already exists: ${normalizedName}`);
    }
  }

  private toEntityPayload(
    payload: AccountMutationInput,
    current?: AccountItem,
  ): Partial<AccountItem> {
    return {
      accountName: payload.accountName.trim(),
      displayName: payload.displayName.trim(),
      ...(payload.password ? { passwordHash: PasswordUtil.hash(payload.password) } : {}),
      isEnabled: payload.isEnabled ?? current?.isEnabled ?? true,
      avatarUrl: payload.avatarUrl?.trim() || null,
      remark: payload.remark?.trim() || null,
    };
  }

  private toOptionRecord(entity: AccountItem): AccountOptionRecord {
    return {
      id: entity.id,
      accountName: entity.accountName,
      displayName: entity.displayName,
    };
  }

  private async toRecord(entity: AccountItem, roleCodes: string[] = []): Promise<AccountRecord> {
    return {
      id: entity.id,
      accountName: entity.accountName,
      displayName: entity.displayName,
      isEnabled: entity.isEnabled,
      failedLoginCount: entity.failedLoginCount,
      lockedUntil: entity.lockedUntil?.toISOString(),
      lastLoginAt: entity.lastLoginAt?.toISOString(),
      avatarUrl: entity.avatarUrl ?? undefined,
      remark: entity.remark ?? undefined,
      roleCodes: roleCodes.length ? roleCodes : await this.getRoleCodes(entity.id),
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  private async getRoleCodes(accountId: number): Promise<string[]> {
    const relations = await this.accountRoleService.findByAccountId(accountId);
    const roleIds = relations.map((item) => item.roleId);
    if (!roleIds.length) {
      return [];
    }
    const roles = await this.roleService.findAll({
      where: { id: In(roleIds) } as FindOptionsWhere<RoleItem>,
      order: { code: 'ASC' },
    });
    return roles.map((item) => item.code);
  }

  private async getRoleCodesByAccountIds(accountIds: number[]): Promise<Map<number, string[]>> {
    const result = new Map<number, string[]>();
    for (const accountId of accountIds) {
      result.set(accountId, []);
    }
    const normalizedAccountIds = [...new Set(accountIds)].filter(
      (accountId) => Number.isInteger(accountId) && accountId > 0,
    );
    if (!normalizedAccountIds.length) {
      return result;
    }

    const relations = await this.accountRoleService.repo.find({
      where: { accountId: In(normalizedAccountIds) },
    });
    const roleIds = [...new Set(relations.map((item) => item.roleId))];
    if (!roleIds.length) {
      return result;
    }

    const roles = await this.roleService.findAll({
      where: { id: In(roleIds) } as FindOptionsWhere<RoleItem>,
      order: { code: 'ASC' },
    });
    const roleCodeMap = new Map(roles.map((item) => [item.id, item.code]));
    for (const relation of relations) {
      const code = roleCodeMap.get(relation.roleId);
      if (code) {
        result.get(relation.accountId)?.push(code);
      }
    }
    for (const codes of result.values()) {
      codes.sort((left, right) => left.localeCompare(right, 'zh-CN'));
    }
    return result;
  }

  private buildSessionPayload(
    account: AccountItem,
    permissionCodes: string[],
    loginAt?: string,
  ): AccountSessionPayload {
    return {
      accountId: account.id,
      accountName: account.accountName,
      displayName: account.displayName,
      avatarUrl: account.avatarUrl ?? undefined,
      statusVersion: account.statusVersion,
      loginAt: loginAt ?? account.lastLoginAt?.toISOString() ?? new Date().toISOString(),
      permissionCodes,
    };
  }

  private async logOperation(module: string, action: string, summary: string) {
    await this.operationLogService.log({
      module,
      action,
      targetType: module,
      targetId: summary,
      summary,
      operator: 'system-service',
    });
  }

  private async logLogin(input: LoginLogInput) {
    await this.loginLogService.log(input);
  }
}
