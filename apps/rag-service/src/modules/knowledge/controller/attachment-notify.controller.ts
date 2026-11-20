import { ResponseUtil } from '@nest-cloud/sdk';
import { Body, Controller, Post } from '@nestjs/common';
import { AttachmentDescriptionService } from '../service/attachment-description.service';
import {
  NotifyAttachmentDeletionForm,
  NotifyAttachmentDescribeForm,
} from '../form/attachment-notify.form';

/** 触发附件自动向量化请求 */
export interface AutoVectorizeForm {
  fileId: number;
  fileUrl: string;
  mimeType: string;
  fileName: string;
  description: string;
}

@Controller('rag')
export class AttachmentNotifyController {
  constructor(private readonly attachmentDescriptionService: AttachmentDescriptionService) {}

  /** 接收文件服务通知，生成附件描述 */
  @Post('knowledge/attachment-describe')
  async notifyAttachmentDescribe(@Body() form: NotifyAttachmentDescribeForm) {
    const description = await this.attachmentDescriptionService.generateDescription({
      fileId: form.fileId,
      fileUrl: form.fileUrl,
      mimeType: form.mimeType,
      fileName: form.fileName,
    });
    return ResponseUtil.success(description);
  }

  /** 接收描述生成结果，触发附件向量化 */
  @Post('knowledge/auto-vectorize')
  async autoVectorize(@Body() form: AutoVectorizeForm) {
    await this.attachmentDescriptionService.vectorizeAttachment({
      fileId: form.fileId,
      fileUrl: form.fileUrl,
      mimeType: form.mimeType,
      fileName: form.fileName,
      description: form.description,
    });
    return ResponseUtil.success(true);
  }

  /** 接收文件服务通知，删除附件关联的向量化数据 */
  @Post('knowledge/delete-by-file')
  async notifyDeleteByFile(@Body() form: NotifyAttachmentDeletionForm) {
    await this.attachmentDescriptionService.deleteByFileId(form.fileId);
    return ResponseUtil.success(true);
  }
}
