import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectException } from '@nest-cloud/sdk';
import { FileService } from '../modules/file/service/file.service';

const now = new Date('2026-05-31T00:00:00.000Z');

function createService(repositoryOverrides: Record<string, unknown> = {}) {
  const repository = {
    save: vi.fn(),
    create: vi.fn((input) => input),
    findAndCount: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn(),
    remove: vi.fn(),
    softDelete: vi.fn(),
    ...repositoryOverrides,
  } as any;
  const storage = {
    removeStorage: vi.fn(),
    buildAccessUrls: vi.fn(() => ({
      url: '/public/uploads/2026/05/avatar.png',
      previewUrl: '/public/uploads/2026/05/avatar.png',
    })),
  } as any;
  const ragServiceClient = {
    deleteByFile: vi.fn().mockResolvedValue({ data: true }),
  } as any;
  return {
    repository,
    storage,
    ragServiceClient,
    service: new FileService(repository, storage, ragServiceClient),
  };
}

describe('FileService', () => {
  it('filters list by business type', async () => {
    const { repository, service } = createService();
    repository.findAndCount.mockResolvedValue([
      [
        {
          id: 1,
          originalName: 'avatar.png',
          storageKey: '2026/05/avatar.png',
          storagePath: '2026/05/avatar.png',
          mimeType: 'image/png',
          size: 1024,
          extension: '.png',
          scene: 'account',
          businessType: 'account-avatar',
          isTemporary: false,
          status: 'available',
          createdAt: now,
          updatedAt: now,
        },
      ],
      1,
    ]);

    const result = await service.list({
      pageNum: 1,
      pageSize: 20,
      businessType: ' account-avatar ',
    } as any);

    expect(repository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessType: 'account-avatar' }),
      }),
    );
    expect(result.list[0].businessType).toBe('account-avatar');
  });

  it('removes stored file by id', async () => {
    const entity = {
      id: 1,
      originalName: 'avatar.png',
      storageKey: '2026/05/avatar.png',
      storagePath: '2026/05/avatar.png',
      mimeType: 'image/png',
      size: 1024,
      extension: '.png',
      scene: 'account',
      businessType: 'account-avatar',
      isTemporary: false,
      status: 'available',
      createdAt: now,
      updatedAt: now,
    };
    const { repository, storage, service } = createService({
      findOne: vi.fn().mockResolvedValue(entity),
    });

    const result = await service.remove({ id: 1 } as any);

    expect(storage.removeStorage).toHaveBeenCalledWith(
      expect.objectContaining({ storagePath: '2026/05/avatar.png' }),
    );
    expect(repository.softDelete).toHaveBeenCalledWith(1);
    expect(result.id).toBe(1);
  });

  it('throws when removing missing file', async () => {
    const { service } = createService({
      findOne: vi.fn().mockResolvedValue(null),
    });

    await expect(service.remove({ id: 99 } as any)).rejects.toBeInstanceOf(ProjectException);
  });
});
