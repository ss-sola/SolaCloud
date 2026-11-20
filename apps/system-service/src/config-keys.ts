/**
 * system-service specific config keys.
 * Runtime business data remains in database modules, not config files.
 */
export const SystemConfigKeys = {
  /** Account avatar multipart upload endpoint exposed to the admin UI. */
  AccountAvatarUploadUrl: 'AccountAvatarUploadUrl',
  /** File upload scene used for account avatar files. */
  AccountAvatarUploadScene: 'AccountAvatarUploadScene',
} as const;
