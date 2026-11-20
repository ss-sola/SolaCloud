import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { FileUploadUtil } from '../utils/file-upload.util';

export class FileUploadForm {
  @IsString()
  @MaxLength(80)
  @IsOptional()
  scene?: string;

  @IsString()
  @MaxLength(80)
  @IsOptional()
  businessType?: string;

  @Transform(({ value }: { value: string | boolean | undefined }) =>
    FileUploadUtil.normalizeOptionalBoolean(value),
  )
  @IsBoolean()
  @IsOptional()
  isTemporary?: boolean = true;
}
