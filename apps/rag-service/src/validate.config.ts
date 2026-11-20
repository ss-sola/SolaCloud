import { DatabaseConfig } from '@nest-cloud/sdk';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

/** rag-service 配置校验。 */
export class RagServiceConfig extends DatabaseConfig {
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

  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') return true;
      if (normalized === 'false' || normalized === '0') return false;
    }
    return value;
  })
  @IsBoolean()
  @IsOptional()
  SessionSecure?: boolean | string;

  @IsString()
  @IsOptional()
  UploadRootDir?: string;

  @IsString()
  @IsOptional()
  UploadPublicBaseUrl?: string;

  @IsString()
  @IsOptional()
  DeepAgentsWorkspaceRoot?: string;

  @IsInt()
  @Min(1000)
  @IsOptional()
  DeepAgentsSandboxTimeoutMs?: number;

  @IsInt()
  @Min(64)
  @IsOptional()
  DeepAgentsDiskQuotaMb?: number;

  @IsInt()
  @Min(60)
  @IsOptional()
  DeepAgentsCleanupIntervalSec?: number;
}
