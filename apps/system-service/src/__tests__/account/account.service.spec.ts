import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { AccountItem } from '@/modules/account/entity/account.entity';
import { AccountRoleItem } from '@/modules/account/entity/account-role.entity';
import { AccountService } from '@/modules/account/service/account.service';
import { AccountRoleService } from '@/modules/account/service/account-role.service';
import { RuntimePermissionService } from '@/modules/account/service/runtime-permission.service';
import { RoleItem } from '@/modules/role/entity/role.entity';
import { RoleService } from '@/modules/role/service/role.service';
import { PasswordUtil } from '@/utils/password.util';
import { AccountQueryForm } from '@/modules/account/form/account-query.form';

type MockRepository<T extends object> = Partial<Record<keyof Repository<T>, any>>;

type AccountServiceContext = ReturnType<typeof createService>;

function createService() {
  const accountItems = new Map<number, AccountItem>();
  const accountRoleRelations: AccountRoleItem[] = [];
  const roleItems = new Map<number, RoleItem>();
  const operationLogs: Record<string, unknown>[] = [];
  const loginLogs: Record<string, unknown>[] = [];

  let accountSequence = 1;
  let relationSequence = 1;

  const accountRepository: MockRepository<AccountItem> = {
    count: vi.fn(() => Promise.resolve(accountItems.size)),
    findAndCount: vi.fn(
      ({
        where,
        skip = 0,
        take = 10,
      }: {
        where?: Record<string, unknown>;
        skip?: number;
        take?: number;
      }) => {
        let values = [...accountItems.values()];
        if (where) {
          const whereList = Array.isArray(where) ? where : [where];
          values = values.filter((item) => whereList.some((w) => matchesWhere(item, w)));
        }
        return Promise.resolve([values.slice(skip, skip + take), values.length]);
      },
    ),
    findOne: vi.fn(({ where }: { where: { id?: number; accountName?: string } }) => {
      if (where.id !== undefined) {
        return Promise.resolve(accountItems.get(where.id) ?? null);
      }
      return Promise.resolve(
        [...accountItems.values()].find((item) => item.accountName === where.accountName) ?? null,
      );
    }),
    find: vi.fn((options?: { where?: Record<string, unknown> }) => {
      let values = [...accountItems.values()];
      if (options?.where) {
        values = values.filter((item) => matchesWhere(item, options.where!));
      }
      return Promise.resolve(values.sort((left, right) => left.id - right.id));
    }),
    create: vi.fn((input: Partial<AccountItem>) =>
      createAccountItem({ input, id: accountSequence }),
    ),
    save: vi.fn((entity: AccountItem) => {
      if (!entity.id) {
        entity.id = accountSequence;
      }
      if (entity.id === accountSequence) {
        accountSequence += 1;
      }
      entity.updatedAt = new Date('2026-05-29T00:00:00.000Z');
      accountItems.set(entity.id, entity);
      return Promise.resolve(entity);
    }),
    remove: vi.fn((entity: AccountItem) => {
      accountItems.delete(entity.id);
      return Promise.resolve(entity);
    }),
    update: vi.fn((id: number, data: Record<string, unknown>) => {
      const item = accountItems.get(id);
      if (item) {
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined && key !== 'id') {
            (item as unknown as Record<string, unknown>)[key] = value;
          }
        }
      }
      return Promise.resolve({ affected: item ? 1 : 0 } as any);
    }),
    softDelete: vi.fn((id: number) => {
      accountItems.delete(id);
      return Promise.resolve({ affected: 1 } as any);
    }),
  };

  const accountRoleRepository: MockRepository<AccountRoleItem> = {
    find: vi.fn((options?: { where?: Record<string, unknown> }) =>
      Promise.resolve(filterItems(accountRoleRelations, options?.where)),
    ),
    delete: vi.fn((criteria: { accountId?: number }) => {
      removeItems(accountRoleRelations, criteria);
      return Promise.resolve(undefined);
    }),
    create: vi.fn((input: Partial<AccountRoleItem>) => {
      const entity = createAccountRoleItem({ input, id: relationSequence++ });
      accountRoleRelations.push(entity);
      return Promise.resolve(entity);
    }),
    save: vi.fn((entity: AccountRoleItem) => {
      accountRoleRelations.push(entity);
      return Promise.resolve(entity);
    }),
  };

  const roleRepository: MockRepository<RoleItem> = {
    find: vi.fn((options?: { where?: Record<string, unknown> }) => {
      let values = [...roleItems.values()];
      if (options?.where) {
        values = values.filter((item) => matchesWhere(item, options.where!));
      }
      return Promise.resolve(values.sort((left, right) => left.id - right.id));
    }),
    findOne: vi.fn(({ where }: { where: { code?: string; id?: number } }) => {
      if (where.id !== undefined) {
        return Promise.resolve(roleItems.get(where.id) ?? null);
      }
      return Promise.resolve(
        [...roleItems.values()].find((item) => item.code === where.code) ?? null,
      );
    }),
  };

  const operationLogService = {
    log: vi.fn((input: Record<string, unknown>) => {
      operationLogs.push(input as any);
      return Promise.resolve(input);
    }),
  };

  const loginLogService = {
    log: vi.fn((input: Record<string, unknown>) => {
      loginLogs.push(input as any);
      return Promise.resolve(input);
    }),
  };

  const repositoryMap = new Map<object, MockRepository<any>>([
    [AccountItem, accountRepository],
    [AccountRoleItem, accountRoleRepository],
    [RoleItem, roleRepository],
  ]);

  const dataSource = {
    getRepository: vi.fn((target: object) => {
      const repository = repositoryMap.get(target);
      if (!repository) {
        throw new Error(`Repository not mocked: ${String(target)}`);
      }
      return repository;
    }),
  } as unknown as DataSource;

  const runtimePermissionService = {
    invalidateAccount: vi.fn(),
    getRuntimeByAccountId: vi.fn((accountId: number) =>
      Promise.resolve({
        account: {
          id: accountId,
          accountName: 'admin',
          displayName: '管理员',
          avatarUrl: undefined,
        },
        roleCodes: ['admin'],
        permissionCodes: ['system:manage', 'user:query'],
        menuTree: [],
      }),
    ),
  } as unknown as RuntimePermissionService;

  const accountRoleService = {
    findByAccountId: vi.fn((accountId: number) =>
      Promise.resolve(
        accountRoleRelations.filter((r) => r.accountId === accountId).map((r) => ({ ...r })),
      ),
    ),
    findByRoleId: vi.fn((roleId: number) =>
      Promise.resolve(
        accountRoleRelations.filter((r) => r.roleId === roleId).map((r) => ({ ...r })),
      ),
    ),
    clearByAccountId: vi.fn((accountId: number) => {
      removeItems(accountRoleRelations, { accountId });
      return Promise.resolve();
    }),
    create: vi.fn((input: Partial<AccountRoleItem>) => {
      const entity = createAccountRoleItem({ input, id: relationSequence++ });
      accountRoleRelations.push(entity);
      return Promise.resolve(entity);
    }),
    findAll: vi.fn(() => Promise.resolve(accountRoleRelations)),
    findOne: vi.fn(() => Promise.resolve(undefined)),
    update: vi.fn(() => Promise.resolve(undefined)),
    delete: vi.fn(() => Promise.resolve(undefined)),
    softDelete: vi.fn(() => Promise.resolve(undefined)),
    restore: vi.fn(() => Promise.resolve(undefined)),
    get repo() {
      return {
        find: vi.fn((options?: { where?: Record<string, unknown> }) =>
          Promise.resolve(filterItems(accountRoleRelations, options?.where)),
        ),
        delete: vi.fn((criteria: { accountId?: number }) => {
          removeItems(accountRoleRelations, criteria);
          return Promise.resolve(undefined);
        }),
        save: vi.fn((entity: AccountRoleItem) => {
          accountRoleRelations.push(entity);
          return Promise.resolve(entity);
        }),
      } as unknown as Repository<AccountRoleItem>;
    },
  } as unknown as AccountRoleService;

  const sessionPermissionService = {
    addAccountToRoleIndex: vi.fn(),
    maintainRoleAccountIndex: vi.fn(),
    updateAccountPermissions: vi.fn(),
    removeAccountFromRoleIndex: vi.fn(),
  };

  const roleService = {
    findAll: vi.fn(
      (options?: { where?: Record<string, unknown>; order?: Record<string, string> }) => {
        let values = [...roleItems.values()];
        if (options?.where) {
          values = values.filter((item) => matchesWhere(item, options.where!));
        }
        if (options?.order) {
          const field = Object.keys(options.order)[0];
          const dir = options.order[field];
          values.sort((a, b) => {
            const av = (a as any)[field];
            const bv = (b as any)[field];
            if (dir === 'DESC') {
              return av > bv ? -1 : av < bv ? 1 : 0;
            }
            return av < bv ? -1 : av > bv ? 1 : 0;
          });
        }
        return Promise.resolve(values);
      },
    ),
    getByCode: vi.fn((code: string) =>
      Promise.resolve([...roleItems.values()].find((item) => item.code === code) ?? null),
    ),
    find: vi.fn((options?: { where?: Record<string, unknown> }) => {
      let values = [...roleItems.values()];
      if (options?.where) {
        values = values.filter((item) => matchesWhere(item, options.where!));
      }
      return Promise.resolve(values);
    }),
  } as unknown as RoleService;

  return {
    service: new AccountService(
      dataSource.getRepository(AccountItem) as Repository<AccountItem>,
      dataSource,
      accountRoleService,
      runtimePermissionService,
      sessionPermissionService as never,
      operationLogService as never,
      loginLogService as never,
      roleService,
    ),
    stores: {
      accountItems,
      accountRoleRelations,
      roleItems,
      operationLogs,
      loginLogs,
    },
    runtimePermissionService,
    accountRoleService,
    roleService,
  };
}

function createAccountItem(params: { input: Partial<AccountItem>; id: number }): AccountItem {
  return {
    id: params.input.id ?? params.id,
    accountName: params.input.accountName ?? '',
    displayName: params.input.displayName ?? '',
    passwordHash: params.input.passwordHash ?? PasswordUtil.hash('admin123'),
    isEnabled: params.input.isEnabled ?? true,
    failedLoginCount: params.input.failedLoginCount ?? 0,
    lockedUntil: params.input.lockedUntil ?? null,
    lastLoginAt: params.input.lastLoginAt ?? null,
    statusVersion: params.input.statusVersion,
    avatarUrl: params.input.avatarUrl ?? null,
    remark: params.input.remark ?? null,
    createdAt: params.input.createdAt ?? new Date('2026-05-29T00:00:00.000Z'),
    updatedAt: params.input.updatedAt ?? new Date('2026-05-29T00:00:00.000Z'),
  } as AccountItem;
}

function createAccountRoleItem(params: {
  input: Partial<AccountRoleItem>;
  id: number;
}): AccountRoleItem {
  return {
    id: params.id,
    accountId: params.input.accountId ?? 0,
    roleId: params.input.roleId ?? 0,
    createdAt: new Date('2026-05-29T00:00:00.000Z'),
    updatedAt: new Date('2026-05-29T00:00:00.000Z'),
  } as AccountRoleItem;
}

function filterItems<T extends object>(items: T[], where?: Record<string, unknown>) {
  if (!where) {
    return [...items];
  }
  return items.filter((item) => matchesWhere(item, where));
}

function removeItems<T extends object>(items: T[], criteria: Record<string, unknown>) {
  const remaining = items.filter((item) => !matchesWhere(item, criteria));
  items.splice(0, items.length, ...remaining);
}

function matchesWhere(item: object, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => {
    const current = (item as Record<string, unknown>)[key];
    if (value && typeof value === 'object' && '_type' in value) {
      const marker = value as { _type?: string; _value?: unknown };
      if (marker._type === 'ilike') {
        const keyword = String(marker._value ?? '')
          .replaceAll('%', '')
          .toLowerCase();
        return String(current ?? '')
          .toLowerCase()
          .includes(keyword);
      }
      if (marker._type === 'in' && Array.isArray(marker._value)) {
        return marker._value.includes(current);
      }
    }
    return current === value;
  });
}

function seedAccount(
  context: AccountServiceContext,
  input: Partial<AccountItem> & {
    id: number;
    accountName: string;
    displayName: string;
    password: string;
  },
) {
  context.stores.accountItems.set(input.id, {
    id: input.id,
    accountName: input.accountName,
    displayName: input.displayName,
    passwordHash: PasswordUtil.hash(input.password),
    isEnabled: input.isEnabled ?? true,
    failedLoginCount: input.failedLoginCount ?? 0,
    lockedUntil: input.lockedUntil ?? null,
    lastLoginAt: input.lastLoginAt ?? null,
    statusVersion: input.statusVersion ?? 1,
    avatarUrl: input.avatarUrl ?? null,
    remark: input.remark ?? null,
    createdAt: new Date('2026-05-29T00:00:00.000Z'),
    updatedAt: new Date('2026-05-29T00:00:00.000Z'),
  } as AccountItem);
}

describe('AccountService', () => {
  let context: AccountServiceContext;

  beforeEach(() => {
    context = createService();
  });

  it('should return enabled account options with minimal fields', async () => {
    seedAccount(context, {
      id: 1,
      accountName: 'admin',
      displayName: '系统管理员',
      password: 'admin123',
      isEnabled: true,
      avatarUrl: 'https://example.com/admin.png',
      remark: '管理员',
    });
    seedAccount(context, {
      id: 2,
      accountName: 'ops',
      displayName: '运维账号',
      password: 'admin123',
      isEnabled: true,
    });
    seedAccount(context, {
      id: 3,
      accountName: 'disabled',
      displayName: '停用账号',
      password: 'admin123',
      isEnabled: false,
    });

    await expect(context.service.listOptions()).resolves.toEqual([
      {
        id: 1,
        accountName: 'admin',
        displayName: '系统管理员',
      },
      {
        id: 2,
        accountName: 'ops',
        displayName: '运维账号',
      },
    ]);
  });

  it('should save avatar url and include it in session payload', async () => {
    const record = await context.service.createItem({
      accountName: 'avatar-admin',
      displayName: '头像管理员',
      password: 'admin123',
      isEnabled: true,
      avatarUrl: ' https://example.com/avatar.png ',
    });

    const session = await context.service.login('avatar-admin', 'admin123', {});

    expect(record.avatarUrl).toBe('https://example.com/avatar.png');
    expect(session.avatarUrl).toBe('https://example.com/avatar.png');
  });

  it('returns unauthorized for missing, stale, and deleted account sessions', async () => {
    await expect(context.service.validateSession()).rejects.toMatchObject({ status: 401 });

    seedAccount(context, {
      id: 1,
      accountName: 'admin',
      displayName: '系统管理员',
      password: 'admin123',
    });
    const session = await context.service.login('admin', 'admin123', {});
    const stale = { ...session, statusVersion: session.statusVersion - 1 };
    await expect(context.service.refreshSession(stale)).rejects.toMatchObject({ status: 401 });

    context.stores.accountItems.delete(session.accountId);
    await expect(context.service.validateSession(session)).rejects.toMatchObject({ status: 401 });
  });

  it('should preserve loginAt when refreshing session', async () => {
    seedAccount(context, {
      id: 1,
      accountName: 'admin',
      displayName: '系统管理员',
      password: 'admin123',
      avatarUrl: 'https://example.com/admin.png',
    });

    const session = await context.service.login('admin', 'admin123', {});
    const refreshed = await context.service.refreshSession(session);

    expect(refreshed.accountId).toBe(1);
    expect(refreshed.avatarUrl).toBe('https://example.com/admin.png');
    expect(refreshed.loginAt).toBe(session.loginAt);
    expect(context.stores.loginLogs.map((item) => item.eventType)).toEqual(['login-success']);
  });

  it('should keep current session valid after profile update', async () => {
    seedAccount(context, {
      id: 1,
      accountName: 'admin',
      displayName: '系统管理员',
      password: 'admin123',
      statusVersion: 3,
    });

    const session = await context.service.login('admin', 'admin123', {});
    await context.service.updateItem(1, {
      accountName: 'admin',
      displayName: '系统管理员2',
      isEnabled: true,
      avatarUrl: 'https://example.com/admin-new.png',
    });
    const refreshed = await context.service.refreshSession(session);

    expect(context.stores.accountItems.get(1)?.statusVersion).toBe(3);
    expect(refreshed.accountId).toBe(1);
    expect(refreshed.displayName).toBe('系统管理员2');
  });

  it('should lock account after repeated login failures', async () => {
    seedAccount(context, {
      id: 1,
      accountName: 'admin',
      displayName: '系统管理员',
      password: 'admin123',
      statusVersion: 3,
    });

    for (let index = 0; index < 5; index += 1) {
      await expect(
        context.service.login('admin', 'wrong-password', {
          ip: '127.0.0.1',
          userAgent: 'jest',
        }),
      ).rejects.toThrow('Invalid account or password');
    }

    const account = context.stores.accountItems.get(1);
    expect(account?.failedLoginCount).toBe(5);
    expect(account?.statusVersion).toBe(4);
    expect(account?.lockedUntil).toBeInstanceOf(Date);
    expect(
      context.stores.loginLogs.filter((item) => item.eventType === 'login-failure'),
    ).toHaveLength(5);
    expect(context.stores.loginLogs.at(-1)?.eventType).toBe('lock');
  });

  it('should reset password, invalidate runtime cache and write audit logs', async () => {
    seedAccount(context, {
      id: 7,
      accountName: 'auditor',
      displayName: '审计员',
      password: 'old-pass',
      failedLoginCount: 2,
      lockedUntil: new Date('2026-05-29T09:00:00.000Z'),
    });

    const record = await context.service.resetPassword(7, 'new-pass');
    const saved = context.stores.accountItems.get(7);

    expect(record.failedLoginCount).toBe(0);
    expect(record.lockedUntil).toBeUndefined();
    expect(saved?.lockedUntil).toBeNull();
    expect(saved && PasswordUtil.verify('new-pass', saved.passwordHash)).toBe(true);
    expect(saved?.statusVersion).toBe(2);
    expect(context.runtimePermissionService.invalidateAccount).toHaveBeenCalledWith(7);
    expect(context.stores.operationLogs.at(-1)?.action).toBe('password-reset');
    expect(context.stores.loginLogs.at(-1)?.eventType).toBe('password-reset');
  });

  // --- listItems ---

  it('should list accounts with pagination', async () => {
    seedAccount(context, {
      id: 1,
      accountName: 'admin',
      displayName: '管理员',
      password: 'admin123',
    });
    seedAccount(context, {
      id: 2,
      accountName: 'ops',
      displayName: '运维',
      password: 'admin123',
    });

    const query = new AccountQueryForm();
    query.pageNum = 1;
    query.pageSize = 10;

    const result = await context.service.listItems(query);
    expect(result.total).toBe(2);
    expect(result.list).toHaveLength(2);
    expect(result.list[0].accountName).toBe('admin');
  });

  it('should filter accounts by keyword', async () => {
    seedAccount(context, {
      id: 1,
      accountName: 'admin',
      displayName: '管理员',
      password: 'admin123',
    });
    seedAccount(context, {
      id: 2,
      accountName: 'ops',
      displayName: '运维',
      password: 'admin123',
    });

    const query = new AccountQueryForm();
    query.pageNum = 1;
    query.pageSize = 10;
    query.keyword = 'admin';

    const result = await context.service.listItems(query);
    expect(result.total).toBe(1);
    expect(result.list[0].accountName).toBe('admin');
  });

  // --- createItem ---

  it('should create an account', async () => {
    const record = await context.service.createItem({
      accountName: 'new-account',
      displayName: '新账号',
      password: 'pass123',
      isEnabled: true,
    });

    expect(record.accountName).toBe('new-account');
    expect(record.displayName).toBe('新账号');
    expect(context.stores.operationLogs.at(-1)?.action).toBe('item-create');
  });

  it('should reject creation with duplicate account name', async () => {
    seedAccount(context, {
      id: 1,
      accountName: 'existing',
      displayName: '已有',
      password: 'pass123',
    });

    await expect(
      context.service.createItem({
        accountName: 'existing',
        displayName: '重复',
        password: 'pass123',
      }),
    ).rejects.toThrow('Account name already exists');
  });

  it('should reject creation with empty password', async () => {
    await expect(
      context.service.createItem({
        accountName: 'no-pass',
        displayName: '无密码',
        password: '',
      }),
    ).rejects.toThrow('Account password is required');
  });

  // --- updateItem ---

  it('should update an account', async () => {
    seedAccount(context, {
      id: 1,
      accountName: 'admin',
      displayName: '管理员',
      password: 'admin123',
    });

    const record = await context.service.updateItem(1, {
      accountName: 'admin',
      displayName: '管理员更新',
      isEnabled: true,
    });

    expect(record.displayName).toBe('管理员更新');
    expect(context.stores.accountItems.get(1)?.displayName).toBe('管理员更新');
  });

  it('should reject update with duplicate account name', async () => {
    seedAccount(context, {
      id: 1,
      accountName: 'admin',
      displayName: '管理员',
      password: 'admin123',
    });
    seedAccount(context, {
      id: 2,
      accountName: 'ops',
      displayName: '运维',
      password: 'admin123',
    });

    await expect(
      context.service.updateItem(2, {
        accountName: 'admin',
        displayName: '运维',
        isEnabled: true,
      }),
    ).rejects.toThrow('Account name already exists');
  });

  // --- removeItem ---

  it('should remove an account', async () => {
    seedAccount(context, {
      id: 1,
      accountName: 'admin',
      displayName: '管理员',
      password: 'admin123',
    });

    const record = await context.service.removeItem(1);
    expect(record.accountName).toBe('admin');
    expect(context.stores.accountItems.has(1)).toBe(false);
    expect(context.stores.accountRoleRelations).toHaveLength(0);
  });

  it('should throw when removing non-existent account', async () => {
    await expect(context.service.removeItem(999)).rejects.toThrow('Account not found');
  });

  // --- saveRoleCodes ---

  it('should save role codes for an account', async () => {
    seedAccount(context, {
      id: 1,
      accountName: 'admin',
      displayName: '管理员',
      password: 'admin123',
    });

    // Mock the roleService to return the role directly
    context.roleService.findAll = vi.fn().mockResolvedValue([
      {
        id: 1,
        code: 'admin',
        name: '管理员',
        isEnabled: true,
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as RoleItem,
    ]);

    const record = await context.service.saveRoleCodes(1, ['admin']);
    expect(record.accountName).toBe('admin');
    expect(context.stores.accountRoleRelations.length).toBeGreaterThan(0);
  });

  it('should reject saving role codes for non-existent role', async () => {
    seedAccount(context, {
      id: 1,
      accountName: 'admin',
      displayName: '管理员',
      password: 'admin123',
    });

    await expect(context.service.saveRoleCodes(1, ['non-existent'])).rejects.toThrow(
      'Role codes not found or disabled',
    );
  });

  // --- listAccountsByRoleCode ---

  it('should list accounts by role code', async () => {
    seedAccount(context, {
      id: 1,
      accountName: 'admin',
      displayName: '管理员',
      password: 'admin123',
    });
    seedAccount(context, {
      id: 2,
      accountName: 'ops',
      displayName: '运维',
      password: 'admin123',
    });
    context.stores.roleItems.set(1, {
      id: 1,
      code: 'admin',
      name: '管理员',
      isEnabled: true,
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as RoleItem);

    context.stores.accountRoleRelations.push(
      createAccountRoleItem({ input: { accountId: 1, roleId: 1 }, id: 1 }),
    );

    const result = await context.service.listAccountsByRoleCode('admin');
    expect(result).toHaveLength(1);
    expect(result[0].accountName).toBe('admin');
  });

  it('should return empty array when role code does not exist', async () => {
    const result = await context.service.listAccountsByRoleCode('non-existent');
    expect(result).toEqual([]);
  });
});
