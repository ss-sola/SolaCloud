import { IsString, MaxLength } from 'class-validator';

export class RoleRuntimeQueryForm {
  @IsString()
  @MaxLength(64)
  roleCode!: string;
}
