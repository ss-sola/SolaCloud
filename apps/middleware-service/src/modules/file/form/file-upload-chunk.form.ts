import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class FileUploadChunkForm {
  @IsString()
  @MaxLength(255)
  fileId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  chunkIndex!: number;

  @IsString()
  @MaxLength(160)
  @IsOptional()
  chunkHash?: string;
}
