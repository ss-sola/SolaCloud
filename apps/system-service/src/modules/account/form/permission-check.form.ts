import { ArrayUnique, IsArray, IsString, MaxLength, IsOptional } from 'class-validator';

export class PermissionCheckForm {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  @IsOptional()
  permissionCodes: string[] = [];
}
