import { MaxLength, IsString } from 'class-validator';
import { PageQueryForm } from '../../../utils/page-query.form';

export class DictionaryNamespaceParamForm extends PageQueryForm {
  @IsString()
  @MaxLength(64)
  namespace!: string;
}
