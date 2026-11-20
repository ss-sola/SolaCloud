import { ArrayUnique, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class RoleSaveForm {
  @IsString()
  @MaxLength(64)
  code!: string;

  @IsString()
  @MaxLength(64)
  name!: string;

  @IsString()
  @MaxLength(255)
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  @IsOptional()
  permissionCodes?: string[];
}
