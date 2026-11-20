import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';
import { DEFAULT_LLM_TIMEOUT } from '../../../constants/rag.constants';
import { RagConfigService } from '../../config/service/rag-config.service';

/** 多模态模型配置 */
interface MultimodalLlmConfig {
  model: string;
  baseUrl: string;
  apiKey: string;
}

/**
 * 多模态模型调用工具类。
 *
 * 职责：
 * - 创建多模态 LLM 实例（复用配置）
 * - 构造图片/视频的 base64 多模态消息
 * - 统一错误处理
 */
export class MultimodalUtil {
  /** 使用多模态模型描述图片内容 */
  static async describeImage(
    imageBuffer: Buffer,
    mimeType: string,
    fileName: string,
    ragConfigService: RagConfigService,
  ): Promise<string> {
    const config = await this.resolveMultimodalConfig(ragConfigService);
    if (!config) {
      return `[${fileName}] 多模态 API Key 未配置`;
    }

    const base64Data = imageBuffer.toString('base64');
    const llm = this.createLlm(config);

    const message = new HumanMessage({
      content: [
        {
          type: 'text',
          text: `请用一段简洁的中文描述这个文件的主要内容，包括场景、物体、文字信息等。如果文件中有重要文字内容，请一并提取。不超过 200 字。文件名：${fileName}。`,
        },
        {
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${base64Data}`,
          },
        },
      ],
    });

    try {
      const response = await llm.invoke([message]);
      return (response.content as string)?.trim() || `[${fileName}] 内容解析失败`;
    } catch {
      return `[${fileName}] 文件大小 ${imageBuffer.length} 字节，描述生成失败`;
    }
  }

  /** 使用多模态模型描述视频（截取前 N 字节） */
  static async describeVideo(
    videoBuffer: Buffer,
    mimeType: string,
    fileName: string,
    ragConfigService: RagConfigService,
  ): Promise<string> {
    const config = await this.resolveMultimodalConfig(ragConfigService);
    if (!config) {
      return `[${fileName}] 多模态 API Key 未配置`;
    }

    // 视频文件较大，截取前 4MB 发送给多模态模型
    const maxVideoBytes = 4 * 1024 * 1024;
    const truncatedBuffer =
      videoBuffer.length > maxVideoBytes ? videoBuffer.subarray(0, maxVideoBytes) : videoBuffer;

    const base64Data = truncatedBuffer.toString('base64');
    const llm = this.createLlm(config);

    const message = new HumanMessage({
      content: [
        {
          type: 'text',
          text: `请用一段简洁的中文描述这个视频的主要内容，包括场景、物体、文字信息等。不超过 200 字。文件名：${fileName}。`,
        },
        {
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${base64Data}`,
          },
        },
      ],
    });

    try {
      const response = await llm.invoke([message]);
      return (response.content as string)?.trim() || `[${fileName}] 内容解析失败`;
    } catch {
      return `[${fileName}] 文件大小 ${videoBuffer.length} 字节，描述生成失败`;
    }
  }

  private static async resolveMultimodalConfig(
    ragConfigService: RagConfigService,
  ): Promise<MultimodalLlmConfig | null> {
    try {
      return await ragConfigService.getMultimodalConfig();
    } catch {
      return null;
    }
  }

  private static createLlm(config: MultimodalLlmConfig): ChatOpenAI {
    return new ChatOpenAI({
      model: config.model || undefined,
      openAIApiKey: config.apiKey || undefined,
      configuration: { baseURL: config.baseUrl, apiKey: config.apiKey },
      temperature: 0,
      timeout: DEFAULT_LLM_TIMEOUT,
    });
  }
}
