import {
  BaseController,
  DatabaseIdempotencyService,
  PermissionGuard,
  ProjectException,
  RequirePermissions,
  ResponseUtil,
  SessionAuthGuard,
} from '@nest-cloud/sdk';
import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  FILE_CONTROLLER_ROUTE,
  FILE_MANAGE_PERMISSION,
  FILE_UPLOAD_FIELD_NAME,
  INTERCEPTOR_UPLOAD_MAX_SIZE_BYTES,
} from '../file.constants';
import { FileBatchQueryForm } from '../form/file-batch-query.form';
import { FileDescriptionForm } from '../form/file-description.form';
import { FileListForm } from '../form/file-list.form';
import { FileQueryForm } from '../form/file-query.form';
import { FileUploadCheckForm } from '../form/file-upload-check.form';
import { FileUploadChunkForm } from '../form/file-upload-chunk.form';
import { FileUploadMergeForm } from '../form/file-upload-merge.form';
import { FileUploadUtil } from '../utils/file-upload.util';
import { FileService } from '../service/file.service';
import { FileUploadSessionService } from '../service/file-upload-session.service';
import { FileZipExtractService } from '../service/file-zip-extract.service';
import { FileItem } from '../entity/file-item.entity';
import { FILE_DESCRIPTION_UPDATE_OPERATION } from '../../../constants/file-operation.constants';

const uploadInterceptor = FileInterceptor(FILE_UPLOAD_FIELD_NAME, {
  storage: memoryStorage(),
  limits: {
    fileSize: INTERCEPTOR_UPLOAD_MAX_SIZE_BYTES,
  },
  fileFilter: (_req, file, callback) => {
    if (!file.originalname) {
      callback(new Error('Invalid file'), false);
      return;
    }
    callback(null, true);
  },
});

@Controller(FILE_CONTROLLER_ROUTE)
export class FileController extends BaseController<FileItem, FileService> {
  constructor(
    private readonly fileService: FileService,
    private readonly fileUploadSessionService: FileUploadSessionService,
    private readonly fileZipExtractService: FileZipExtractService,
    private readonly idempotencyService: DatabaseIdempotencyService,
  ) {
    super(fileService);
  }

  @Post('upload/check')
  @UseGuards(SessionAuthGuard)
  async checkUpload(@Body() body: FileUploadCheckForm) {
    return ResponseUtil.success(
      await this.fileUploadSessionService.checkUpload({
        ...body,
        fileId: body.fileId.trim(),
        sourceHash: body.sourceHash.trim().toLowerCase(),
      }),
    );
  }

  @Post('upload')
  @UseGuards(SessionAuthGuard)
  @UseInterceptors(uploadInterceptor)
  async upload(@UploadedFile() file: Express.Multer.File, @Body() body: FileUploadChunkForm) {
    if (!file) {
      throw new ProjectException('上传文件不能为空', 400);
    }
    return ResponseUtil.success(
      await this.fileUploadSessionService.uploadChunk(file, {
        ...body,
        fileId: body.fileId.trim(),
        chunkHash: FileUploadUtil.normalizeOptionalString(body.chunkHash),
      }),
    );
  }

  @Post('upload/merge')
  @UseGuards(SessionAuthGuard)
  async mergeUpload(@Body() body: FileUploadMergeForm) {
    return ResponseUtil.success(
      await this.fileUploadSessionService.mergeUpload({
        ...body,
        fileId: body.fileId.trim(),
        fileHash: body.fileHash.trim().toLowerCase(),
        originalName: body.originalName.trim(),
        mimeType: FileUploadUtil.normalizeOptionalString(body.mimeType),
        scene: FileUploadUtil.normalizeOptionalString(body.scene),
        businessType: FileUploadUtil.normalizeOptionalString(body.businessType),
        isTemporary: FileUploadUtil.normalizeOptionalBoolean(body.isTemporary),
      }),
    );
  }

  @Get('list')
  @UseGuards(SessionAuthGuard, PermissionGuard)
  @RequirePermissions(FILE_MANAGE_PERMISSION)
  async list(@Query() query: FileListForm) {
    return ResponseUtil.success(await this.fileService.list(query));
  }

  @Get('detail')
  @UseGuards(SessionAuthGuard)
  async detail(@Query() query: FileQueryForm) {
    return ResponseUtil.success(await this.fileService.getDetail(query));
  }

  @Post('batch-detail')
  async batchDetail(@Body() body: FileBatchQueryForm) {
    return ResponseUtil.success(await this.fileService.getBatchDetail(body));
  }

  @Delete('remove')
  @UseGuards(SessionAuthGuard, PermissionGuard)
  @RequirePermissions(FILE_MANAGE_PERMISSION)
  async removeFile(@Query() query: FileQueryForm) {
    return ResponseUtil.success(await this.fileService.remove(query));
  }

  /** 更新附件描述 */
  @Put('description')
  async updateDescription(@Body() body: FileDescriptionForm) {
    return this.idempotencyService.executeHttp(
      {
        operation: FILE_DESCRIPTION_UPDATE_OPERATION,
        payload: { id: body.id, description: body.description },
        allowPublic: true,
      },
      async () => {
        await this.fileService.update(body.id, { description: body.description });
        return ResponseUtil.success(true);
      },
    );
  }

  /** 获取 zip 文件解压后的目录树结构 */
  @Get('tree')
  @UseGuards(SessionAuthGuard)
  async tree(@Query() query: FileQueryForm) {
    const detail = await this.fileService.getDetail(query);
    if (!detail.isExtracted) {
      throw new ProjectException('该文件未解压或不是 zip 文件');
    }
    const tree = await this.fileService.getExtractedFileTree(detail, this.fileZipExtractService);
    return ResponseUtil.success(tree);
  }
}
