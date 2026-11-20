import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class MenuRouteQueryForm {
  @IsString()
  @MaxLength(64)
  @IsOptional()
  @Transform(({ value }) => MenuRouteQueryForm.toOptionalString(value))
  keyword?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Transform(({ value }) => MenuRouteQueryForm.toOptionalNumber(value))
  parentId?: number;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => MenuRouteQueryForm.toOptionalBoolean(value))
  isEnabled?: boolean;

  private static toOptionalString(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed || undefined;
    }

    return undefined;
  }

  private static toOptionalNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private static toOptionalBoolean(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }

    if (normalized === 'true' || normalized === '1') {
      return true;
    }

    if (normalized === 'false' || normalized === '0') {
      return false;
    }

    return undefined;
  }
}
