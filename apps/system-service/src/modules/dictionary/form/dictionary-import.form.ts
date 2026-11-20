import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { DictionaryImportItemForm } from './dictionary-import-item.form';

export class DictionaryImportForm {
  @IsString()
  @MaxLength(64)
  namespace!: string;

  @IsString()
  @MaxLength(128)
  @IsOptional()
  label?: string;

  @IsString()
  @MaxLength(255)
  @IsOptional()
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DictionaryImportItemForm)
  items!: DictionaryImportItemForm[];
}
