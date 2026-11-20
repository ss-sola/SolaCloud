import { FindOptionsOrder } from 'typeorm';

export type SortDirection = 'ASC' | 'DESC';

export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PageQueryInput {
  pageNum?: number;
  pageSize?: number;
  sort?: string;
}

export interface NormalizedPageQuery {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export interface PaginationOrderOptions<Entity> {
  allowedSortFields: readonly string[];
  defaultOrder: FindOptionsOrder<Entity>;
}
