/** Redis key 前缀：角色账户索引 role_accounts:{roleCode} → Set<accountId> */
export const ROLE_ACCOUNTS_KEY_PREFIX = 'role_accounts';

/** 构建角色账户索引的 Redis key */
export function buildRoleAccountsKey(roleCode: string): string {
  return `${ROLE_ACCOUNTS_KEY_PREFIX}:${roleCode}`;
}
