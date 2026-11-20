import { Type } from 'class-transformer';
import { IsString } from 'class-validator';
import { FileQueryForm } from './file-query.form';

export class FileDescriptionForm extends FileQueryForm {
  // 保留 JSON 原始类型，避免全局隐式转换将数字或布尔值写成文件描述。
  @Type(() => Object)
  @IsString()
  description!: string;
}
