import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class AccountIdParamForm {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id!: number;
}
