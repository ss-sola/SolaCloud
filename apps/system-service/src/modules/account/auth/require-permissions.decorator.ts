import { applyDecorators, SetMetadata } from '@nestjs/common';

export type RequiredPermissionMatchMode = 'all' | 'any';

export const REQUIRED_PERMISSION_CODES_KEY = 'system-service:required-permission-codes';
export const REQUIRED_PERMISSION_MATCH_MODE_KEY = 'system-service:required-permission-match-mode';

export function RequirePermissions(...permissionCodes: string[]) {
  return applyDecorators(
    SetMetadata(REQUIRED_PERMISSION_CODES_KEY, permissionCodes),
    SetMetadata(REQUIRED_PERMISSION_MATCH_MODE_KEY, 'all'),
  );
}

export function RequireAnyPermissions(...permissionCodes: string[]) {
  return applyDecorators(
    SetMetadata(REQUIRED_PERMISSION_CODES_KEY, permissionCodes),
    SetMetadata(REQUIRED_PERMISSION_MATCH_MODE_KEY, 'any'),
  );
}
