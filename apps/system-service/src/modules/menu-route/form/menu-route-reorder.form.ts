import { Type } from 'class-transformer';
import { ArrayMinSize, ValidateNested } from 'class-validator';
import { IsArray, IsInt, Min } from 'class-validator';

export class MenuRouteReorderItemForm {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sort!: number;
}

export class MenuRouteReorderForm {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MenuRouteReorderItemForm)
  items!: MenuRouteReorderItemForm[];
}
