import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryForm } from '../../../utils/page-query.form';
import { QueryTransformUtil } from '../../../utils/query-transform.util';

export class LoginLogQueryForm extends PageQueryForm {
  @IsString()
  @MaxLength(64)
  @IsOptional()
  @Transform(({ value }) => QueryTransformUtil.toOptionalString(value))
  accountName?: string;

  @IsString()
  @MaxLength(64)
  @IsOptional()
  @Transform(({ value }) => QueryTransformUtil.toOptionalString(value))
  eventType?: string;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => QueryTransformUtil.toOptionalBoolean(value))
  success?: boolean;
}
