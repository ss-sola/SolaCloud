import { Injectable, Logger } from '@nestjs/common';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { getConfig } from '@nest-cloud/sdk';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileDownloadUtil } from '../../../utils/file-download.util';
import { DocumentProcessorService } from '../../knowledge/service/document-processor.service';
import { MediaProcessorService } from '../../knowledge/service/media-processor.service';
import { MIME_TO_FILE_TYPE, FILE_TYPE_CATEGORY } from '../../../constants/rag.constants';
import { RagConfigKeys } from '../../../config-keys';

/** 单次文件读取最大字符数 */
const MAX_FILE_CONTENT_CHARS = 8000;

/**
 * 聊天附件读取 Tool 服务。
 *
 * 职责：
 * - 创建 LangChain DynamicStructuredTool（file_reader）
 * - 通过 fileUrl 下载并解析文件
 * - 根据 MIME 类型调用 DocumentProcessorService / MediaProcessorService 解析
 * - 返回结构化 JSON 结果供 Deep Agent 使用
 *
 * 与 ChatRagToolService 设计一致：异常不向上抛，作为 Tool 结果返回。
 */
@Injectable()
export class ChatAttachmentToolService {
  private readonly logger = new Logger(ChatAttachmentToolService.name);

  constructor(
    private readonly documentProcessor: DocumentProcessorService,
    private readonly mediaProcessor: MediaProcessorService,
  ) {}

  /**
   * 创建 file_reader Tool。
   * @returns DynamicStructuredTool 实例
   */
  createTool(): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: 'file_reader',
      description:
        '读取聊天附件文件内容。通过文件 URL 下载并解析文件，返回结构化文本内容。' +
        '支持 PDF、Word、PPT、Excel、TXT、Markdown 等文档格式，以及图片、音频、视频。' +
        '如果文件较大，内容会被截断。',
      schema: {
        type: 'object',
        properties: {
          fileUrl: {
            type: 'string',
            description: '文件 URL 地址',
          },
        },
        required: ['fileUrl'],
      },
      func: async (input: { fileUrl: string }) => this.readAttachment(input.fileUrl),
    });
  }

  /**
   * 读取指定 URL 的文件。
   */
  private async readAttachment(fileUrl: string): Promise<string> {
    const trusted = this.trustedAttachmentUrl(fileUrl);
    if (!trusted) return JSON.stringify({ success: false, error: '附件地址未获准' });
    fileUrl = trusted.href;
    const fileName = this.extractFileName(fileUrl);
    const mimeType = this.inferMimeType(fileUrl);
    const category = MIME_TO_FILE_TYPE[mimeType];

    if (!category) {
      return JSON.stringify({
        success: false,
        error: '不支持的文件类型',
        message: `MIME 类型 ${mimeType} 暂不支持解析`,
      });
    }

    const tmpDir = path.join(os.tmpdir(), `rag-attachment-${crypto.randomUUID()}`);
    const ext = path.extname(fileName) || '.' + mimeType.split('/')[1];
    const tmpPath = path.join(tmpDir, `${Date.now()}${ext}`);

    try {
      await FileDownloadUtil.downloadToFile(fileUrl, tmpPath);

      switch (category) {
        case FILE_TYPE_CATEGORY.Document:
          return this.readDocument(fileUrl, tmpPath, fileName, mimeType);

        case FILE_TYPE_CATEGORY.Image:
          return this.readImage(fileUrl, tmpPath, fileName);

        default:
          return JSON.stringify({
            success: false,
            error: '不支持的文件类型',
            message: `MIME 类型 ${mimeType} 暂不支持解析`,
          });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`附件读取失败 url=${fileUrl}: ${message}`);
      return JSON.stringify({
        success: false,
        error: '附件读取失败',
        message,
      });
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private trustedAttachmentUrl(value: string): URL | undefined {
    const base = URL.parse(getConfig<string>(RagConfigKeys.UploadPublicBaseUrl, '', false));
    const url = URL.parse(value);
    if (
      !base ||
      !url ||
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      url.origin !== base.origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return undefined;

    const prefix = base.pathname.replace(/\/+$/, '') + '/';
    const relativePath = url.pathname.slice(prefix.length);
    // Uploaded object keys use plain date segments and safe storage filenames.
    if (!url.pathname.startsWith(prefix) || !/^[\w.-]+(?:\/[\w.-]+)*$/.test(relativePath)) {
      return undefined;
    }
    return url;
  }

  /** 从 URL 提取文件名 */
  private extractFileName(url: string): string {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const name = path.basename(pathname);
    return name || 'unknown';
  }

  /** 从 URL 推断 MIME 类型 */
  private inferMimeType(url: string): string {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    const extToMime: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.csv': 'text/csv',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
    };
    return extToMime[ext] || 'application/octet-stream';
  }

  /** 读取文档类文件 */
  private async readDocument(
    _fileUrl: string,
    tmpPath: string,
    fileName: string,
    mimeType: string,
  ): Promise<string> {
    try {
      const chunks = await this.documentProcessor.parseDocument({
        filePath: tmpPath,
        mimeType,
        fileName,
      });
      const content = chunks
        .map((c) => c.content)
        .join('\n\n')
        .slice(0, MAX_FILE_CONTENT_CHARS);
      return JSON.stringify({
        success: true,
        fileName,
        mimeType,
        content,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return JSON.stringify({
        success: false,
        error: '文档解析失败',
        message,
      });
    }
  }

  /** 读取图片文件 */
  private async readImage(_fileUrl: string, tmpPath: string, fileName: string): Promise<string> {
    try {
      const textChunks = await this.mediaProcessor.processImage({
        filePath: tmpPath,
        fileName,
        fileUrl: _fileUrl,
      });
      const content = textChunks.map((c) => c.content).join('\n\n');
      return JSON.stringify({
        success: true,
        fileName,
        mimeType: 'image',
        contentType: 'image_description',
        content,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return JSON.stringify({
        success: false,
        error: '图片描述失败',
        message,
      });
    }
  }
}
