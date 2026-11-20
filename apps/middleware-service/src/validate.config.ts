import { DatabaseConfig } from '@nest-cloud/sdk';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

/** middleware-service 配置校验。 */
export class MiddlewareServiceConfig extends DatabaseConfig {
  @IsString()
  @IsOptional()
  SessionRedisUrl?: string;

  @IsString()
  @IsNotEmpty()
  SessionSecret!: string;

  @IsString()
  @IsOptional()
  SessionCookieName?: string;

  @IsInt()
  @Min(60000)
  @IsOptional()
  SessionTtlMs?: number;

  @IsString()
  @IsOptional()
  SessionKeyPrefix?: string;

  @IsString()
  @IsOptional()
  SessionSameSite?: string;

  @IsBoolean()
  @IsOptional()
  SessionSecure?: boolean;

  @IsString()
  @IsOptional()
  UploadRootDir?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  UploadMaxSizeBytes?: number;

  @IsString()
  @IsOptional()
  UploadChunkTempRootDir?: string;

  @IsString()
  @IsOptional()
  UploadPublicBaseUrl?: string;

  @IsString()
  @IsOptional()
  ServicePublicBaseUrl?: string;

  @IsInt()
  @Min(60000)
  @IsOptional()
  UploadTempTtlMs?: number;

  @IsString()
  @IsOptional()
  FileUploadRedisPrefix?: string;

  @IsString()
  QueueRedisUrl!: string;

  @IsString()
  @IsOptional()
  QueuePrefix?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  QueueDefaultConcurrency?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  QueueDefaultAttempts?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  QueueDefaultBackoffMs?: number;

  @IsString()
  @IsOptional()
  QueueCleanupCron?: string;

  @IsBoolean()
  @IsOptional()
  BullBoardEnabled?: boolean;

  @IsString()
  @IsOptional()
  BullBoardRoute?: string;
}
