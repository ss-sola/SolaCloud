import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { DictionaryNamespaceParamForm } from './dictionary-namespace-param.form';

export class DictionaryItemsQueryForm extends DictionaryNamespaceParamForm {
  @IsString()
  @MaxLength(128)
  aggregateKey!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  @IsOptional()
  @Transform(({ value }) => DictionaryItemsQueryForm.toOptionalKeys(value))
  keys?: string[];

  private static toOptionalKeys(value: unknown): string[] | undefined {
    const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];

    const normalized = [...new Set(values.map((item) => item.trim()).filter((item) => !!item))];
    return normalized.length ? normalized : undefined;
  }
}
