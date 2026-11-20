import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { ChatAttachmentToolService } from '../../../src/modules/chat/service/chat-attachment-tool.service';

vi.mock('../../utils/file-download.util', () => ({
  FileDownloadUtil: {
    downloadToFile: vi.fn(async () => {
      throw new Error('Network error');
    }),
  },
}));

vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);

describe('ChatAttachmentToolService', () => {
  let service: ChatAttachmentToolService;

  beforeEach(() => {
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
        'http://example.com/test.pdf',
        'http://example.com/test.png',
        'http://example.com/test.mp4',
        'http://example.com/test.mp3',
      ];

      for (const url of urls) {
        const result = await func({ fileUrl: url });
        const parsed = JSON.parse(result);
        expect(parsed.success).toBe(false);
        expect(parsed.error).toBe('附件读取失败');
      }
    });
  });
});
