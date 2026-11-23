import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileUploadRedisService } from '../../modules/file/service/file-upload-redis.service';

describe('FileUploadRedisService', () => {
  let service: FileUploadRedisService;
  let mockRedis: {
    hgetall: ReturnType<typeof vi.fn>;
    hkeys: ReturnType<typeof vi.fn>;
    pipeline: ReturnType<typeof vi.fn>;
    eval: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  };
  const duplicate = vi.fn();

  const createMockRedis = () => ({
    hgetall: vi.fn(),
    hkeys: vi.fn(),
    pipeline: vi.fn(),
    eval: vi.fn(),
    set: vi.fn(),
  });

  beforeEach(() => {
    mockRedis = createMockRedis();
    duplicate.mockReset().mockReturnValue(mockRedis);
    const mockQueueService = {
      getConnection: vi.fn().mockReturnValue({ ...mockRedis, duplicate }),
    };
    service = new FileUploadRedisService(mockQueueService as never);
  });

  describe('getMeta', () => {
    it('bounds request-side Redis commands independently from the BullMQ connection', () => {
      expect(duplicate).toHaveBeenCalledWith({
        commandTimeout: 2_000,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
    });

    it('should return undefined when no meta exists', async () => {
      mockRedis.hgetall.mockResolvedValue({});
      const result = await service.getMeta('file-1');
      expect(result).toBeUndefined();
    });

    it('should deserialize meta fields correctly', async () => {
      mockRedis.hgetall.mockResolvedValue({
        uploadId: 'upload-123',
        chunkDirPath: '2026/01/01/upload-123',
        originalName: 'test.pdf',
        mimeType: 'application/pdf',
        totalSize: '1000',
        chunkSize: '256',
        chunkCount: '4',
        uploadedBytes: '512',
        uploadedChunkCount: '2',
        status: 'uploading',
        scene: 'document',
        businessType: 'report',
        isTemporary: 'true',
        errorMessage: '',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const result = await service.getMeta('file-1');
      expect(result).toEqual({
        fileId: 'file-1',
        uploadId: 'upload-123',
        chunkDirPath: '2026/01/01/upload-123',
        originalName: 'test.pdf',
        mimeType: 'application/pdf',
        totalSize: 1000,
        chunkSize: 256,
        chunkCount: 4,
        uploadedBytes: 512,
        uploadedChunkCount: 2,
        status: 'uploading',
        scene: 'document',
        businessType: 'report',
        isTemporary: true,
        errorMessage: undefined,
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    });
  });

  describe('getUploadedChunkIndexes', () => {
    it('should return sorted integer chunk indexes', async () => {
      mockRedis.hkeys.mockResolvedValue(['0', '2', '1', '5']);
      const result = await service.getUploadedChunkIndexes('file-1');
      expect(result).toEqual([0, 1, 2, 5]);
    });

    it('should filter out invalid entries', async () => {
      mockRedis.hkeys.mockResolvedValue(['0', 'abc', '-1', '3']);
      const result = await service.getUploadedChunkIndexes('file-1');
      expect(result).toEqual([0, 3]);
    });
  });

  describe('saveSnapshot', () => {
    it('should pipeline meta and chunks writes', async () => {
      const mockPipeline = {
        del: vi.fn().mockReturnThis(),
        hset: vi.fn().mockReturnThis(),
        pexpire: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([null]),
      };
      mockRedis.pipeline.mockReturnValue(mockPipeline);

      await service.saveSnapshot({
        meta: {
          fileId: 'file-1',
          uploadId: 'upload-123',
          chunkDirPath: '2026/01/01/upload-123',
          totalSize: 1000,
          chunkSize: 256,
          chunkCount: 4,
          uploadedBytes: 0,
          uploadedChunkCount: 0,
          status: 'uploading',
          isTemporary: true,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        uploadedChunkIndexes: [0, 1, 2],
        ttlMs: 3600000,
      });

      expect(mockPipeline.del).toHaveBeenCalledTimes(2);
      expect(mockPipeline.hset).toHaveBeenCalled();
      expect(mockPipeline.pexpire).toHaveBeenCalled();
      expect(mockPipeline.exec).toHaveBeenCalled();
    });
  });

  describe('deleteUpload', () => {
    it('cleans the snapshot only for its upload session', async () => {
      await service.deleteUpload('file-1', 'upload-1');
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        2,
        expect.stringContaining('file:upload:meta:file-1'),
        expect.stringContaining('file:upload:chunks:file-1'),
        'upload-1',
      );
    });
  });

  describe('acquireMergeLock', () => {
    it('returns the token used to acquire the lease', async () => {
      mockRedis.set.mockResolvedValue('OK');
      const result = await service.acquireMergeLock('file-1', 5000);
      expect(result).toEqual(expect.any(String));
      expect(mockRedis.set).toHaveBeenCalledWith(expect.any(String), result, 'PX', 5000, 'NX');
    });

    it('returns null when a lease already exists', async () => {
      mockRedis.set.mockResolvedValue(null);
      const result = await service.acquireMergeLock('file-1', 5000);
      expect(result).toBeNull();
    });
  });

  describe('releaseMergeLock', () => {
    it('releases only the acquired lease', async () => {
      await service.releaseMergeLock('file-1', 'lease-token');
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        expect.stringContaining('file:upload:lock:file-1'),
        'lease-token',
      );
    });
  });
});
