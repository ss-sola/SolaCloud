import { FindOptionsOrder } from 'typeorm';
import {
  NormalizedPageQuery,
  PageQueryInput,
  PageResult,
  PaginationOrderOptions,
  SortDirection,
} from './pagination.types';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

export class PaginationUtil {
  static normalizePageQuery(query: PageQueryInput): NormalizedPageQuery {
    const page = PaginationUtil.normalizePositiveInteger(query.pageNum, DEFAULT_PAGE);
    const rawPageSize = PaginationUtil.normalizePositiveInteger(query.pageSize, DEFAULT_PAGE_SIZE);
    const pageSize = Math.min(rawPageSize, MAX_PAGE_SIZE);

    return {
      page,
      pageSize,
      skip: (page - 1) * pageSize,
      take: pageSize,
    };
  }

  static buildOrder<Entity>(
    query: PageQueryInput,
    options: PaginationOrderOptions<Entity>,
  ): FindOptionsOrder<Entity> {
    const parsed = PaginationUtil.parseSort(query.sort);
    if (!parsed || !options.allowedSortFields.includes(parsed.field)) {
      return options.defaultOrder;
    }

    return {
      [parsed.field]: parsed.direction,
    } as FindOptionsOrder<Entity>;
  }

  static buildPageResult<T>(items: T[], total: number, query: NormalizedPageQuery): PageResult<T> {
    return {
      list: items,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  static paginateArray<T>(items: T[], query: NormalizedPageQuery): T[] {
    return items.slice(query.skip, query.skip + query.take);
  }

  private static parseSort(sort?: string): { field: string; direction: SortDirection } | undefined {
    if (!sort) {
      return undefined;
    }

    const [rawField, rawDirection] = sort.split(':');
    const field = rawField?.trim();
    if (!field) {
      return undefined;
    }

    const direction = rawDirection?.trim().toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    return { field, direction };
  }

  private static normalizePositiveInteger(value: number | undefined, fallback: number): number {
    if (value === undefined || !Number.isInteger(value) || value < 1) {
      return fallback;
    }

    return value;
  }
}
