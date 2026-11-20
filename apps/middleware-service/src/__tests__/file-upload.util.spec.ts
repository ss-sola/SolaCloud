import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileUploadUtil } from '../modules/file/utils/file-upload.util';

describe('FileUploadUtil', () => {
  it('builds full access url from relative base url', () => {
    const url = FileUploadUtil.toFullAccessUrl(
      '/public/uploads',
      '2026/05/31/a.txt',
      () => 'http://localhost:3000',
    );

    expect(url).toBe('http://localhost:3000/public/uploads/2026/05/31/a.txt');
  });

  it('keeps absolute public base url', () => {
    const url = FileUploadUtil.toFullAccessUrl(
      'https://cdn.example.com/uploads',
      '2026/05/31/a.txt',
      () => 'http://localhost:3000',
    );

    expect(url).toBe('https://cdn.example.com/uploads/2026/05/31/a.txt');
  });

  it('normalizes multipart boolean values', () => {
    expect(FileUploadUtil.normalizeOptionalBoolean('true')).toBe(true);
    expect(FileUploadUtil.normalizeOptionalBoolean('false')).toBe(false);
    expect(FileUploadUtil.normalizeOptionalBoolean(undefined)).toBeUndefined();
  });
});
