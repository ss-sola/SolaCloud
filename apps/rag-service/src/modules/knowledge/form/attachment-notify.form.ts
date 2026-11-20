import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

/** 通知 RAG 服务生成附件描述 */
export class NotifyAttachmentDescribeForm {
  @IsNumber()
  @IsNotEmpty()
  fileId!: number;

  @IsString()
  @IsNotEmpty()
  fileUrl!: string;

  @IsString()
  @IsNotEmpty()
  mimeType!: string;

  @IsString()
  @IsNotEmpty()
  fileName!: string;
}

/** 通知 RAG 服务删除附件向量化数据 */
export class NotifyAttachmentDeletionForm {
  @IsNumber()
  @IsNotEmpty()
  fileId!: number;
}
