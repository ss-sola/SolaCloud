import { DatabaseConfig } from '@nest-cloud/sdk';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, Min } from 'class-validator';

/** system-service 配置校验。继承 DatabaseConfig，额外校验 RegistryUrl。 */
export class SystemServiceConfig extends DatabaseConfig {
  @IsUrl({ require_tld: false })
  RegistryUrl!: string;

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
  AccountAvatarUploadUrl?: string;

  @IsString()
  @IsOptional()
  AccountAvatarUploadScene?: string;
}
