import { ProjectException, ValueUtil } from '@nest-cloud/sdk';
import { DictionaryImportItem } from './dictionary.types';

/** Stateless helpers shared by dictionary controller and service. */
export class DictionaryUtil {
  static assertRequired(field: string, value: string) {
    if (!value.trim()) {
      throw new ProjectException(`Dictionary ${field} is required`);
    }
  }

  static normalizeOptionalString(value?: string | null): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed || undefined;
  }

  static normalizeImportItems(items: DictionaryImportItem[]): DictionaryImportItem[] {
    const normalized = new Map<string, DictionaryImportItem>();
    for (const item of items) {
      const normalizedItem = DictionaryUtil.toImportItem(item);
      if (!normalizedItem?.aggregateKey || !normalizedItem.key) {
        continue;
      }
      normalized.set(`${normalizedItem.aggregateKey}:${normalizedItem.key}`, normalizedItem);
    }
    return [...normalized.values()];
  }

  static toImportItem(value: unknown): DictionaryImportItem | undefined {
    if (!ValueUtil.isObject(value)) {
      return undefined;
    }

    const aggregateKey = ValueUtil.toStringValue(value.aggregateKey)?.trim() ?? '';
    const key = ValueUtil.toStringValue(value.key)?.trim() ?? '';
    if (!aggregateKey || !key) {
      return undefined;
    }

    const isEnabled =
      value.isEnabled === undefined ? undefined : ValueUtil.toBoolean(value.isEnabled);

    return {
      aggregateKey,
      key,
      value: value.value,
      label:
        value.label === undefined
          ? undefined
          : DictionaryUtil.normalizeOptionalString(ValueUtil.toStringValue(value.label)),
      description:
        value.description === undefined
          ? undefined
          : DictionaryUtil.normalizeOptionalString(ValueUtil.toStringValue(value.description)),
      isEnabled,
    };
  }
}
