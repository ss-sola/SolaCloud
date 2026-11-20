import { Type } from 'class-transformer';
import { IsInt, IsString, MaxLength, Min } from 'class-validator';

export class FileUploadCheckForm {
  @IsString()
  @MaxLength(255)
  fileId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalSize!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  chunkSize!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  chunkCount!: number;

  @IsString()
  @MaxLength(160)
  sourceHash!: string;
}
