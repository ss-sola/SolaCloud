import { IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class TaskCreateForm {
  @IsString()
  name!: string;

  @IsObject()
  @IsOptional()
  data?: Record<string, unknown>;

  @IsInt()
  @Min(0)
  @IsOptional()
  delayMs?: number;
}
