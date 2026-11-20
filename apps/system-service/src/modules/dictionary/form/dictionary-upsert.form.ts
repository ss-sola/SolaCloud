import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class DictionaryUpsertForm {
  @IsOptional()
  value?: unknown;

  @IsString()
  @MaxLength(128)
  @IsOptional()
  label?: string;

  @IsString()
  @MaxLength(255)
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;
}
