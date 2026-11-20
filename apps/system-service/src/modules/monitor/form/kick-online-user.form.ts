import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { QueryTransformUtil } from '../../../utils/query-transform.util';

export class KickOnlineUserForm {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  @Transform(({ value }) => QueryTransformUtil.toOptionalString(value))
  sessionId!: string;
}
