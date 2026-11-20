import { BaseService } from '@nest-cloud/sdk';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { DocumentChunk } from '../entity/document-chunk.entity';

@Injectable()
export class DocumentChunkService extends BaseService<DocumentChunk> {
  constructor(
    @InjectRepository(DocumentChunk)
    protected readonly repository: Repository<DocumentChunk>,
  ) {
    super(repository);
  }

  /** 根据 documentId 查询所有分片 */
  async findByDocumentId(documentId: number): Promise<DocumentChunk[]> {
    return this.repository.find({ where: { documentId } });
  }

  /** 根据 documentIds 批量查询分片 */
  async findByDocumentIds(documentIds: number[]): Promise<DocumentChunk[]> {
    if (!documentIds.length) return [];
    return this.repository.find({ where: { documentId: In(documentIds) } });
  }

  /** 删除指定文档的所有分片 */
  async deleteByDocumentId(documentId: number): Promise<void> {
    await this.repository.delete({ documentId });
  }
}
