import { IsOptional, IsString, MaxLength } from 'class-validator';
import { FileUploadForm } from './file-upload.form';

export class FileUploadMergeForm extends FileUploadForm {
  @IsString()
  @MaxLength(255)
  fileId!: string;

  @IsString()
  @MaxLength(160)
  fileHash!: string;

  @IsString()
  @MaxLength(255)
  originalName!: string;

  @IsString()
  @MaxLength(120)
  @IsOptional()
  mimeType?: string;
}
