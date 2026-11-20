import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryForm } from '../../../utils/page-query.form';
import { QueryTransformUtil } from '../../../utils/query-transform.util';

export class OnlineUserQueryForm extends PageQueryForm {
  @IsString()
  @MaxLength(128)
  @IsOptional()
  @Transform(({ value }) => QueryTransformUtil.toOptionalString(value))
  keyword?: string;
}
