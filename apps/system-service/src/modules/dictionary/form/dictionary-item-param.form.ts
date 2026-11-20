import { IsString, MaxLength } from 'class-validator';
import { DictionaryNamespaceParamForm } from './dictionary-namespace-param.form';

export class DictionaryItemParamForm extends DictionaryNamespaceParamForm {
  @IsString()
  @MaxLength(128)
  aggregateKey!: string;

  @IsString()
  @MaxLength(128)
  key!: string;
}
