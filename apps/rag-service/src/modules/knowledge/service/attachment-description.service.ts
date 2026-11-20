import { ContextService, getConfig, ProjectException } from '@nest-cloud/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { RagConfigKeys } from '../../../config-keys';
import { FileServiceClient } from '../../../client/file-service.client';
import { KnowledgeService } from './knowledge.service';
import { RagConfigService } from '../../config/service/rag-config.service';
import * as fs from 'fs';
import * as path from 'path';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';
import { DEFAULT_LLM_TIMEOUT, FILE_DESCRIPTION_WRITE_STEP } from '../../../constants/rag.constants';
import { FileDownloadUtil } from '../../../utils/file-download.util';
import { getAnyExtractor } from 'any-extractor';
import JSZip from 'jszip';
import { MultimodalUtil } from '../utils/multimodal.util';

/** 生成附件描述的输入 */
export interface GenerateDescriptionInput {
  fileId: number;
  fileUrl: string;
  mimeType: string;
  fileName: string;
}

/** 触发附件自动向量化的输入 */
export interface AutoVectorizeInput {
  fileId: number;
  fileUrl: string;
  mimeType: string;
  fileName: string;
  description: string;
}

/** 图片 MIME 类型前缀 */
const IMAGE_MIME_TYPES = ['image/', 'video/'];

/** 单次 LLM 摘要的最大文本长度 */
const MAX_SUMMARIZE_CHUNK_SIZE = 4000;

/**
 * 附件描述生成服务。
 * 接收文件服务通知，下载文件 → 多模态模型生成描述 → 回写附件表。
 */
@Injectable()
export class AttachmentDescriptionService {
  private readonly logger = new Logger(AttachmentDescriptionService.name);

  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly fileServiceClient: FileServiceClient,
    private readonly ragConfigService: RagConfigService,
  ) {}

  /** 生成附件描述并回写，返回生成的描述字符串 */
  async generateDescription(input: GenerateDescriptionInput): Promise<string> {
    if (!input.fileId) {
      throw new ProjectException('fileId 不能为空');
    }
    if (!input.fileUrl) {
      throw new ProjectException('fileUrl 不能为空');
    }
    if (!input.fileName) {
      throw new ProjectException('fileName 不能为空');
    }

    const tmpDir = this.getTempDir();
    const ext = path.extname(input.fileName) || '.tmp';
    const tmpPath = path.join(tmpDir, `${input.fileId}-${Date.now()}${ext}`);

    let description: string;
    try {
      // 1. 下载文件到临时目录
      await FileDownloadUtil.downloadToFile(input.fileUrl, tmpPath);

      // 2. 使用多模态模型生成描述
      description = await this.describeFile(tmpPath, input.mimeType, input.fileName);
    } catch (error) {
      this.logger.error(
        `附件描述生成失败: fileId=${input.fileId} - ${error instanceof Error ? error.message : String(error)}`,
      );
      return `[${input.fileName}] 描述生成失败`;
    } finally {
      await fs.promises.unlink(tmpPath).catch(() => undefined);
    }

    // 回写错误交由调用方处理，只有已确认的描述可进入后续向量化。
    const stepKey = ContextService.deriveOperationKey(
      `${FILE_DESCRIPTION_WRITE_STEP}:${input.fileId}`,
    );
    const writeDescription = () =>
      this.fileServiceClient.updateFileDescription({ id: input.fileId, description });
    if (stepKey) {
      await ContextService.withOperationKey(stepKey, writeDescription);
    } else {
      await writeDescription();
    }
    this.logger.log(`附件描述生成完成: fileId=${input.fileId}`);
    return description;
  }

  /** 删除附件关联的向量化数据 */
  async deleteByFileId(fileId: number): Promise<void> {
    try {
      // 删除知识库中关联该 fileId 的文档及其 chunk
      await this.knowledgeService.deleteByFileId(fileId);
      this.logger.log(`附件向量化数据已删除: fileId=${fileId}`);
    } catch (error) {
      this.logger.error(
        `删除附件向量化数据失败: fileId=${fileId} - ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 使用已有描述触发附件向量化 */
  async vectorizeAttachment(input: AutoVectorizeInput): Promise<void> {
    try {
      await this.knowledgeService.processAttachmentForVectorization({
        fileId: input.fileId,
        fileUrl: input.fileUrl,
        mimeType: input.mimeType,
        fileName: input.fileName,
        description: input.description,
      });
      this.logger.log(`附件向量化完成: fileId=${input.fileId}`);
    } catch (error) {
      this.logger.error(
        `附件向量化失败: fileId=${input.fileId} - ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /** 获取临时目录 */
  private getTempDir(): string {
    const uploadRootDir = getConfig<string>(RagConfigKeys.UploadRootDir, 'public/uploads', false);
    return path.join(uploadRootDir, '_rag_tmp');
  }

  /** 使用多模态模型生成文件描述 */
  private async describeFile(
    filePath: string,
    mimeType: string,
    fileName: string,
  ): Promise<string> {
    await this.ragConfigService.getMultimodalConfig();
    const fileBuffer = await fs.promises.readFile(filePath);
    const isImage = IMAGE_MIME_TYPES.some((prefix) => mimeType.startsWith(prefix));

    if (isImage) {
      // 图片/视频：直接发送文件内容给多模态模型
      return this.describeMedia(fileBuffer, mimeType, fileName);
    }

    // 非媒体文件：使用 any-extractor 提取内容后分块 LLM 摘要
    return this.summarizeText(filePath, mimeType, fileName);
  }

  /** 使用多模态模型描述图片或视频 */
  private async describeMedia(
    fileBuffer: Buffer,
    mimeType: string,
    fileName: string,
  ): Promise<string> {
    const isVideo = mimeType.startsWith('video/');

    if (isVideo) {
      // 视频：截取前 N 字节转为 base64 发送
      return this.describeVideo(fileBuffer, mimeType, fileName);
    }

    // 图片：直接发送文件内容
    return this.describeImage(fileBuffer, mimeType, fileName);
  }

  /** 使用多模态模型描述图片 */
  private async describeImage(
    fileBuffer: Buffer,
    mimeType: string,
    fileName: string,
  ): Promise<string> {
    return MultimodalUtil.describeImage(fileBuffer, mimeType, fileName, this.ragConfigService);
  }

  /** 使用多模态模型描述视频（截取前 N 字节） */
  private async describeVideo(
    fileBuffer: Buffer,
    mimeType: string,
    fileName: string,
  ): Promise<string> {
    return MultimodalUtil.describeVideo(fileBuffer, mimeType, fileName, this.ragConfigService);
  }

  /** 使用 any-extractor 提取文件内容后分块 LLM 摘要 */
  private async summarizeText(
    filePath: string,
    mimeType: string,
    fileName: string,
  ): Promise<string> {
    const fileBuffer = await fs.promises.readFile(filePath);

    // 1. 提取文本内容
    const rawText = await this.extractText(fileBuffer, mimeType, fileName);

    if (!rawText || rawText.trim().length === 0) {
      return `[${fileName}] ${mimeType} 类型文件，内容为空`;
    }

    // 2. 提取嵌入的图片（Office 文件）
    const images = await this.extractImagesFromOffice(fileBuffer, mimeType, fileName);

    // 3. 文本太短直接返回
    if (rawText.length < 10) {
      return rawText.trim();
    }

    // 4. 文本分块后逐块摘要，再合并
    const chunks = this.splitIntoChunks(rawText);
    const summaries: string[] = [];

    for (const chunk of chunks) {
      const summary = await this.summarizeChunk(chunk, images, fileName);
      summaries.push(summary);
    }

    return summaries.join('\n');
  }

  /** 使用 any-extractor 提取文本内容 */
  private async extractText(
    fileBuffer: Buffer,
    mimeType: string,
    fileName: string,
  ): Promise<string> {
    const extractor = getAnyExtractor();

    try {
      return await extractor.parseFile(fileBuffer);
    } catch (error) {
      this.logger.warn(
        `any-extractor 解析失败: ${fileName} - ${error instanceof Error ? error.message : String(error)}`,
      );
      return '';
    }
  }

  /** 从 Office 文件中提取嵌入的图片 */
  private async extractImagesFromOffice(
    fileBuffer: Buffer,
    mimeType: string,
    fileName: string,
  ): Promise<{ data: string; mimeType: string }[]> {
    // Office 文件（ZIP 格式）
    const officeMimeTypes = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
    ];

    if (!officeMimeTypes.includes(mimeType)) {
      return [];
    }

    return this.extractImagesFromZip(fileBuffer, fileName);
  }

  /** 从 ZIP 格式文件（Office）中提取嵌入的图片 */
  private async extractImagesFromZip(
    fileBuffer: Buffer,
    fileName: string,
  ): Promise<{ data: string; mimeType: string }[]> {
    try {
      const zip = await JSZip.loadAsync(fileBuffer);
      const images: { data: string; mimeType: string }[] = [];
      const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];

      for (const [relativePath, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const ext = path.extname(relativePath).toLowerCase();
        if (!imageExtensions.includes(ext)) continue;

        const content = await entry.async('uint8array');
        const buffer = Buffer.from(content);
        const imageMime = this.lookupImageMime(ext);
        images.push({ data: buffer.toString('base64'), mimeType: imageMime });
      }

      if (images.length > 0) {
        this.logger.log(`从 ${fileName} 中提取了 ${images.length} 张图片`);
      }
      return images;
    } catch (error) {
      this.logger.warn(
        `提取 Office 文件图片失败: ${fileName} - ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /** 根据文件扩展名查找 MIME 类型 */
  private lookupImageMime(ext: string): string {
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.webp': 'image/webp',
    };
    return mimeMap[ext] || 'image/png';
  }

  /** 将长文本按固定大小分块 */
  private splitIntoChunks(text: string): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      const end = Math.min(start + MAX_SUMMARIZE_CHUNK_SIZE, text.length);
      // 尽量在换行处断开
      let breakPoint = end;
      const lastNewline = text.lastIndexOf('\n', end);
      if (lastNewline > start) {
        breakPoint = lastNewline + 1;
      }
      chunks.push(text.slice(start, breakPoint).trim());
      start = breakPoint;
    }

    return chunks;
  }

  /** 对单个文本块调用 LLM 摘要 */
  private async summarizeChunk(
    chunk: string,
    images: { data: string; mimeType: string }[],
    fileName: string,
  ): Promise<string> {
    const config = await this.ragConfigService.getMultimodalConfig();
    const llm = this.createTextLlm(config);

    // 构建消息内容：文本 + 嵌入的图片
    const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      {
        type: 'text',
        text: `请阅读以下文档内容，用一段简洁的中文（不超过 200 字）概括其主要内容和关键信息：\n\n${chunk}`,
      },
    ];

    // 将嵌入图片追加到消息中
    for (const image of images) {
      contentParts.push({
        type: 'image_url',
        image_url: { url: `data:${image.mimeType};base64,${image.data}` },
      });
    }

    const message = new HumanMessage({ content: contentParts as any });

    try {
      const response = await llm.invoke([message]);
      return (response.content as string)?.trim() || `[${fileName}] 摘要生成失败`;
    } catch (error) {
      this.logger.warn(
        `文档摘要生成失败: ${fileName} - ${error instanceof Error ? error.message : String(error)}`,
      );
      return chunk.slice(0, 200);
    }
  }

  /** 创建文本摘要 LLM 实例 */
  private createTextLlm(config: { model: string; baseUrl: string; apiKey: string }): ChatOpenAI {
    return new ChatOpenAI({
      model: config.model || undefined,
      openAIApiKey: config.apiKey || undefined,
      configuration: { baseURL: config.baseUrl, apiKey: config.apiKey },
      temperature: 0,
      timeout: DEFAULT_LLM_TIMEOUT,
    });
  }
}
