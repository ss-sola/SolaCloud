import { BaseService, ProjectException } from '@nest-cloud/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { In, LessThan, Repository } from 'typeorm';
import {
  DEFAULT_UPLOAD_PUBLIC_BASE_URL,
  DEFAULT_UPLOAD_ROOT_DIR,
  DEFAULT_UPLOAD_TEMP_TTL_MS,
  FILE_STATUS,
} from '../file.constants';
import { MiddlewareConfigKeys } from '../../../config-keys';
import { RagServiceClient } from '../../../client/rag-service.client';
import { FileItem } from '../entity/file-item.entity';
import { FileBatchQueryForm } from '../form/file-batch-query.form';
import { FileListForm } from '../form/file-list.form';
import { FileQueryForm } from '../form/file-query.form';
import { CleanupResult, FileRecord } from '../file.types';
import { FileStorageService } from './file-storage.service';
import { FileZipExtractService, FileTreeNode } from './file-zip-extract.service';
import { MiddlewareConfigUtil } from '../../../utils/middleware-config.util';
import { FileUploadUtil } from '../utils/file-upload.util';

@Injectable()
export class FileService extends BaseService<FileItem> {
  private readonly logger = new Logger(FileService.name);

  constructor(
    @InjectRepository(FileItem)
    fileRepository: Repository<FileItem>,
    private readonly fileStorageService: FileStorageService,
    private readonly ragServiceClient: RagServiceClient,
  ) {
    super(fileRepository);
  }

  async list(query: FileListForm) {
    const [list, count] = await this.repository.findAndCount({
      where: {
        ...(query.scene ? { scene: query.scene.trim() } : {}),
        ...(query.businessType ? { businessType: query.businessType.trim() } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.isTemporary !== undefined ? { isTemporary: query.isTemporary } : {}),
      },
      order: { id: 'DESC' },
      skip: (query.pageNum - 1) * query.pageSize,
      take: query.pageSize,
    });

    return {
      list: list.map((item) => this.toRecord(item)),
      total: count,
      page: query.pageNum,
      pageSize: query.pageSize,
      totalPages: Math.ceil(count / query.pageSize),
    };
  }

  async getDetail(query: FileQueryForm) {
    const entity = await this.findOne(query.id);
    if (!entity) {
      throw new ProjectException('文件不存在', 404);
    }
    return this.toRecord(entity);
  }

  async getBatchDetail(form: FileBatchQueryForm): Promise<FileRecord[]> {
    const entities = await this.repository.findBy({ id: In(form.ids) });
    return entities.map((entity) => this.toRecord(entity));
  }

  async remove(query: FileQueryForm) {
    const entity = await this.findOne(query.id);
    if (!entity) {
      throw new ProjectException('文件不存在', 404);
    }

    await this.fileStorageService.removeStorage({
      rootDir: MiddlewareConfigUtil.getString(
        MiddlewareConfigKeys.UploadRootDir,
        DEFAULT_UPLOAD_ROOT_DIR,
      ),
      storagePath: entity.storagePath,
    });

    // 异步通知 RAG 服务删除向量化数据
    void this.notifyAttachmentDeletion(entity);

    await this.delete(entity.id);
    return this.toRecord(entity);
  }

  /** 异步通知 RAG 服务删除附件向量化数据 */
  private async notifyAttachmentDeletion(entity: FileItem): Promise<void> {
    try {
      await this.ragServiceClient.deleteByFile({ fileId: entity.id });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to notify attachment deletion: fileId=${entity.id} - ${msg}`);
    }
  }

  async cleanupExpiredTemporaryFiles(ttlMs?: number): Promise<CleanupResult> {
    const effectiveTtlMs =
      ttlMs ??
      MiddlewareConfigUtil.getNumber(
        MiddlewareConfigKeys.UploadTempTtlMs,
        DEFAULT_UPLOAD_TEMP_TTL_MS,
      );
    const expiredAt = new Date(Date.now() - effectiveTtlMs);
    const expiredItems = await this.repository.find({
      where: {
        isTemporary: true,
        createdAt: LessThan(expiredAt),
        status: FILE_STATUS.Available,
      },
    });

    let removed = 0;
    let failed = 0;
    for (const item of expiredItems) {
      try {
        await this.fileStorageService.removeStorage({
          rootDir: MiddlewareConfigUtil.getString(
            MiddlewareConfigKeys.UploadRootDir,
            DEFAULT_UPLOAD_ROOT_DIR,
          ),
          storagePath: item.storagePath,
        });
        await this.repository.remove(item);
        removed += 1;
      } catch {
        failed += 1;
      }
    }

    return {
      matched: expiredItems.length,
      removed,
      failed,
    };
  }

  private toRecord(entity: FileItem): FileRecord {
    const baseUrl = MiddlewareConfigUtil.getString(
      MiddlewareConfigKeys.UploadPublicBaseUrl,
      DEFAULT_UPLOAD_PUBLIC_BASE_URL,
    );
    const accessUrls = this.fileStorageService.buildAccessUrls(entity.storagePath, baseUrl);

    // zip 解压后，previewUrl 指向解压目录的入口文件
    let previewUrl = accessUrls.previewUrl;
    if (entity.isExtracted && entity.bundleEntryPath) {
      const extLen = (entity.extension ?? '').length;
      const extractDirRelative =
        extLen > 0 ? entity.storagePath.slice(0, -extLen) : entity.storagePath;
      previewUrl = `${baseUrl}/${extractDirRelative}/${entity.bundleEntryPath}`;
    }

    return {
      id: entity.id,
      originalName: entity.originalName,
      storageKey: entity.storageKey,
      storagePath: entity.storagePath,
      url: accessUrls.url,
      previewUrl,
      mimeType: entity.mimeType,
      size: entity.size,
      extension: entity.extension ?? undefined,
      scene: entity.scene ?? undefined,
      businessType: entity.businessType ?? undefined,
      isTemporary: entity.isTemporary,
      status: entity.status,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
      bundleEntryPath: entity.bundleEntryPath ?? undefined,
      isExtracted: entity.isExtracted,
      description: entity.description ?? undefined,
    };
  }

  /**
   * 获取 zip 文件解压后的文件树（从磁盘扫描）
   */
  async getExtractedFileTree(
    fileRecord: FileRecord,
    zipExtractService: FileZipExtractService,
  ): Promise<FileTreeNode[]> {
    const rootDir = this.getUploadRootDir();
    const extLen = (fileRecord.extension ?? '').length;
    const extractDirRelative =
      extLen > 0 ? fileRecord.storagePath.slice(0, -extLen) : fileRecord.storagePath;
    const extractDirFull = FileUploadUtil.resolveSafePath(rootDir, extractDirRelative);

    if (!fs.existsSync(extractDirFull)) {
      throw new ProjectException('解压目录不存在');
    }

    const entries = this.scanDirectory(extractDirFull, '');
    return zipExtractService.buildFileTree(entries);
  }

  private scanDirectory(
    baseDir: string,
    relativePath: string,
  ): { path: string; size: number; isDirectory: boolean }[] {
    const fullPath = relativePath ? path.join(baseDir, relativePath) : baseDir;
    const dirEntries = fs.readdirSync(fullPath, { withFileTypes: true });
    const result: { path: string; size: number; isDirectory: boolean }[] = [];

    for (const entry of dirEntries) {
      const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        result.push({ path: entryRelativePath, size: 0, isDirectory: true });
        result.push(...this.scanDirectory(baseDir, entryRelativePath));
      } else {
        const stats = fs.statSync(path.join(fullPath, entry.name));
        result.push({ path: entryRelativePath, size: stats.size, isDirectory: false });
      }
    }

    return result;
  }

  private getUploadRootDir(): string {
    return MiddlewareConfigUtil.getString(
      MiddlewareConfigKeys.UploadRootDir,
      DEFAULT_UPLOAD_ROOT_DIR,
    );
  }
}
