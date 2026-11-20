import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { AttachmentDescriptionService } from '@/modules/knowledge/service/attachment-description.service';
import { RagConfigService } from '@/modules/config/service/rag-config.service';
import { FileServiceClient } from '@/client/file-service.client';
import { KnowledgeService } from '@/modules/knowledge/service/knowledge.service';
import { SystemServiceClient } from '@/client/system-service.client';
import { ContextService, getRemoteCallMetadata, ResponseUtil } from '@nest-cloud/sdk';
import { MiddlewareServiceClient } from '@/client/middleware-service.client';
import { FileDownloadUtil } from '@/utils/file-download.util';
import type { Request, Response } from 'express';

// Mock ChatOpenAI 避免测试环境 LLM 网络不通导致超时
const mockInvoke = vi.fn().mockResolvedValue({ content: '测试描述结果' });
vi.mock('@langchain/openai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@langchain/openai')>();
  return {
    ...actual,
    ChatOpenAI: vi.fn().mockImplementation(function (this: any, options: any) {
      this._options = options;
      return { invoke: mockInvoke };
    }),
  };
});

describe('AttachmentDescriptionService (integration)', () => {
  let service: AttachmentDescriptionService;
  let tmpDir: string;
  let mockFileServiceClient: FileServiceClient;
  let mockKnowledgeService: KnowledgeService;
  let mockSystemClient: SystemServiceClient;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-integration-'));
    mockInvoke.mockReset();

    mockFileServiceClient = {
      getFileDetail: async () => ({ data: null }),
      getFileDetailBatch: async () => ({ data: [] }),
      updateFileDescription: async () => ({ data: true }),
    } as unknown as FileServiceClient;

    mockKnowledgeService = {
      deleteByFileId: async () => undefined,
    } as unknown as KnowledgeService;

    // 注入 system:multimodal 字典配置（含真实格式的 apiKey）
    mockSystemClient = {
      getDictionaryRuntimeItems: vi.fn().mockResolvedValue({
        data: [
          { key: 'model', value: 'gpt-4o' },
          { key: 'baseUrl', value: '' },
          { key: 'apiKey', value: 'sk-test-integration' },
        ],
      }),
    } as unknown as SystemServiceClient;

    const ragConfigService = new RagConfigService(mockSystemClient);

    service = new AttachmentDescriptionService(
      mockKnowledgeService,
      mockFileServiceClient,
      ragConfigService,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('enables retries only for the classified file calls', () => {
    expect(getRemoteCallMetadata(FileServiceClient.prototype, 'getFileDetailBatch').retry).toBe(
      'read',
    );
    for (const client of [FileServiceClient.prototype, MiddlewareServiceClient.prototype]) {
      expect(getRemoteCallMetadata(client, 'updateFileDescription').retry).toBe('idempotent-write');
    }
    expect(
      getRemoteCallMetadata(MiddlewareServiceClient.prototype, 'notifyAttachmentDeletion').retry,
    ).toBeUndefined();
  });

  it('keeps a stable file update key on job redelivery and propagates a conflicting write', async () => {
    // 跳过网络和落盘，完整执行描述生成及文件服务回写入口。
    vi.spyOn(FileDownloadUtil, 'downloadToFile').mockResolvedValue(undefined);
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('test'));
    vi.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);
    mockInvoke.mockResolvedValue({ content: '同一个附件的描述' });
    const observedKeys: Array<string | undefined> = [];
    const write = vi
      .spyOn(mockFileServiceClient, 'updateFileDescription')
      .mockImplementation(async () => {
        observedKeys.push(ContextService.takeOperationKey());
        return ResponseUtil.success(true);
      });
    const input = {
      fileId: 19,
      fileUrl: 'https://files.invalid/test',
      fileName: 'test.jpg',
      mimeType: 'image/jpeg',
    };
    const headers: Request['headers'] = { 'x-operation-id': 'queue-job-4' };
    const redeliver = () =>
      ContextService.setStore(
        {
          req: { headers } as Request,
          res: {} as Response,
        },
        () => service.generateDescription(input),
      );
    expect(await redeliver()).toBe('同一个附件的描述');
    mockInvoke.mockResolvedValueOnce({ content: '重新生成的描述' });
    const conflict = new Error('幂等键与首次请求不匹配');
    write.mockImplementationOnce(async () => {
      observedKeys.push(ContextService.takeOperationKey());
      throw conflict;
    });
    await expect(redeliver()).rejects.toBe(conflict);
    expect(await service.generateDescription(input)).toBe('同一个附件的描述');
    expect(observedKeys[0]).toBeTruthy();
    expect(observedKeys).toEqual([observedKeys[0], observedKeys[0], undefined]);
  });

  it('keeps the existing fallback when downloading fails, without writing a description', async () => {
    vi.spyOn(FileDownloadUtil, 'downloadToFile').mockRejectedValue(new Error('download failed'));
    vi.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);
    const write = vi.spyOn(mockFileServiceClient, 'updateFileDescription');
    expect(
      await service.generateDescription({
        fileId: 19,
        fileUrl: 'https://files.invalid/test',
        fileName: 'test.jpg',
        mimeType: 'image/jpeg',
      }),
    ).toBe('[test.jpg] 描述生成失败');
    expect(write).not.toHaveBeenCalled();
  });

  describe('describeFile', () => {
    it('should describe an image file using real config', async () => {
      const tmpFilePath = path.join(tmpDir, 'test-image.jpg');
      const jpegBytes = Buffer.from([
        0xff,
        0xd8, // SOI
        0xff,
        0xe0,
        0x00,
        0x10,
        0x4a,
        0x46,
        0x49,
        0x46,
        0x00,
        0x01,
        0x01,
        0x00,
        0x00,
        0x01,
        0x00,
        0x01,
        0x00,
        0x00, // APP0 header
        0xff,
        0xd9, // EOI
      ]);
      fs.writeFileSync(tmpFilePath, jpegBytes);

      const result = await service['describeFile'](tmpFilePath, 'image/jpeg', 'test-image.jpg');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      // 验证 LLM 被调用且使用了字典配置
      expect(mockInvoke).toHaveBeenCalled();
    });

    it('should summarize a text file using real config', async () => {
      const tmpFilePath = path.join(tmpDir, 'test-doc.txt');
      const content = '这是一段测试文本内容，用于验证文档摘要功能。';
      fs.writeFileSync(tmpFilePath, content);

      const result = await service['describeFile'](tmpFilePath, 'text/plain', 'test-doc.txt');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      expect(mockInvoke).toHaveBeenCalled();
    });
  });
});
