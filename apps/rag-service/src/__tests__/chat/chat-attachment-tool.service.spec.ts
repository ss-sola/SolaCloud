import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { getConfig } from '@nest-cloud/sdk';
import { ChatAttachmentToolService } from '../../../src/modules/chat/service/chat-attachment-tool.service';
import { FileDownloadUtil } from '../../utils/file-download.util';

vi.mock('@nest-cloud/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nest-cloud/sdk')>()),
  getConfig: vi.fn(() => 'http://files.example.test/uploads'),
}));

vi.mock('../../utils/file-download.util', () => ({
  FileDownloadUtil: {
    downloadToFile: vi.fn(async () => {
      throw new Error('Network error');
    }),
  },
}));

describe('ChatAttachmentToolService', () => {
  let service: ChatAttachmentToolService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);
    service = new ChatAttachmentToolService(
      {} as any, // DocumentProcessorService
      {} as any, // MediaProcessorService
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Tool 创建', () => {
    it('应创建名为 file_reader 的 DynamicStructuredTool', () => {
      const tool = service.createTool();
      expect(tool).toBeInstanceOf(DynamicStructuredTool);
      expect(tool.name).toBe('file_reader');
      expect(tool.description).toContain('读取聊天附件文件内容');
    });

    it('Tool schema 应包含 fileUrl 字段', () => {
      const tool = service.createTool();
      expect(tool.schema).toBeDefined();
      const schema = tool.schema as Record<string, unknown>;
      expect(schema.type).toBe('object');
      const props = schema.properties as Record<string, unknown>;
      expect(props?.fileUrl).toBeDefined();
      expect(schema.required as string[]).toContain('fileUrl');
    });

    it('Tool func 应返回 JSON 字符串', async () => {
      const tool = service.createTool();
      const func = (tool as DynamicStructuredTool).func as (input: unknown) => Promise<string>;
      const result = await func({ fileUrl: 'http://localhost/nonexistent/file.pdf' });
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty('success');
    });
  });

  describe('文件类型推断', () => {
    it('应从 URL 后缀推断 MIME 类型', async () => {
      const tool = service.createTool();
      const func = (tool as DynamicStructuredTool).func as (input: unknown) => Promise<string>;

      const urls = [
        'http://files.example.test/uploads/test.pdf',
        'http://files.example.test/uploads/test.png',
        'http://files.example.test/uploads/test.mp4',
        'http://files.example.test/uploads/test.mp3',
      ];

      for (const url of urls) {
        const result = await func({ fileUrl: url });
        const parsed = JSON.parse(result);
        expect(parsed.success).toBe(false);
        expect(parsed.error).toBe('附件读取失败');
      }
    });

    it('只从配置的上传目录读取附件，配置缺失时关闭下载', async () => {
      const func = service.createTool().func as (input: unknown) => Promise<string>;
      for (const fileUrl of [
        'not a URL',
        'http://other.example.test/uploads/test.pdf',
        'http://files.example.test/other/test.pdf',
      ]) {
        expect(JSON.parse(await func({ fileUrl }))).toMatchObject({ success: false });
      }
      vi.mocked(getConfig).mockReturnValueOnce('');
      expect(
        JSON.parse(await func({ fileUrl: 'http://files.example.test/uploads/test.pdf' })),
      ).toMatchObject({ success: false });
      expect(FileDownloadUtil.downloadToFile).not.toHaveBeenCalled();
    });
  });
});
