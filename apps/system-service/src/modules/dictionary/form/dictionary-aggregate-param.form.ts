import { IsString, MaxLength } from 'class-validator';
import { DictionaryNamespaceParamForm } from './dictionary-namespace-param.form';

export class DictionaryAggregateParamForm extends DictionaryNamespaceParamForm {
  @IsString()
  @MaxLength(128)
  aggregateKey!: string;
}
