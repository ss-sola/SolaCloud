import { IsString, MaxLength, MinLength } from 'class-validator';

export class AccountLoginForm {
  @IsString()
  @MaxLength(64)
  accountName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  password!: string;
}
