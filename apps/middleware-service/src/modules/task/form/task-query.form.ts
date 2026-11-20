import { IsOptional, IsString } from 'class-validator';

export class TaskQueryForm {
  @IsString()
  id!: string;

  @IsString()
  @IsOptional()
  name?: string;
}
