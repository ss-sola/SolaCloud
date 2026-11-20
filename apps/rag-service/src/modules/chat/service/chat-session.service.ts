import { BaseService } from '@nest-cloud/sdk';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ChatSession } from '../../chat/entity/chat-session.entity';

@Injectable()
export class ChatSessionService extends BaseService<ChatSession> {
  constructor(
    @InjectRepository(ChatSession)
    protected readonly repository: Repository<ChatSession>,
  ) {
    super(repository);
  }

  /** 根据 userId 查询会话列表 */
  async findByUserId(userId: number): Promise<ChatSession[]> {
    return this.repository.find({
      where: { createUser: userId, deletedAt: IsNull() },
      order: { updatedAt: 'DESC' },
    });
  }

  /** 更新会话摘要 */
  async updateSummary(sessionId: number, summary: string): Promise<void> {
    await this.repository.update(sessionId, { summary });
  }

  /** 创建会话（供 ChatService 直接调用） */
  async createSession(data: Partial<ChatSession>): Promise<ChatSession> {
    const session = this.repository.create(data);
    return this.repository.save(session);
  }

  /** 更新会话标题 */
  async updateTitle(sessionId: number, title: string): Promise<void> {
    await this.repository.update(sessionId, { title });
  }

  /** 只返回当前账号拥有的未删除会话。 */
  async findOwnedSession(id: number, accountId: number): Promise<ChatSession | null> {
    return this.repository.findOneBy({ id, createUser: accountId, deletedAt: IsNull() });
  }
}
