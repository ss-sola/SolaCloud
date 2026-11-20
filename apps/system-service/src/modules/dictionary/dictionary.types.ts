export interface DictionaryRecord {
  id: number;
  namespace: string;
  aggregateKey: string;
  key: string;
  value: unknown;
  label?: string;
  description?: string;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DictionaryImportItem {
  aggregateKey: string;
  key: string;
  value: unknown;
  label?: string;
  description?: string;
  isEnabled?: boolean;
}

export interface DictionaryImportResult {
  namespace: string;
  importedCount: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  items: DictionaryRecord[];
}

export interface DictionaryItemKey {
  namespace: string;
  aggregateKey: string;
  key: string;
}

export interface DictionaryItemQuery extends DictionaryItemKey {
  enabledOnly?: boolean;
}

export interface DictionaryItemsLookup {
  namespace: string;
  aggregateKey: string;
  keys?: string[];
  enabledOnly?: boolean;
}

export interface DictionaryAggregateRecord {
  id: number;
  namespace: string;
  aggregateKey: string;
  label?: string;
  description?: string;
  isEnabled: boolean;
  count: number;
  createdAt: string;
  updatedAt: string;
}

export interface DictionaryNamespaceRecord {
  id: number;
  namespace: string;
  label?: string;
  description?: string;
  isEnabled: boolean;
  count: number;
  updatedAt: string;
  createdAt: string;
}

export type DictionaryDefaultItem = Omit<DictionaryImportItem, 'aggregateKey'>;

export interface DictionaryDefaultAggregate {
  label?: string;
  description?: string;
  items: DictionaryDefaultItem[];
}

export interface DictionaryDefaultNamespace {
  label?: string;
  description?: string;
  aggregates: Record<string, DictionaryDefaultAggregate>;
}
