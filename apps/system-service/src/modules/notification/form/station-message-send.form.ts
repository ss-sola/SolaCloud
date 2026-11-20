import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class StationMessageSendForm {
  @IsString()
  @MaxLength(128)
  title!: string;

  @IsString()
  content!: string;

  @IsBoolean()
  @IsOptional()
  isBroadcast?: boolean;

  @ValidateIf((form: StationMessageSendForm) => !form.isBroadcast)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  receiverAccountIds?: number[];
}
