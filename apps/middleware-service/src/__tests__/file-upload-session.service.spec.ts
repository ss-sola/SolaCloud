import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectException } from '@nest-cloud/sdk';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStorageService } from '../modules/file/service/file-storage.service';
import { MiddlewareConfigUtil } from '../utils/middleware-config.util';
import { FILE_UPLOAD_SESSION_STATUS } from '../modules/file/file.constants';
import { FileUploadSessionService } from '../modules/file/service/file-upload-session.service';

const now = new Date('2026-05-31T00:00:00.000Z');
const futureExpiresAt = new Date('2099-06-30T00:00:00.000Z');

function createSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    uploadId: 'upload-id',
    originalName: 'video.bin',
    mimeType: 'application/octet-stream',
    totalSize: 10,
    chunkSize: 4,
    chunkCount: 3,
    uploadedBytes: 0,
    uploadedChunkCount: 0,
    chunkDirPath: '2026/05/31/upload-id',
    fileFingerprint: 'frontend-session-1:source-hash',
    scene: 'attachment',
    businessType: 'document',
    isTemporary: true,
    status: FILE_UPLOAD_SESSION_STATUS.Pending,
    fileId: null,
    errorMessage: null,
    expiresAt: futureExpiresAt,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createService(
  overrides: {
    sessionRepository?: Record<string, unknown>;
    fileService?: Record<string, unknown>;
    storage?: Record<string, unknown>;
    redis?: Record<string, unknown>;
    zipExtract?: Record<string, unknown>;
    taskQueue?: Record<string, unknown>;
  } = {},
) {
  const sessionRepository = {
    create: vi.fn((input) => input),
    save: vi.fn(async (entity) => ({
      id: (entity as { id?: number }).id ?? 1,
      createdAt: (entity as { createdAt?: Date }).createdAt ?? now,
      updatedAt: now,
      ...entity,
    })),
    findOne: vi.fn(),
    update: vi.fn().mockResolvedValue({ affected: 1 }),
    find: vi.fn().mockResolvedValue([]),
    remove: vi.fn(),
    ...overrides.sessionRepository,
  } as any;
  sessionRepository.findOneByOrFail = vi.fn(async () => (await sessionRepository.find())[0]);
  const fileService = {
    create: vi.fn(async (data: Record<string, unknown>) => ({
      ...data,
      id: 99,
      createdAt: now,
      updatedAt: now,
    })),
    findOne: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ...overrides.fileService,
  } as any;
  const storage = {
    buildChunkDirPath: vi.fn((uploadId: string) => `2026/05/31/${uploadId}`),
    saveChunkBuffer: vi.fn(),
    hasChunk: vi.fn(),
    listUploadedChunks: vi.fn().mockResolvedValue([]),
    mergeChunks: vi.fn(),
    removeChunkDir: vi.fn(),
    removeStorage: vi.fn(),
    buildAccessUrls: vi.fn(() => ({
      url: '/public/uploads/2026/05/video.bin',
      previewUrl: '/public/uploads/2026/05/video.bin',
    })),
    ...overrides.storage,
  } as any;
  const redis = {
    getMeta: vi.fn().mockResolvedValue(undefined),
    saveSnapshot: vi.fn(),
    deleteUpload: vi.fn(),
    acquireMergeLock: vi.fn().mockResolvedValue('lease-token'),
    releaseMergeLock: vi.fn(),
    ...overrides.redis,
  } as any;
  const zipExtract = {
    extractZip: vi.fn(),
    findModelEntryFile: vi.fn(),
    ...overrides.zipExtract,
  } as any;

  const taskQueue = {
    addJob: vi.fn(),
    addRepeatableJob: vi.fn(),
    ...overrides.taskQueue,
  } as any;

  return {
    sessionRepository,
    fileService,
    storage,
    redis,
    zipExtract,
    taskQueue,
    service: new FileUploadSessionService(
      sessionRepository,
      fileService,
      storage,
      redis,
      zipExtract,
      taskQueue,
    ),
  };
}

describe('FileUploadSessionService', () => {
  beforeEach(() => {
    vi.spyOn(MiddlewareConfigUtil, 'getNumber').mockImplementation(
      (_key: string, defaultValue?: number) => defaultValue ?? 0,
    );
    vi.spyOn(MiddlewareConfigUtil, 'getString').mockImplementation(
      (_key: string, defaultValue?: string) => defaultValue ?? '',
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects invalid chunk count on check', async () => {
    const { service } = createService();

    await expect(
      service.checkUpload({
        fileId: 'frontend-session-1:source-hash',
        totalSize: 10,
        chunkSize: 4,
        chunkCount: 2,
        sourceHash: 'source-hash',
      } as any),
    ).rejects.toBeInstanceOf(ProjectException);
  });

  it('rejects mismatched fileId and sourceHash on check', async () => {
    const { service } = createService();

    await expect(
      service.checkUpload({
        fileId: 'frontend-session-1:other-hash',
        totalSize: 10,
        chunkSize: 4,
        chunkCount: 3,
        sourceHash: 'source-hash',
      } as any),
    ).rejects.toMatchObject({
      message: 'fileId 与 sourceHash 不匹配',
    });
  });

  it('creates a new session when active session is missing', async () => {
    const { service, sessionRepository, redis } = createService();

    const result = await service.checkUpload({
      fileId: 'frontend-session-1:source-hash',
      totalSize: 10,
      chunkSize: 4,
      chunkCount: 3,
      sourceHash: 'source-hash',
    } as any);

    expect(sessionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fileFingerprint: 'frontend-session-1:source-hash',
        originalName: null,
        mimeType: null,
        scene: null,
        businessType: null,
        isTemporary: true,
        uploadedBytes: 0,
        uploadedChunkCount: 0,
      }),
    );
    expect(redis.saveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          fileId: 'frontend-session-1:source-hash',
          uploadId: expect.any(String),
        }),
        uploadedChunkIndexes: [],
      }),
    );
    expect(result.fileId).toBe('frontend-session-1:source-hash');
    expect(result.uploadedChunkIndexes).toEqual([]);
  });

  it('reuses an unfinished session and returns uploaded chunk indexes', async () => {
    const session = createSession({
      uploadedBytes: 0,
      uploadedChunkCount: 0,
      status: FILE_UPLOAD_SESSION_STATUS.Pending,
    });
    const { service, sessionRepository } = createService({
      sessionRepository: {
        find: vi.fn().mockResolvedValue([session]),
      },
      storage: {
        listUploadedChunks: vi.fn().mockResolvedValue([
          { chunkIndex: 0, size: 4 },
          { chunkIndex: 1, size: 4 },
        ]),
      },
    });

    const result = await service.checkUpload({
      fileId: 'frontend-session-1:source-hash',
      totalSize: 10,
      chunkSize: 4,
      chunkCount: 3,
      sourceHash: 'source-hash',
    } as any);

    expect(sessionRepository.save).toHaveBeenCalledTimes(1);
    expect(result.uploadId).toBe('upload-id');
    expect(result.uploadedBytes).toBe(8);
    expect(result.uploadedChunkCount).toBe(2);
    expect(result.uploadedChunkIndexes).toEqual([0, 1]);
    expect(result.percent).toBe(80);
    expect(result.status).toBe(FILE_UPLOAD_SESSION_STATUS.Uploading);
  });

  it('repairs progress from the server chunk snapshot when uploading a duplicate chunk', async () => {
    const session = createSession({
      uploadedBytes: 0,
      uploadedChunkCount: 0,
      status: FILE_UPLOAD_SESSION_STATUS.Pending,
    });
    const { service, storage } = createService({
      sessionRepository: {
        find: vi.fn().mockResolvedValue([session]),
      },
      storage: {
        saveChunkBuffer: vi.fn().mockResolvedValue({ existed: true, size: 4 }),
        listUploadedChunks: vi.fn().mockResolvedValue([{ chunkIndex: 0, size: 4 }]),
      },
    });

    const result = await service.uploadChunk(
      {
        size: 4,
        buffer: Buffer.from('1234'),
        mimetype: 'application/octet-stream',
      } as any,
      {
        fileId: 'frontend-session-1:source-hash',
        chunkIndex: 0,
      } as any,
    );

    expect(storage.saveChunkBuffer).toHaveBeenCalledTimes(1);
    expect(result.uploadedBytes).toBe(4);
    expect(result.uploadedChunkCount).toBe(1);
    expect(result.uploadedChunkIndexes).toEqual([0]);
    expect(result.percent).toBe(40);
    expect(result.status).toBe(FILE_UPLOAD_SESSION_STATUS.Uploading);
  });

  it('rejects merge when file hash does not match', async () => {
    const session = createSession({
      uploadedBytes: 10,
      uploadedChunkCount: 3,
      status: FILE_UPLOAD_SESSION_STATUS.ReadyToMerge,
    });
    const { service, redis, storage } = createService({
      sessionRepository: {
        find: vi.fn().mockResolvedValue([session]),
      },
      storage: {
        listUploadedChunks: vi.fn().mockResolvedValue([
          { chunkIndex: 0, size: 4 },
          { chunkIndex: 1, size: 4 },
          { chunkIndex: 2, size: 2 },
        ]),
        hasChunk: vi.fn().mockResolvedValue(true),
        mergeChunks: vi.fn().mockResolvedValue({
          storageKey: '2026/05/video.bin',
          storagePath: '2026/05/video.bin',
          extension: '.bin',
        }),
      },
    });
    vi.spyOn(service as any, 'calculateStorageHash').mockResolvedValue('actual-hash');
    redis.releaseMergeLock.mockRejectedValueOnce(new Error('Redis unavailable'));

    await expect(
      service.mergeUpload({
        fileId: 'frontend-session-1:source-hash',
        fileHash: 'expected-hash',
        originalName: 'video.bin',
        mimeType: 'application/octet-stream',
        scene: 'attachment',
        businessType: 'document',
        isTemporary: true,
      } as any),
    ).rejects.toMatchObject({ message: '文件哈希校验失败' });

    expect(storage.removeStorage).toHaveBeenCalledWith({
      rootDir: expect.any(String),
      storagePath: '2026/05/video.bin',
    });
    expect(redis.saveSnapshot).toHaveBeenCalled();
    expect(redis.releaseMergeLock).toHaveBeenCalledWith(
      'frontend-session-1:source-hash',
      'lease-token',
    );
  });

  it('merges completed chunks into a final file record', async () => {
    const session = createSession({
      uploadedBytes: 0,
      uploadedChunkCount: 0,
      status: FILE_UPLOAD_SESSION_STATUS.Pending,
    });
    const { service, fileService, redis, storage } = createService({
      sessionRepository: {
        find: vi.fn().mockResolvedValue([session]),
      },
      storage: {
        listUploadedChunks: vi.fn().mockResolvedValue([
          { chunkIndex: 0, size: 4 },
          { chunkIndex: 1, size: 4 },
          { chunkIndex: 2, size: 2 },
        ]),
        hasChunk: vi.fn().mockResolvedValue(true),
        mergeChunks: vi.fn().mockResolvedValue({
          storageKey: '2026/05/video.bin',
          storagePath: '2026/05/video.bin',
          extension: '.bin',
        }),
      },
    });
    vi.spyOn(service as any, 'calculateStorageHash').mockResolvedValue('file-hash');

    const result = await service.mergeUpload({
      fileId: 'frontend-session-1:source-hash',
      fileHash: 'file-hash',
      originalName: 'merged-video.bin',
      mimeType: 'video/mp4',
      scene: 'attachment',
      businessType: 'document',
      isTemporary: false,
    } as any);

    expect(storage.mergeChunks).toHaveBeenCalledTimes(1);
    expect(storage.removeChunkDir).toHaveBeenCalledTimes(1);
    expect(redis.deleteUpload).toHaveBeenCalledWith(
      'frontend-session-1:source-hash',
      session.uploadId,
    );
    expect(fileService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        originalName: 'merged-video.bin',
        mimeType: 'video/mp4',
        scene: 'attachment',
        businessType: 'document',
        isTemporary: false,
        size: 10,
      }),
    );
    expect(result.status).toBe(FILE_UPLOAD_SESSION_STATUS.Completed);
    expect(result.file?.id).toBe(99);
    expect(result.file?.url).toContain('/public/uploads/');
  });

  it.each(['snapshot', 'chunks', 'unlock'] as const)(
    'keeps the completed file and replays the same result after a %s cleanup failure',
    async (failure) => {
      const dir = await mkdtemp(join(tmpdir(), 'solacloud-merge-'));
      try {
        const data = Buffer.from('attachment');
        const form = {
          fileId: 'frontend-session-1:source-hash',
          originalName: 'attachment.txt',
          fileHash: createHash('sha256').update(data).digest('hex'),
        };
        const chunks = join(dir, 'chunks');
        vi.mocked(MiddlewareConfigUtil.getString).mockImplementation((key, fallback) => {
          if (key === 'UploadRootDir') return dir;
          if (key === 'UploadChunkTempRootDir') return chunks;
          return fallback ?? '';
        });
        const storage = new FileStorageService();
        const { sessionRepository, fileService, redis, zipExtract, taskQueue } = createService();
        let saved = createSession({ chunkSize: data.length, chunkCount: 1 });
        sessionRepository.find.mockImplementation(async () => [saved]);
        sessionRepository.save.mockImplementation(
          async (row: typeof saved) => (saved = { ...row }),
        );
        taskQueue.addJob.mockResolvedValue({ id: 'description' });
        const service = new FileUploadSessionService(
          sessionRepository,
          fileService,
          storage,
          redis,
          zipExtract,
          taskQueue,
        );
        await storage.saveChunkBuffer({
          tempRootDir: chunks,
          chunkDirPath: saved.chunkDirPath,
          chunkIndex: 0,
          buffer: data,
        });
        const removeChunks = vi.spyOn(storage, 'removeChunkDir');
        const failed = {
          snapshot: redis.deleteUpload,
          chunks: removeChunks,
          unlock: redis.releaseMergeLock,
        };
        failed[failure].mockRejectedValueOnce(new Error('cleanup failed'));

        const first = await service.mergeUpload(form);
        expect(saved.status).toBe(FILE_UPLOAD_SESSION_STATUS.Completed);
        expect(first.file?.id).toBe(saved.fileId);
        expect(await readFile(join(dir, first.file!.storagePath))).toEqual(data);
        expect(redis.releaseMergeLock).toHaveBeenCalledTimes(1);
        expect(redis.deleteUpload).toHaveBeenCalledTimes(1);

        fileService.findOne.mockResolvedValue(await fileService.create.mock.results[0].value);
        redis.getMeta.mockRejectedValueOnce(new Error('Redis unavailable'));
        const replay = await service.mergeUpload(form);
        expect(replay.file).toEqual(first.file);
        expect(fileService.create).toHaveBeenCalledTimes(1);
        expect(taskQueue.addJob).toHaveBeenCalledTimes(1);
        expect(await readFile(join(dir, replay.file!.storagePath))).toEqual(data);
        expect(
          await storage.listUploadedChunks({
            tempRootDir: chunks,
            chunkDirPath: saved.chunkDirPath,
          }),
        ).toEqual([]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  it.each(['before lease', 'during scan'] as const)(
    'replays a competing merge completed %s',
    async (when) => {
      const session = createSession();
      const { service, sessionRepository, fileService, redis, storage } = createService();
      sessionRepository.find.mockResolvedValue([session]);
      const completed = {
        ...session,
        status: FILE_UPLOAD_SESSION_STATUS.Completed,
        fileId: 99,
      };
      sessionRepository.findOneByOrFail.mockResolvedValue(completed);
      if (when === 'during scan') {
        sessionRepository.findOneByOrFail.mockResolvedValueOnce(session);
        storage.listUploadedChunks.mockResolvedValue([
          { chunkIndex: 0, size: 4 },
          { chunkIndex: 1, size: 4 },
          { chunkIndex: 2, size: 2 },
        ]);
        sessionRepository.update.mockResolvedValue({ affected: 0 });
      }
      fileService.findOne.mockResolvedValue({
        id: 99,
        storagePath: 'video.bin',
        createdAt: now,
        updatedAt: now,
      });
      const result = await service.mergeUpload({
        fileId: session.fileFingerprint,
        originalName: 'video.bin',
        fileHash: 'hash',
      });
      expect(result.file?.id).toBe(99);
      expect(sessionRepository.save).not.toHaveBeenCalled();
      expect(storage.mergeChunks).not.toHaveBeenCalled();
      expect(redis.releaseMergeLock).toHaveBeenCalledWith(session.fileFingerprint, 'lease-token');
    },
  );
});
