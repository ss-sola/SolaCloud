import { ArrayUnique, IsArray, IsString, MaxLength } from 'class-validator';

export class AccountRoleSaveForm {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  roleCodes!: string[];
}
