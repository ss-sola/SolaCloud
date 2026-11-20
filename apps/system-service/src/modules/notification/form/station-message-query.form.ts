import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';
import { PageQueryForm } from '../../../utils/page-query.form';
import { QueryTransformUtil } from '../../../utils/query-transform.util';

export class StationMessageQueryForm extends PageQueryForm {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  receiverAccountId?: number;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => QueryTransformUtil.toOptionalBoolean(value))
  isRead?: boolean;
}
