import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class PermissionSaveForm {
  @IsString()
  @MaxLength(64)
  code!: string;

  @IsString()
  @MaxLength(64)
  name!: string;

  @IsString()
  @MaxLength(64)
  @IsOptional()
  groupKey?: string;

  @IsString()
  @MaxLength(255)
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;
}
