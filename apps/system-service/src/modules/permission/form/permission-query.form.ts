import { PageCommon } from '@nest-cloud/sdk';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { QueryTransformUtil } from '../../../utils/query-transform.util';

export class PermissionQueryForm extends PageCommon {
  @IsString()
  @MaxLength(128)
  @IsOptional()
  @Transform(({ value }) => QueryTransformUtil.toOptionalString(value))
  sort?: string;

  @IsString()
  @MaxLength(64)
  @IsOptional()
  @Transform(({ value }) => QueryTransformUtil.toOptionalString(value))
  keyword?: string;

  @IsString()
  @MaxLength(64)
  @IsOptional()
  @Transform(({ value }) => QueryTransformUtil.toOptionalString(value))
  groupKey?: string;

  @IsBoolean()
  @IsOptional()
  @Transform(({ obj, key }) => QueryTransformUtil.toOptionalBoolean(obj[key]))
  isEnabled?: boolean;
}

export class PermissionListQueryForm extends PermissionQueryForm {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  override pageNum = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  override pageSize = 10;
}
