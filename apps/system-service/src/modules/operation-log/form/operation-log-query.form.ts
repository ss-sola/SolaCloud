import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryForm } from '../../../utils/page-query.form';
import { QueryTransformUtil } from '../../../utils/query-transform.util';

export class OperationLogQueryForm extends PageQueryForm {
  @IsString()
  @MaxLength(64)
  @IsOptional()
  @Transform(({ value }) => QueryTransformUtil.toOptionalString(value))
  module?: string;

  @IsString()
  @MaxLength(64)
  @IsOptional()
  @Transform(({ value }) => QueryTransformUtil.toOptionalString(value))
  action?: string;

  @IsString()
  @MaxLength(64)
  @IsOptional()
  @Transform(({ value }) => QueryTransformUtil.toOptionalString(value))
  targetType?: string;

  @IsString()
  @MaxLength(64)
  @IsOptional()
  @Transform(({ value }) => QueryTransformUtil.toOptionalString(value))
  operator?: string;
}
