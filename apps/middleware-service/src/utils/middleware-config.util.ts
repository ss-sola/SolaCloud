import { getConfig } from '@nest-cloud/sdk';

export class MiddlewareConfigUtil {
  static getString(key: string, defaultValue: string) {
    return getConfig<string>(key, defaultValue, false);
  }

  static getOptionalString(key: string) {
    const value = this.getString(key, '').trim();
    return value || undefined;
  }

  static getNumber(key: string, defaultValue: number) {
    const value = getConfig<string | number>(key, defaultValue, false);
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }

  static getBoolean(key: string, defaultValue: boolean) {
    const value = getConfig<string | boolean>(key, defaultValue, false);
    if (typeof value === 'boolean') return value;
    return value.toLowerCase() === 'true';
  }
}
