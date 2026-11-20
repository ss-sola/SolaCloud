import { describe, it, expect, vi } from 'vitest';
import { DatabaseIdempotencyService, ProjectException } from '@nest-cloud/sdk';
import { ValidationPipe } from '@nestjs/common';
import { FileController } from '../modules/file/controller/file.controller';
import { FileDescriptionForm } from '../modules/file/form/file-description.form';
import { FILE_DESCRIPTION_UPDATE_OPERATION } from '../constants/file-operation.constants';

function createController() {
  const fileService = {
    list: vi.fn(),
    getDetail: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  } as any;
  const fileUploadSessionService = {
    checkUpload: vi.fn(),
    uploadChunk: vi.fn(),
    mergeUpload: vi.fn(),
  } as any;
  const fileZipExtractService = {} as any;
  const idempotencyService = { executeHttp: vi.fn() };

  return {
    fileService,
    fileUploadSessionService,
    fileZipExtractService,
    idempotencyService,
    controller: new FileController(
      fileService,
      fileUploadSessionService,
      fileZipExtractService,
      idempotencyService as unknown as DatabaseIdempotencyService,
    ),
  };
}

describe('FileController', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const bodyMetadata = { type: 'body' as const, metatype: FileDescriptionForm };

  it('replays a completed description update without invoking the file service', async () => {
    const { controller, idempotencyService, fileService } = createController();
    const body = { id: 2, description: 'first' };
    const replay = { code: 200, data: true, message: 'ok' };
    idempotencyService.executeHttp.mockResolvedValue(replay);
    expect(await controller.updateDescription(body)).toEqual(replay);
    expect(idempotencyService.executeHttp).toHaveBeenCalledWith(
      { operation: FILE_DESCRIPTION_UPDATE_OPERATION, payload: body, allowPublic: true },
      expect.any(Function),
    );
    expect(fileService.update).not.toHaveBeenCalled();
  });

  it('allows clearing a description and runs the write inside the claimed operation', async () => {
    const { controller, idempotencyService, fileService } = createController();
    idempotencyService.executeHttp.mockImplementation((_options, action) => action());
    const body = await pipe.transform({ id: 2, description: '', extra: true }, bodyMetadata);
    expect(body).toEqual({ id: 2, description: '' });
    expect((await controller.updateDescription(body)).data).toBe(true);
    expect(fileService.update).toHaveBeenCalledExactlyOnceWith(2, { description: '' });
  });

  it.each([{ id: 0, description: 'new' }, { id: 1 }, { id: 1, description: false }])(
    'rejects an invalid description update before dispatch',
    async (body) => {
      await expect(pipe.transform(body, bodyMetadata)).rejects.toThrow('Bad Request');
    },
  );

  const file = {
    originalname: 'avatar.png',
    mimetype: 'image/png',
    size: 128,
    buffer: Buffer.from('avatar'),
  } as Express.Multer.File;

  it('normalizes upload check fields', async () => {
    const { controller, fileUploadSessionService } = createController();
    fileUploadSessionService.checkUpload.mockResolvedValue({
      fileId: 'session-1:hash',
    });

    await controller.checkUpload({
      fileId: ' frontend-session-1:ABC123 ',
      totalSize: 128,
      chunkSize: 64,
      chunkCount: 2,
      sourceHash: ' ABC123 ',
    } as any);

    expect(fileUploadSessionService.checkUpload).toHaveBeenCalledWith({
      fileId: 'frontend-session-1:ABC123',
      totalSize: 128,
      chunkSize: 64,
      chunkCount: 2,
      sourceHash: 'abc123',
    });
  });

  it('routes upload requests to chunk upload', async () => {
    const { controller, fileUploadSessionService } = createController();
    fileUploadSessionService.uploadChunk.mockResolvedValue({
      fileId: 'session-1:hash',
    });

    await controller.upload(file, {
      fileId: ' session-1:hash ',
      chunkIndex: 0,
      chunkHash: ' chunk-hash ',
    } as any);

    expect(fileUploadSessionService.uploadChunk).toHaveBeenCalledWith(file, {
      fileId: 'session-1:hash',
      chunkIndex: 0,
      chunkHash: 'chunk-hash',
    });
  });

  it('rejects empty upload file', async () => {
    const { controller } = createController();

    await expect(
      controller.upload(
        undefined as any,
        {
          fileId: 'session-1:hash',
          chunkIndex: 0,
        } as any,
      ),
    ).rejects.toBeInstanceOf(ProjectException);
  });

  it('normalizes merge request fields', async () => {
    const { controller, fileUploadSessionService } = createController();
    fileUploadSessionService.mergeUpload.mockResolvedValue({
      fileId: 'session-1:hash',
    });

    await controller.mergeUpload({
      fileId: ' session-1:hash ',
      fileHash: ' ABC123DEF ',
      originalName: ' avatar.png ',
      mimeType: ' image/png ',
      scene: ' account ',
      businessType: ' account-avatar ',
      isTemporary: 'false' as any,
    } as any);

    expect(fileUploadSessionService.mergeUpload).toHaveBeenCalledWith({
      fileId: 'session-1:hash',
      fileHash: 'abc123def',
      originalName: 'avatar.png',
      mimeType: 'image/png',
      scene: 'account',
      businessType: 'account-avatar',
      isTemporary: false,
    });
  });
});
