import { BaseController, ContextService, ResponseUtil } from '@nest-cloud/sdk';
import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { FileServiceClient } from '../../../client/file-service.client';
import { CreateKnowledgeBaseForm, IngestAttachmentsForm } from '../form/knowledge.form';
import { KnowledgeService } from '../service/knowledge.service';
import { KnowledgeDocument } from '../entity/knowledge-document.entity';
import { KnowledgeBaseService } from '../service/knowledge-base.service';

@Controller('knowledge')
export class KnowledgeController extends BaseController<KnowledgeDocument, KnowledgeService> {
  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly knowledgeBaseService: KnowledgeBaseService,
    private readonly fileServiceClient: FileServiceClient,
  ) {
    super(knowledgeService);
  }

  /** 创建知识库 */
  @Post('base')
  async createKnowledgeBase(@Body() form: CreateKnowledgeBaseForm) {
    const currentAccount = ContextService.getCurrentAccount();
    const kb = await this.knowledgeService.createKnowledgeBase({
      name: form.name,
      description: form.description,
      createUser: currentAccount?.accountId,
    });
    return ResponseUtil.success(kb);
  }

  /** 查询知识库列表 */
  @Get('base/list')
  async listKnowledgeBases() {
    const list = await this.knowledgeBaseService.listAccessibleWithOptions({});
    return ResponseUtil.success(list);
  }

  /** 接收附件数组，启动向量化处理 */
  @Post('ingest')
  async ingestAttachments(@Body() form: IngestAttachmentsForm) {
    const currentAccount = ContextService.getCurrentAccount();
    const documents = await this.knowledgeService.ingestAttachments({
      knowledgeBaseId: form.knowledgeBaseId,
      attachments: form.attachments,
      createUser: currentAccount?.accountId,
    });
    return ResponseUtil.success(documents);
  }

  /** 查询文档处理状态，补全文件基本信息 */
  @Get('document/:id')
  async getDocumentStatus(@Param('id', ParseIntPipe) id: number) {
    const doc = await this.knowledgeService.getDocumentStatus(id);
    if (!doc) {
      return ResponseUtil.success(null);
    }

    let fileName = '';
    let fileUrl: string | null = null;

    if (doc.fileId) {
      try {
        const fileRes = await this.fileServiceClient.getFileDetail({ id: doc.fileId });
        fileName = fileRes.data?.originalName ?? '';
        fileUrl = fileRes.data?.url ?? null;
      } catch {
        // 文件服务不可用时降级，不影响文档状态返回
      }
    }

    return ResponseUtil.success({
      ...doc,
      fileName,
      fileUrl,
    });
  }
}
