import { PageCommon } from '@nest-cloud/sdk';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { FileStatus } from '../file.constants';
import { FileUploadUtil } from '../utils/file-upload.util';

export class FileListForm extends PageCommon {
  @IsString()
  @MaxLength(80)
  @IsOptional()
  scene?: string;

  @IsString()
  @MaxLength(80)
  @IsOptional()
  businessType?: string;

  @IsString()
  @IsOptional()
  status?: FileStatus;

  @Transform(({ value }: { value: string | boolean | undefined }) =>
    FileUploadUtil.normalizeOptionalBoolean(value),
  )
  @IsBoolean()
  @IsOptional()
  isTemporary?: boolean;
}
