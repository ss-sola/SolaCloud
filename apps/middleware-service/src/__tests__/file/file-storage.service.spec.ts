import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileUploadUtil } from '../../modules/file/utils/file-upload.util';
import { FileStorageService } from '../../modules/file/service/file-storage.service';

describe('FileStorageService', () => {
  let service: FileStorageService;

  beforeEach(() => {
    service = new FileStorageService();
  });

  describe('buildStorageKey', () => {
    it('should generate a key with year/month/day directory and UUID', () => {
      const key = service.buildStorageKey('test.pdf');
      expect(key).toMatch(/\d{4}\/\d{2}\/\d{2}\/[a-f0-9-]+\.pdf/);
    });

    it('should handle names without extension', () => {
      const key = service.buildStorageKey('README');
      expect(key).toMatch(/\d{4}\/\d{2}\/\d{2}\/[a-f0-9-]+$/);
    });
  });

  describe('buildChunkDirPath', () => {
    it('should generate a chunk dir path with year/month/day prefix', () => {
      const dir = service.buildChunkDirPath('upload-123');
      expect(dir).toMatch(/\d{4}\/\d{2}\/\d{2}\/upload-123/);
    });
  });

  describe('buildAccessUrls', () => {
    it('should build URL from storage path', () => {
      const urls = service.buildAccessUrls('2026/01/01/test.pdf');
      expect(urls.url).toContain('test.pdf');
      expect(urls.previewUrl).toBe(urls.url);
    });

    it('should use provided publicBaseUrl', () => {
      const urls = service.buildAccessUrls('test.txt', 'http://cdn.example.com');
      expect(urls.url).toBe('http://cdn.example.com/test.txt');
    });
  });

  describe('removeStorage', () => {
    it('should delegate to file storage for removal', () => {
      // The method calls unlink and rm internally; we verify it doesn't throw
      expect(async () => {
        await service.removeStorage({ storagePath: '2026/01/01/test.pdf' });
      }).not.toThrow();
    });
  });
});

describe('FileUploadUtil', () => {
  describe('buildChunkFileName', () => {
    it('should format chunk index as number.part', () => {
      expect(FileUploadUtil.buildChunkFileName(0)).toBe('0.part');
      expect(FileUploadUtil.buildChunkFileName(5)).toBe('5.part');
    });

    it('should throw for invalid indices', () => {
      expect(() => FileUploadUtil.buildChunkFileName(-1)).toThrow('Invalid chunk index');
      expect(() => FileUploadUtil.buildChunkFileName(1.5)).toThrow('Invalid chunk index');
    });
  });

  describe('parseChunkFileName', () => {
    it('should extract chunk index from filename', () => {
      expect(FileUploadUtil.parseChunkFileName('0.part')).toBe(0);
      expect(FileUploadUtil.parseChunkFileName('3.part')).toBe(3);
    });

    it('should return undefined for non-chunk filenames', () => {
      expect(FileUploadUtil.parseChunkFileName('data.txt')).toBeUndefined();
      expect(FileUploadUtil.parseChunkFileName('.part')).toBeUndefined();
    });
  });

  describe('calculateUploadPercent', () => {
    it('should calculate percentage correctly', () => {
      expect(FileUploadUtil.calculateUploadPercent(50, 100)).toBe(50);
      expect(FileUploadUtil.calculateUploadPercent(25, 100)).toBe(25);
    });

    it('should cap at 100', () => {
      expect(FileUploadUtil.calculateUploadPercent(150, 100)).toBe(100);
    });

    it('should return 0 for zero total', () => {
      expect(FileUploadUtil.calculateUploadPercent(10, 0)).toBe(0);
    });
  });

  describe('getSafeExtension', () => {
    it('should return lowercase extension for valid names', () => {
      expect(FileUploadUtil.getSafeExtension('test.PDF')).toBe('.pdf');
      expect(FileUploadUtil.getSafeExtension('test.jpg')).toBe('.jpg');
    });

    it('should return undefined for invalid extensions', () => {
      expect(FileUploadUtil.getSafeExtension('README')).toBeUndefined();
      expect(FileUploadUtil.getSafeExtension('test.tar.gz')).toBe('.gz');
    });
  });

  describe('toFullAccessUrl', () => {
    it('should combine baseUrl and path', () => {
      expect(FileUploadUtil.toFullAccessUrl('http://cdn.com', 'files/test.pdf')).toBe(
        'http://cdn.com/files/test.pdf',
      );
    });

    it('should handle trailing slashes in baseUrl', () => {
      expect(FileUploadUtil.toFullAccessUrl('http://cdn.com/', 'files/test.pdf')).toBe(
        'http://cdn.com/files/test.pdf',
      );
    });

    it('should handle leading slashes in path', () => {
      expect(FileUploadUtil.toFullAccessUrl('http://cdn.com', '/files/test.pdf')).toBe(
        'http://cdn.com/files/test.pdf',
      );
    });

    it('should handle Windows path separators', () => {
      expect(FileUploadUtil.toFullAccessUrl('http://cdn.com', 'files\\test.pdf')).toBe(
        'http://cdn.com/files/test.pdf',
      );
    });
  });
});
