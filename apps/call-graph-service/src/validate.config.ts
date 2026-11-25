import { CommonConfig } from '@nest-cloud/sdk';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CallGraphConfig extends CommonConfig {
  override ServiceName = 'call-graph-service';
  override Port = 3500;
  override GlobalPrefix = 'api';

  @IsString()
  @IsNotEmpty()
  SessionSecret!: string;

  @IsOptional()
  @IsString()
  SessionRedisUrl?: string;

  @IsOptional()
  @IsString()
  SessionCookieName?: string;

  @IsOptional()
  @IsString()
  SessionKeyPrefix?: string;

  @IsOptional()
  @IsInt()
  @Min(60000)
  SessionTtlMs?: number;

  @IsOptional()
  @IsString()
  SessionSameSite?: string;

  @IsOptional()
  @IsBoolean()
  SessionSecure?: boolean;
}
