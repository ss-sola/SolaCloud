import { BaseService } from '@nest-cloud/sdk';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KnowledgeBase } from '../entity/knowledge-base.entity';
import { KnowledgeBaseStatus } from '../knowledge.constants';

/** 知识库列表查询选项 */
export interface ListKnowledgeBasesOptions {
  /** 可选的状态过滤 */
  status?: KnowledgeBaseStatus;
}

@Injectable()
export class KnowledgeBaseService extends BaseService<KnowledgeBase> {
  constructor(
    @InjectRepository(KnowledgeBase)
    protected readonly repository: Repository<KnowledgeBase>,
  ) {
    super(repository);
  }

  async findByStatus(status: KnowledgeBaseStatus): Promise<KnowledgeBase[]> {
    return this.repository.find({ where: { status } });
  }

  /** 查询所有未删除的知识库列表 */
  async listAccessible(_accountId: number): Promise<KnowledgeBase[]> {
    return this.listAccessibleWithOptions({});
  }

  /**
   * 查询指定账户可访问的知识库列表。
   * @param options 查询选项
   */
  async listAccessibleWithOptions(options: ListKnowledgeBasesOptions): Promise<KnowledgeBase[]> {
    const { status } = options;

    const qb = this.repository.createQueryBuilder('kb').where('kb.deleted_at IS NULL');

    if (status) {
      qb.andWhere('kb.status = :status', { status });
    }

    return qb.orderBy('kb.created_at', 'DESC').getMany();
  }
}
