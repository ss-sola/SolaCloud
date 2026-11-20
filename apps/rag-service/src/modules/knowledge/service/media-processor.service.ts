import { Injectable, Logger } from '@nestjs/common';
import { TextChunk } from '../../../utils/text-splitter.util';
import * as fs from 'fs';
import { RagConfigService } from '../../config/service/rag-config.service';
import { MultimodalUtil } from '../utils/multimodal.util';

/**
 * 多媒体处理服务。
 * 负责图片 OCR/多模态描述、音视频转文字。
 */
@Injectable()
export class MediaProcessorService {
  private readonly logger = new Logger(MediaProcessorService.name);

  constructor(private readonly ragConfigService: RagConfigService) {}

  /** 处理图片：使用多模态模型生成描述文本 */
  async processImage(options: {
    filePath: string;
    fileName: string;
    fileUrl?: string;
  }): Promise<TextChunk[]> {
    this.logger.log(`处理图片: ${options.fileName}`);

    try {
      const imageBuffer = await fs.promises.readFile(options.filePath);
      const description = await MultimodalUtil.describeImage(
        imageBuffer,
        'image/jpeg',
        options.fileName,
        this.ragConfigService,
      );
      return [
        {
          content: description,
          metadata: {
            source: options.fileName,
            type: 'image',
            fileUrl: options.fileUrl,
          },
        },
      ];
    } catch (error) {
      this.logger.warn(
        `图片描述失败: ${options.fileName} - ${error instanceof Error ? error.message : String(error)}`,
      );
      return [
        {
          content: `[图片] ${options.fileName}，描述生成失败`,
          metadata: {
            source: options.fileName,
            type: 'image',
            fileUrl: options.fileUrl,
          },
        },
      ];
    }
  }

  /** 处理音频：转文字后返回文本 */
  async processAudio(options: {
    filePath: string;
    fileName: string;
    fileUrl?: string;
  }): Promise<TextChunk[]> {
    this.logger.log(`处理音频: ${options.fileName}`);

    // 扩展点：接入 Whisper API 或其他语音识别服务
    // 一期先返回占位文本
    return [
      {
        content: `[音频] ${options.fileName}，语音转文字待接入 Whisper API(暂未实现音频文件接入)`,
        metadata: {
          source: options.fileName,
          type: 'audio',
          fileUrl: options.fileUrl,
        },
      },
    ];
  }

  /** 处理视频：提取音轨转文字 + 关键帧描述 */
  async processVideo(options: {
    filePath: string;
    fileName: string;
    fileUrl?: string;
  }): Promise<TextChunk[]> {
    this.logger.log(`处理视频: ${options.fileName}`);

    // 扩展点：提取音轨使用语音识别 + 关键帧使用多模态描述
    // 一期先返回占位文本
    return [
      {
        content: `[视频] ${options.fileName}，内容解析待接入 FFmpeg + Whisper + 多模态模型(暂未实现视频文件接入)`,
        metadata: {
          source: options.fileName,
          type: 'video',
          fileUrl: options.fileUrl,
        },
      },
    ];
  }

  /** 语音转文字 */
  private async transcribeAudio(_filePath: string): Promise<string> {
    // TODO: 接入 Whisper API 或其他语音识别服务
    // 一期返回占位文本
    return '[音频内容待语音识别服务解析]';
  }
}
