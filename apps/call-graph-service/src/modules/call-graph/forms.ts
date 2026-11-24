import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class ProjectForm {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  project!: string;
}
export class RouteForm extends ProjectForm {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  routeId!: string;
}
export class StartForm extends ProjectForm {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  routeId?: string;
}
export class SessionForm {
  @IsUUID()
  sessionId!: string;
}
export class EventQuery extends SessionForm {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  after = 0;
}
