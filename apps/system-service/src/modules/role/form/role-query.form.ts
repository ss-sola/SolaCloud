import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryForm } from '../../../utils/page-query.form';
import { QueryTransformUtil } from '../../../utils/query-transform.util';

export class RoleQueryForm extends PageQueryForm {
  @IsString()
  @MaxLength(64)
  @IsOptional()
  @Transform(({ value }) => QueryTransformUtil.toOptionalString(value))
  keyword?: string;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => QueryTransformUtil.toOptionalBoolean(value))
  isEnabled?: boolean;
}
