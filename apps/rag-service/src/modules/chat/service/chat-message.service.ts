import { BaseService } from '@nest-cloud/sdk';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatMessage } from '../entity/chat-message.entity';
import { FileServiceClient } from '../../../client/file-service.client';

@Injectable()
export class ChatMessageService extends BaseService<ChatMessage> {
  constructor(
    @InjectRepository(ChatMessage)
    protected readonly repository: Repository<ChatMessage>,
    private readonly fileServiceClient: FileServiceClient,
  ) {
    super(repository);
  }

  /** 根据 sessionId 查询消息历史 */
  async findBySessionId(sessionId: number): Promise<ChatMessage[]> {
    return this.repository.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
    });
  }

  /** 查询指定会话的全部消息（不分页，用于上下文压缩等复杂查询场景） */
  async findAllBySession(sessionId: number): Promise<ChatMessage[]> {
    return this.repository.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
    });
  }

  /** 根据 sessionId 查询最近 N 条消息 */
  async findRecentBySessionId(sessionId: number, take: number): Promise<ChatMessage[]> {
    return this.repository.find({
      where: { sessionId },
      order: { createdAt: 'DESC' },
      take,
    });
  }

  /** 删除指定会话中 ID 大于 afterId 的消息（用于重新生成时清理旧回复） */
  async deleteBySessionAfterId(sessionId: number, afterId: number): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .delete()
      .where('session_id = :sessionId', { sessionId })
      .andWhere('id > :afterId', { afterId })
      .execute();
  }

  /** 保存消息（供 ChatService 直接调用） */
  async saveMessage(data: Partial<ChatMessage>): Promise<ChatMessage> {
    const msg = this.repository.create(data);
    return this.repository.save(msg);
  }

  /** 更新查询 embedding */
  async updateQueryEmbedding(messageId: number, embedding: number[]): Promise<void> {
    await this.repository.update(messageId, { queryEmbedding: embedding });
  }

  /** 查找会话中最新的指定角色消息 */
  async findLatestByRole(sessionId: number, role: string): Promise<ChatMessage | null> {
    return this.repository.findOne({
      where: { sessionId, role: role as any },
      order: { createdAt: 'DESC' },
    });
  }

  /** 批量获取文件信息并合并到各消息的 sources 中（兼容历史数据） */
  async enrichSourcesFileInfo(messages: ChatMessage[]): Promise<void> {
    const allFileIds = new Set<number>();
    for (const msg of messages) {
      if (msg.sources) {
        for (const source of msg.sources) {
          if (source.fileId && typeof source.fileId === 'number' && !source.fileName) {
            allFileIds.add(source.fileId);
          }
        }
      }
    }

    if (allFileIds.size === 0) return;

    try {
      const batchResult = await this.fileServiceClient.getFileDetailBatch({
        ids: [...allFileIds],
      });
      if (!batchResult?.data) return;

      const fileMap = new Map(batchResult.data.map((f) => [f.id, f]));

      for (const msg of messages) {
        if (!msg.sources) continue;
        for (const source of msg.sources) {
          const fid = source.fileId;
          if (fid && typeof fid === 'number' && !source.fileName) {
            const file = fileMap.get(fid);
            if (file) {
              source.fileName = file.originalName;
              source.fileUrl = file.url ?? null;
              source.mimeType = file.mimeType;
              source.extension = file.extension;
              source.isExtracted = file.isExtracted;
              source.previewUrl = file.previewUrl;
            }
          }
        }
      }
    } catch {
      // 补充文件信息失败不影响消息列表返回
    }
  }
}
