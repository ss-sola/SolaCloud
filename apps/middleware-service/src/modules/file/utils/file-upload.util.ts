import { extname, resolve, sep } from 'path';

export class FileUploadUtil {
  static normalizeOptionalString(value?: string): string | undefined {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
  }

  static normalizeOptionalBoolean(value?: boolean | string): boolean | undefined {
    if (typeof value === 'boolean') {
      return value;
    }
    const normalized = value?.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
    return undefined;
  }

  static buildChunkFileName(chunkIndex: number): string {
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      throw new Error('Invalid chunk index');
    }
    return `${chunkIndex}.part`;
  }

  static parseChunkFileName(fileName: string): number | undefined {
    const match = /^(\d+)\.part$/.exec(fileName);
    if (!match) {
      return undefined;
    }
    const chunkIndex = Number(match[1]);
    return Number.isInteger(chunkIndex) && chunkIndex >= 0 ? chunkIndex : undefined;
  }

  static calculateUploadPercent(uploadedBytes: number, totalSize: number): number {
    if (totalSize <= 0) {
      return 0;
    }
    return Number(Math.min(100, (uploadedBytes / totalSize) * 100).toFixed(2));
  }

  static resolveSafePath(rootDir: string, storageKey: string): string {
    const rootPath = resolve(rootDir);
    const fullPath = resolve(rootPath, storageKey);
    if (!this.isInside(fullPath, rootPath)) {
      throw new Error('Invalid upload path');
    }
    return fullPath;
  }

  static isInside(targetPath: string, rootPath: string): boolean {
    const normalizedRoot = resolve(rootPath);
    const normalizedTarget = resolve(targetPath);
    return (
      normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${sep}`)
    );
  }

  static getSafeExtension(originalName: string): string | undefined {
    const extension = extname(originalName).toLowerCase();
    if (!extension || !/^\.[a-z0-9]{1,16}$/.test(extension)) {
      return undefined;
    }
    return extension;
  }

  static toFullAccessUrl(
    baseUrl: string,
    storagePath: string,
    originProvider?: () => string | undefined,
  ): string {
    const normalizedPath = storagePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const normalizedBase = baseUrl.replace(/\/+$/g, '');
    if (/^https?:\/\//i.test(normalizedBase)) {
      return `${normalizedBase}/${normalizedPath}`;
    }

    const origin = originProvider?.()?.replace(/\/+$/g, '');
    if (origin) {
      return `${origin}/${normalizedBase.replace(/^\/+/, '')}/${normalizedPath}`;
    }

    return `${normalizedBase}/${normalizedPath}`;
  }
}
