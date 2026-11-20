export interface BaseEntityRecord {
  id: number;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

export interface OverviewResponse {
  service: string;
  capabilities: string[];
}

export type QueryValue = string | number | boolean | null | undefined;

export interface PageQuery {
  [key: string]: QueryValue;
  pageNum?: number;
  pageSize?: number;
  sort?: string;
}

export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
