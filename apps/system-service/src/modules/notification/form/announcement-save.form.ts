import { IsBoolean, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class AnnouncementSaveForm {
  @IsString()
  @MaxLength(128)
  title!: string;

  @IsString()
  content!: string;

  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;

  @IsISO8601()
  @IsOptional()
  effectiveFrom?: string;

  @IsISO8601()
  @IsOptional()
  effectiveTo?: string;
}
