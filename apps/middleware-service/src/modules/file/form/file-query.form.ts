import { IsInt, Min } from 'class-validator';

export class FileQueryForm {
  @IsInt()
  @Min(1)
  id!: number;
}
