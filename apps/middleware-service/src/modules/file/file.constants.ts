export const FILE_CONTROLLER_ROUTE = 'file';
export const FILE_MANAGE_PERMISSION = 'system:attachment:manage';

export const FILE_UPLOAD_FIELD_NAME = 'file';

export const DEFAULT_UPLOAD_ROOT_DIR = 'public/uploads';

export const DEFAULT_UPLOAD_CHUNK_TEMP_ROOT_DIR = 'var/uploads/chunks';

export const DEFAULT_UPLOAD_PUBLIC_BASE_URL = '/public/uploads';

export const DEFAULT_UPLOAD_MAX_SIZE_BYTES = 1000 * 1024 * 1024;

export const INTERCEPTOR_UPLOAD_MAX_SIZE_BYTES = 100 * 1024 * 1024;

export const DEFAULT_UPLOAD_TEMP_TTL_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_FILE_UPLOAD_REDIS_PREFIX = 'file:upload';

export const FILE_BUSINESS_TYPES = {
  AccountAvatar: 'account-avatar',
} as const;

export const FILE_STATUS = {
  Available: 'available',
  Deleted: 'deleted',
} as const;

export const FILE_UPLOAD_SESSION_STATUS = {
  Pending: 'pending',
  Uploading: 'uploading',
  ReadyToMerge: 'ready-to-merge',
  Merging: 'merging',
  Completed: 'completed',
  Failed: 'failed',
  Expired: 'expired',
} as const;

export type FileBusinessType = (typeof FILE_BUSINESS_TYPES)[keyof typeof FILE_BUSINESS_TYPES];

export type FileStatus = (typeof FILE_STATUS)[keyof typeof FILE_STATUS];

export type FileUploadSessionStatus =
  (typeof FILE_UPLOAD_SESSION_STATUS)[keyof typeof FILE_UPLOAD_SESSION_STATUS];
