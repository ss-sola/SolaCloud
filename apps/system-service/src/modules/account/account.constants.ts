export const ACCOUNT_CONTROLLER_ROUTE = 'system/accounts';
export const AUTH_CONTROLLER_ROUTE = 'system/auth';

export const ACCOUNT_RUNTIME_CACHE_PREFIX = 'runtime-permission:account';

export const ACCOUNT_AVATAR_UPLOAD_BUSINESS_TYPE = 'account-avatar';
export const ACCOUNT_AVATAR_UPLOAD_SCENE = 'account';
export const ACCOUNT_AVATAR_UPLOAD_URL = 'http://localhost:3300/api/file/upload';

export const ACCOUNT_CAPABILITIES = [
  'item-crud',
  'login-session',
  'role-binding',
  'password-reset',
  'avatar-upload',
] as const;

export const AUTH_SESSION_COOKIE_NAME = 'system.sid';
export const AUTH_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const AUTH_SESSION_KEY_PREFIX = 'system-session';
