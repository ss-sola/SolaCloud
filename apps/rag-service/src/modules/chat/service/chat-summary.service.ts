import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { RagConfigService } from '../../config/service/rag-config.service';
import { getConfig } from '@nest-cloud/sdk';
import { RagConfigKeys } from '../../../config-keys';
import { ChatMessageService } from './chat-message.service';
import { DEFAULT_LLM_TIMEOUT } from '../../../constants/rag.constants';

/**
 * 会话摘要服务。
 * 通过 LLM 生成精炼的会话标题和对话摘要。
 */
@Injectable()
export class ChatSummaryService {
  private readonly logger = new Logger(ChatSummaryService.name);

  /** 会话标题最大字符数 */
  private readonly TITLE_MAX_LENGTH = 30;
  /** 摘要生成使用的最近消息条数 */
  private readonly SUMMARY_MAX_MESSAGES = 30;

  constructor(
    private readonly ragConfigService: RagConfigService,
    private readonly chatMessageService: ChatMessageService,
  ) {}

  /**
   * 获取会话全部消息，构建 LLM prompt，生成一句话摘要。
   */
  async summarizeSession(sessionId: number): Promise<string> {
    const messages = await this.chatMessageService.findBySessionId(sessionId);

    if (messages.length === 0) {
      return '新对话';
    }

    // 超长会话只取最近 N 条消息，避免超出上下文窗口
    const recentMessages =
      messages.length > this.SUMMARY_MAX_MESSAGES
        ? messages.slice(-this.SUMMARY_MAX_MESSAGES)
        : messages;

    const conversation = recentMessages
      .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
      .join('\n');

    const prompt = `请用不超过${this.TITLE_MAX_LENGTH}个汉字的一句话总结以下对话的主题，不要引号，直接输出总结内容：

${conversation}`;

    const llm = await this.createLlmInstance();
    const response = await llm.invoke([
      new SystemMessage('你是一个对话总结助手，擅长用一句话精准概括对话主题。'),
      new HumanMessage(prompt),
    ]);

    const content =
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

    // 结果清洗：去引号、去空白、截断
    const cleaned = content
      .replace(/[""''`]/g, '')
      .trim()
      .slice(0, this.TITLE_MAX_LENGTH);

    return cleaned || '新对话';
  }

  /**
   * 生成会话标题并准备更新（调用 summarizeSession 后包装为 update 操作）。
   */
  async summarizeSessionTitle(sessionId: number): Promise<string> {
    return this.summarizeSession(sessionId);
  }

  private async createLlmInstance(): Promise<ChatOpenAI> {
    const config = await this.ragConfigService.getChatLlmConfig();
    const apiKey = config.apiKey || getConfig<string>(RagConfigKeys.OpenAIApiKey, '', false);

    if (!apiKey) {
      throw new Error('API Key 未配置，无法生成会话摘要');
    }

    return new ChatOpenAI({
      model: config.model,
      openAIApiKey: apiKey,
      temperature: 0,
      timeout: DEFAULT_LLM_TIMEOUT,
      configuration: { baseURL: config.baseUrl, apiKey },
    });
  }
}
