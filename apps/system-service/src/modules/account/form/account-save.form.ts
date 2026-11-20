import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AccountSaveForm {
  @IsString()
  @MaxLength(64)
  accountName!: string;

  @IsString()
  @MaxLength(64)
  displayName!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(64)
  @IsOptional()
  password?: string;

  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;

  @IsString()
  @MaxLength(512)
  @IsOptional()
  avatarUrl?: string;

  @IsString()
  @MaxLength(255)
  @IsOptional()
  remark?: string;
}
