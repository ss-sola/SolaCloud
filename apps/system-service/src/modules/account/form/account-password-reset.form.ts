import { IsString, MaxLength, MinLength } from 'class-validator';

export class AccountPasswordResetForm {
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  password!: string;
}
