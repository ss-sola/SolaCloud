import { ApiClient } from '../../../shared/api/apiClient';
import type { BaseEntityRecord, OverviewResponse, PageQuery, PageResult } from '../types/common';

export interface DictionaryNamespaceItem extends Partial<BaseEntityRecord> {
  namespace: string;
  label?: string;
  description?: string;
  isEnabled: boolean;
  count?: number;
}

export interface DictionaryNamespaceQuery extends PageQuery {
  keyword?: string;
  isEnabled?: string | boolean;
}

export interface DictionaryNamespaceSaveInput {
  label?: string;
  description?: string;
  isEnabled: boolean;
}

export interface DictionaryAggregateItem extends Partial<BaseEntityRecord> {
  namespace: string;
  aggregateKey: string;
  label?: string;
  description?: string;
  isEnabled: boolean;
  count?: number;
}

export interface DictionaryAggregateQuery extends PageQuery {
  namespace: string;
}

export interface DictionaryAggregateSaveInput {
  label?: string;
  description?: string;
  isEnabled: boolean;
}

export interface DictionaryItem extends Partial<BaseEntityRecord> {
  namespace: string;
  aggregateKey: string;
  key: string;
  value: unknown;
  label?: string;
  description?: string;
  isEnabled: boolean;
}

export type DictionaryItemQuery = Record<string, string | number | boolean | undefined | null> & {
  namespace: string;
  aggregateKey: string;
  keys?: string;
  sort?: string;
};

export interface DictionaryItemSaveInput {
  value: unknown;
  label?: string;
  description?: string;
  isEnabled: boolean;
}

export interface DictionaryImportItemInput {
  aggregateKey: string;
  key: string;
  value: unknown;
  label?: string;
  description?: string;
  isEnabled?: boolean;
}

export interface DictionaryImportInput {
  namespace: string;
  label?: string;
  description?: string;
  items: DictionaryImportItemInput[];
}

export interface DictionaryImportResult {
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  items: Array<Pick<DictionaryImportItemInput, 'aggregateKey' | 'key'>>;
}

export const DictionaryApi = {
  getOverview() {
    return ApiClient.get<OverviewResponse>('/api/system/dictionaries/overview');
  },
  listNamespaces(query: DictionaryNamespaceQuery) {
    return ApiClient.get<PageResult<DictionaryNamespaceItem>>(
      '/api/system/dictionaries/namespaces',
      query,
    );
  },
  getNamespace(namespace: string) {
    return ApiClient.get<DictionaryNamespaceItem>('/api/system/dictionaries/namespace', {
      namespace,
    });
  },
  updateNamespace(namespace: string, input: DictionaryNamespaceSaveInput) {
    return ApiClient.put<DictionaryNamespaceItem>('/api/system/dictionaries/namespace', input, {
      namespace,
    });
  },
  deleteNamespace(namespace: string) {
    return ApiClient.delete<void>('/api/system/dictionaries/namespace', { namespace });
  },
  listAggregates(query: DictionaryAggregateQuery) {
    return ApiClient.get<PageResult<DictionaryAggregateItem>>(
      '/api/system/dictionaries/aggregates',
      query,
    );
  },
  getAggregate(namespace: string, aggregateKey: string) {
    return ApiClient.get<DictionaryAggregateItem>('/api/system/dictionaries/aggregate', {
      namespace,
      aggregateKey,
    });
  },
  updateAggregate(namespace: string, aggregateKey: string, input: DictionaryAggregateSaveInput) {
    return ApiClient.put<DictionaryAggregateItem>('/api/system/dictionaries/aggregate', input, {
      namespace,
      aggregateKey,
    });
  },
  deleteAggregate(namespace: string, aggregateKey: string) {
    return ApiClient.delete<void>('/api/system/dictionaries/aggregate', {
      namespace,
      aggregateKey,
    });
  },
  listItems(query: DictionaryItemQuery) {
    return ApiClient.get<DictionaryItem[]>('/api/system/dictionaries/items', query);
  },
  listRuntimeItems(namespace: string, aggregateKey: string) {
    return ApiClient.get<DictionaryItem[]>('/api/system/dictionaries/runtime', {
      namespace,
      aggregateKey,
    });
  },
  getItem(namespace: string, aggregateKey: string, key: string) {
    return ApiClient.get<DictionaryItem>('/api/system/dictionaries/item', {
      namespace,
      aggregateKey,
      key,
    });
  },
  updateItem(namespace: string, aggregateKey: string, key: string, input: DictionaryItemSaveInput) {
    return ApiClient.put<DictionaryItem>('/api/system/dictionaries/item', input, {
      namespace,
      aggregateKey,
      key,
    });
  },
  deleteItem(namespace: string, aggregateKey: string, key: string) {
    return ApiClient.delete<void>('/api/system/dictionaries/item', {
      namespace,
      aggregateKey,
      key,
    });
  },
  importItems(input: DictionaryImportInput) {
    return ApiClient.post<DictionaryImportResult>('/api/system/dictionaries/import', input);
  },
};
