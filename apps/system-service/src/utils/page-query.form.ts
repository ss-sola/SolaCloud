import { PageCommon } from '@nest-cloud/sdk';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { QueryTransformUtil } from './query-transform.util';

export class PageQueryForm extends PageCommon {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  pageNum: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  pageSize: number = 10;

  @IsString()
  @MaxLength(128)
  @IsOptional()
  @Transform(({ value }) => QueryTransformUtil.toOptionalString(value))
  sort?: string;
}
