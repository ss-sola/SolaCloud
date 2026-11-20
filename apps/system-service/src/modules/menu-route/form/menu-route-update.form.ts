import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class MenuRouteUpdateForm {
  @IsString()
  @MaxLength(64)
  name!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  parentId?: number;

  /** routeName：对应前端路由表的 name 字段，叶子节点必填 */
  @IsString()
  @MaxLength(128)
  @IsOptional()
  routeName?: string;

  @IsString()
  @MaxLength(255)
  @IsOptional()
  redirect?: string;

  @IsString()
  @MaxLength(64)
  @IsOptional()
  icon?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  sort?: number;

  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  isGroup?: boolean;

  @IsBoolean()
  @IsOptional()
  hideHeader?: boolean;

  @IsBoolean()
  @IsOptional()
  hideRoute?: boolean;

  @IsString()
  @MaxLength(32)
  @IsOptional()
  routeRoot?: string;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  @IsOptional()
  permissionCodes?: string[];
}
