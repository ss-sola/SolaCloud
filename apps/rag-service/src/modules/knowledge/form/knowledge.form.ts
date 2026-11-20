import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class AttachmentItemForm {
  @IsInt()
  @IsOptional()
  fileId?: number;

  @ValidateIf((value) => !value.fileId)
  @IsString()
  fileName?: string;

  @ValidateIf((value) => !value.fileId)
  @IsString()
  mimeType?: string;

  @ValidateIf((value) => !value.fileId)
  @IsString()
  filePath?: string;

  @IsString()
  @IsOptional()
  fileUrl?: string;
}

export class IngestAttachmentsForm {
  @IsInt()
  @Min(1)
  knowledgeBaseId!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentItemForm)
  attachments!: AttachmentItemForm[];
}

export class CreateKnowledgeBaseForm {
  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;
}
