import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { QueryTransformUtil } from '../../../utils/query-transform.util';
import { DictionaryNamespaceParamForm } from './dictionary-namespace-param.form';

export class DictionaryAggregateQueryForm extends DictionaryNamespaceParamForm {
  @IsString()
  @MaxLength(128)
  @IsOptional()
  @Transform(({ value }) => QueryTransformUtil.toOptionalString(value))
  keyword?: string;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => QueryTransformUtil.toOptionalBoolean(value))
  isEnabled?: boolean;
}
