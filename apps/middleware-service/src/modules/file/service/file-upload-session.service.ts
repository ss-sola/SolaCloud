import { BaseService, ProjectException } from '@nest-cloud/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { finished } from 'stream/promises';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Not, Repository } from 'typeorm';
import { MiddlewareConfigKeys } from '../../../config-keys';
import { MiddlewareConfigUtil } from '../../../utils/middleware-config.util';
import {
  DEFAULT_UPLOAD_CHUNK_TEMP_ROOT_DIR,
  DEFAULT_UPLOAD_MAX_SIZE_BYTES,
  DEFAULT_UPLOAD_PUBLIC_BASE_URL,
  DEFAULT_UPLOAD_ROOT_DIR,
  DEFAULT_UPLOAD_TEMP_TTL_MS,
  FILE_STATUS,
  FILE_UPLOAD_SESSION_STATUS,
} from '../file.constants';
import { FileItem } from '../entity/file-item.entity';
import { FileUploadSession } from '../entity/file-upload-session.entity';
import { FileUploadCheckForm } from '../form/file-upload-check.form';
import { FileUploadChunkForm } from '../form/file-upload-chunk.form';
import { FileUploadMergeForm } from '../form/file-upload-merge.form';
import {
  CleanupResult,
  FileRecord,
  FileUploadMergeRecord,
  FileUploadProgressRecord,
  FileUploadRedisMeta,
} from '../file.types';
import { FileUploadUtil } from '../utils/file-upload.util';
import { FileStorageService } from './file-storage.service';
import { FileUploadRedisService } from './file-upload-redis.service';
import { FileZipExtractService } from './file-zip-extract.service';
import { FileService } from './file.service';
import { TaskQueueService } from '../../task/service/task-queue.service';
import {
  ATTACHMENT_VECTORIZE_COMPLETE_JOB_NAME,
  ATTACHMENT_VECTORIZE_COMPLETE_QUEUE_NAME,
  ATTACHMENT_VECTORIZE_JOB_NAME,
} from '../../task/task.constants';

@Injectable()
export class FileUploadSessionService extends BaseService<FileUploadSession> {
  private readonly logger = new Logger(FileUploadSessionService.name);

  constructor(
    @InjectRepository(FileUploadSession)
    sessionRepository: Repository<FileUploadSession>,
    private readonly fileService: FileService,
    private readonly fileStorageService: FileStorageService,
    private readonly fileUploadRedisService: FileUploadRedisService,
    private readonly fileZipExtractService: FileZipExtractService,
    private readonly taskQueueService: TaskQueueService,
  ) {
    super(sessionRepository);
  }

  async checkUpload(form: FileUploadCheckForm): Promise<FileUploadProgressRecord> {
    const normalized = this.normalizeCheckForm(form);
    this.validateUploadShape(normalized.totalSize, normalized.chunkSize, normalized.chunkCount);
    const fileId = this.resolveFrontendFileId(normalized);
    const existing = await this.findActiveSession(fileId);
    if (!existing) {
      const uploadId = randomUUID();
      const saved = await this.create({
        uploadId,
        originalName: null,
        mimeType: null,
        totalSize: normalized.totalSize,
        chunkSize: normalized.chunkSize,
        chunkCount: normalized.chunkCount,
        uploadedBytes: 0,
        uploadedChunkCount: 0,
        chunkDirPath: this.fileStorageService.buildChunkDirPath(uploadId),
        fileFingerprint: fileId,
        scene: null,
        businessType: null,
        isTemporary: true,
        status: FILE_UPLOAD_SESSION_STATUS.Pending,
        fileId: null,
        errorMessage: null,
        expiresAt: this.buildExpiresAt(),
      });
      await this.syncRedisSnapshot(fileId, saved, []);
      return this.toProgressRecord(fileId, saved, []);
    }

    this.ensureUploadShapeMatches(existing, normalized);
    const refreshed = await this.refreshSessionProgress(fileId, existing, {
      extendExpiration: true,
    });
    return this.toProgressRecord(fileId, refreshed.session, refreshed.uploadedChunkIndexes);
  }

  async uploadChunk(
    file: Express.Multer.File,
    form: FileUploadChunkForm,
  ): Promise<FileUploadProgressRecord> {
    if (!file) {
      throw new ProjectException('上传文件不能为空', 400);
    }

    const fileId = form.fileId.trim();
    const session = await this.getSessionOrThrow(fileId);
    await this.ensureSessionAvailable(session);
    this.validateChunkIndex(session, form.chunkIndex);
    this.validateChunkSize(session, form.chunkIndex, file.size);

    const savedChunk = await this.fileStorageService.saveChunkBuffer({
      tempRootDir: this.getChunkTempRootDir(),
      chunkDirPath: session.chunkDirPath,
      chunkIndex: form.chunkIndex,
      buffer: file.buffer,
    });

    if (savedChunk.existed && savedChunk.size !== file.size) {
      throw new ProjectException('分片大小不匹配', 400);
    }

    if (
      (!session.mimeType || session.mimeType === 'application/octet-stream') &&
      file.mimetype &&
      file.mimetype !== 'application/octet-stream'
    ) {
      session.mimeType = file.mimetype;
    }
    session.errorMessage = null;

    const refreshed = await this.refreshSessionProgress(fileId, session, {
      extendExpiration: true,
    });
    return this.toProgressRecord(fileId, refreshed.session, refreshed.uploadedChunkIndexes);
  }

  async mergeUpload(form: FileUploadMergeForm): Promise<FileUploadMergeRecord> {
    const fileId = form.fileId.trim();
    const session = await this.getSessionOrThrow(fileId);
    if (session.status === FILE_UPLOAD_SESSION_STATUS.Completed) {
      return this.replayCompletedUpload(fileId, session);
    }

    const lockToken = await this.fileUploadRedisService.acquireMergeLock(fileId, 60_000);
    if (!lockToken) {
      throw new ProjectException('文件正在合并中', 400);
    }

    try {
      // Another request may have finished between reading the session and taking its lease.
      const current = await this.repository.findOneByOrFail({ id: session.id });
      if (current.status === FILE_UPLOAD_SESSION_STATUS.Completed) {
        return await this.replayCompletedUpload(fileId, current);
      }
      await this.ensureSessionAvailable(current);
      const snapshot = await this.buildChunkSnapshot(current);
      if (snapshot.uploadedChunkCount < current.chunkCount) {
        throw new ProjectException('分片尚未上传完成', 400);
      }
      const merging = {
        status: FILE_UPLOAD_SESSION_STATUS.Merging,
        errorMessage: null,
        uploadedBytes: snapshot.uploadedBytes,
        uploadedChunkCount: snapshot.uploadedChunkCount,
      };
      // The Redis lease may have expired during the disk scan.
      const claim = await this.repository.update(
        { id: current.id, status: current.status },
        merging,
      );
      if (!claim.affected) {
        const latest = await this.repository.findOneByOrFail({ id: current.id });
        if (latest.status === FILE_UPLOAD_SESSION_STATUS.Completed) {
          return await this.replayCompletedUpload(fileId, latest);
        }
        throw new ProjectException('上传会话状态已变更，请重试合并', 409);
      }

      const { saved, fileItem } = await this.completeUpload(
        form,
        Object.assign(current, merging),
        snapshot.uploadedChunkIndexes,
      );
      await this.cleanupCompletedUpload(fileId, saved);
      void this.notifyAttachmentDescription(fileItem);
      return this.toMergeRecord(
        fileId,
        saved,
        this.toFileRecord(fileItem),
        snapshot.uploadedChunkIndexes,
      );
    } finally {
      try {
        await this.fileUploadRedisService.releaseMergeLock(fileId, lockToken);
      } catch (error) {
        this.logger.warn(`释放附件合并锁失败，等待租约到期 uploadId=${session.uploadId}: ${error}`);
      }
    }
  }

  private async completeUpload(
    form: FileUploadMergeForm,
    activeSession: FileUploadSession,
    uploadedChunkIndexes: number[],
  ) {
    const fileId = form.fileId.trim();
    let mergedStoragePath: string | undefined;
    try {
      await this.syncRedisSnapshot(fileId, activeSession, uploadedChunkIndexes);

      const mergedOriginalName = form.originalName.trim();
      const mergedMimeType =
        form.mimeType?.trim() || activeSession.mimeType || 'application/octet-stream';
      const mergedScene = form.scene ?? null;
      const mergedBusinessType = form.businessType ?? null;
      const mergedIsTemporary = form.isTemporary ?? true;

      const stored = await this.fileStorageService.mergeChunks({
        tempRootDir: this.getChunkTempRootDir(),
        rootDir: this.getUploadRootDir(),
        chunkDirPath: activeSession.chunkDirPath,
        chunkCount: activeSession.chunkCount,
        originalName: mergedOriginalName,
      });
      mergedStoragePath = stored.storagePath;

      const actualFileHash = await this.calculateStorageHash(stored.storagePath);
      if (actualFileHash !== form.fileHash.trim().toLowerCase()) {
        throw new ProjectException('文件哈希校验失败', 409);
      }

      const fileItem = await this.fileService.create({
        originalName: mergedOriginalName,
        storageKey: stored.storageKey,
        storagePath: stored.storagePath,
        mimeType: mergedMimeType,
        size: activeSession.totalSize,
        extension: stored.extension ?? null,
        scene: mergedScene,
        businessType: mergedBusinessType,
        isTemporary: mergedIsTemporary,
        status: FILE_STATUS.Available,
      });

      // zip 文件自动解压（解压到同名目录供前端浏览）
      if (stored.extension === '.zip') {
        await this.extractZipAfterMerge(fileItem, stored.storagePath);
      }

      activeSession.status = FILE_UPLOAD_SESSION_STATUS.Completed;
      activeSession.originalName = mergedOriginalName;
      activeSession.mimeType = mergedMimeType;
      activeSession.scene = mergedScene;
      activeSession.businessType = mergedBusinessType;
      activeSession.isTemporary = mergedIsTemporary;
      activeSession.uploadedBytes = activeSession.totalSize;
      activeSession.uploadedChunkCount = activeSession.chunkCount;
      activeSession.fileId = fileItem.id;
      activeSession.errorMessage = null;
      activeSession.expiresAt = this.buildExpiresAt();
      const saved = await this.repository.save(activeSession);
      return { saved, fileItem };
    } catch (error) {
      if (mergedStoragePath) {
        await this.fileStorageService.removeStorage({
          rootDir: this.getUploadRootDir(),
          storagePath: mergedStoragePath,
        });
      }
      activeSession.status = FILE_UPLOAD_SESSION_STATUS.Failed;
      activeSession.errorMessage = error instanceof Error ? error.message : '文件合并失败';
      const saved = await this.repository.save(activeSession);
      await this.syncRedisSnapshot(fileId, saved, uploadedChunkIndexes);
      if (error instanceof ProjectException) {
        throw error;
      }
      throw new ProjectException('文件合并失败', 500);
    }
  }

  private async replayCompletedUpload(fileId: string, session: FileUploadSession) {
    const file = await this.getMergedFileRecord(session);
    await this.cleanupCompletedUpload(fileId, session);
    return this.toMergeRecord(fileId, session, file);
  }

  private async cleanupCompletedUpload(fileId: string, session: FileUploadSession) {
    try {
      await this.fileStorageService.removeChunkDir({
        tempRootDir: this.getChunkTempRootDir(),
        chunkDirPath: session.chunkDirPath,
      });
    } catch (error) {
      this.logger.warn(`清理已完成附件的分片失败 uploadId=${session.uploadId}: ${error}`);
    }
    try {
      await this.fileUploadRedisService.deleteUpload(fileId, session.uploadId);
    } catch (error) {
      this.logger.warn(`清理已完成附件的快照失败 uploadId=${session.uploadId}: ${error}`);
    }
  }

  async cleanupExpiredUploadSessions(): Promise<CleanupResult> {
    const expiredSessions = await this.repository.find({
      where: {
        expiresAt: LessThan(new Date()),
        status: Not(FILE_UPLOAD_SESSION_STATUS.Completed),
      },
    });

    let removed = 0;
    let failed = 0;
    for (const session of expiredSessions) {
      try {
        await this.fileStorageService.removeChunkDir({
          tempRootDir: this.getChunkTempRootDir(),
          chunkDirPath: session.chunkDirPath,
        });
        if (session.fileFingerprint) {
          await this.fileUploadRedisService.deleteUpload(session.fileFingerprint, session.uploadId);
        }
        await this.delete(session.id);
        removed += 1;
      } catch {
        failed += 1;
      }
    }

    return {
      matched: expiredSessions.length,
      removed,
      failed,
    };
  }

  private normalizeCheckForm(form: FileUploadCheckForm) {
    return {
      ...form,
      fileId: form.fileId.trim(),
      sourceHash: form.sourceHash.trim().toLowerCase(),
    };
  }

  private validateUploadShape(totalSize: number, chunkSize: number, chunkCount: number) {
    const maxSizeBytes = MiddlewareConfigUtil.getNumber(
      MiddlewareConfigKeys.UploadMaxSizeBytes,
      DEFAULT_UPLOAD_MAX_SIZE_BYTES,
    );
    if (totalSize > maxSizeBytes) {
      throw new ProjectException('文件大小超出限制', 400);
    }
    if (chunkSize > maxSizeBytes) {
      throw new ProjectException('分片大小超出限制', 400);
    }
    const expectedChunkCount = Math.ceil(totalSize / chunkSize);
    if (chunkCount !== expectedChunkCount) {
      throw new ProjectException('分片数量与文件大小不匹配', 400);
    }
  }

  private resolveFrontendFileId(form: ReturnType<FileUploadSessionService['normalizeCheckForm']>) {
    const expectedSuffix = `:${form.sourceHash}`;
    if (!form.fileId.endsWith(expectedSuffix) || form.fileId.length <= expectedSuffix.length) {
      throw new ProjectException('fileId 与 sourceHash 不匹配', 400);
    }
    return form.fileId;
  }

  private async findActiveSession(fileId: string) {
    const redisMeta = await this.readCachedMeta(fileId);
    if (redisMeta?.uploadId) {
      const redisSession = await this.repository.findOne({
        where: { uploadId: redisMeta.uploadId },
      });
      if (
        redisSession &&
        !this.isExpired(redisSession) &&
        redisSession.status !== FILE_UPLOAD_SESSION_STATUS.Completed &&
        redisSession.status !== FILE_UPLOAD_SESSION_STATUS.Merging
      ) {
        return redisSession;
      }
    }

    const sessions = await this.repository.find({
      where: { fileFingerprint: fileId },
      order: { id: 'DESC' },
    });
    return sessions.find(
      (session) =>
        !this.isExpired(session) &&
        session.status !== FILE_UPLOAD_SESSION_STATUS.Completed &&
        session.status !== FILE_UPLOAD_SESSION_STATUS.Merging,
    );
  }

  private ensureUploadShapeMatches(
    session: FileUploadSession,
    form: ReturnType<FileUploadSessionService['normalizeCheckForm']>,
  ) {
    if (
      session.totalSize !== form.totalSize ||
      session.chunkSize !== form.chunkSize ||
      session.chunkCount !== form.chunkCount
    ) {
      throw new ProjectException('同一文件已使用其他分片配置上传', 409);
    }
  }

  private readCachedMeta(fileId: string) {
    return this.fileUploadRedisService.getMeta(fileId).catch((error) => {
      this.logger.warn(`读取上传快照失败，从数据库查找会话: ${error}`);
      return undefined;
    });
  }

  private async getSessionOrThrow(fileId: string) {
    const normalizedFileId = fileId.trim();
    const redisMeta = await this.readCachedMeta(normalizedFileId);
    if (redisMeta?.uploadId) {
      const session = await this.repository.findOne({
        where: { uploadId: redisMeta.uploadId },
      });
      if (session) {
        return session;
      }
    }

    const sessions = await this.repository.find({
      where: { fileFingerprint: normalizedFileId },
      order: { id: 'DESC' },
    });
    const session = sessions.find((item) => !this.isExpired(item)) ?? sessions[0];
    if (!session) {
      throw new ProjectException('上传会话不存在', 404);
    }
    return session;
  }

  private async getMergedFileRecord(session: FileUploadSession) {
    if (!session.fileId) {
      throw new ProjectException('合并文件不存在', 404);
    }
    const entity = await this.fileService.findOne(session.fileId);
    if (!entity) {
      throw new ProjectException('合并文件不存在', 404);
    }
    return this.toFileRecord(entity);
  }

  private async ensureSessionAvailable(session: FileUploadSession) {
    if (this.isExpired(session)) {
      session.status = FILE_UPLOAD_SESSION_STATUS.Expired;
      session.errorMessage = '上传会话已过期';
      await this.repository.save(session);
      throw new ProjectException('上传会话已过期', 410);
    }
    if (session.status === FILE_UPLOAD_SESSION_STATUS.Completed) {
      throw new ProjectException('上传会话已完成', 400);
    }
    if (session.status === FILE_UPLOAD_SESSION_STATUS.Merging) {
      throw new ProjectException('文件正在合并中', 400);
    }
  }

  private validateChunkIndex(session: FileUploadSession, chunkIndex: number) {
    if (chunkIndex < 0 || chunkIndex >= session.chunkCount) {
      throw new ProjectException('分片序号不合法', 400);
    }
  }

  private validateChunkSize(session: FileUploadSession, chunkIndex: number, chunkSize: number) {
    const expectedSize = this.getExpectedChunkSize(session, chunkIndex);
    if (chunkSize !== expectedSize) {
      throw new ProjectException('分片大小不正确', 400);
    }
  }

  private getExpectedChunkSize(session: FileUploadSession, chunkIndex: number): number {
    return chunkIndex === session.chunkCount - 1
      ? session.totalSize - session.chunkSize * (session.chunkCount - 1)
      : session.chunkSize;
  }

  private async buildChunkSnapshot(session: FileUploadSession) {
    const chunkRecords = await this.fileStorageService.listUploadedChunks({
      tempRootDir: this.getChunkTempRootDir(),
      chunkDirPath: session.chunkDirPath,
    });
    const uploadedChunkIndexes: number[] = [];
    let uploadedBytes = 0;

    for (const chunkRecord of chunkRecords) {
      if (chunkRecord.chunkIndex < 0 || chunkRecord.chunkIndex >= session.chunkCount) {
        continue;
      }
      if (chunkRecord.size !== this.getExpectedChunkSize(session, chunkRecord.chunkIndex)) {
        continue;
      }
      uploadedChunkIndexes.push(chunkRecord.chunkIndex);
      uploadedBytes += chunkRecord.size;
    }

    return {
      uploadedChunkIndexes,
      uploadedChunkCount: uploadedChunkIndexes.length,
      uploadedBytes: Math.min(session.totalSize, uploadedBytes),
    };
  }

  private async refreshSessionProgress(
    fileId: string,
    session: FileUploadSession,
    options: { extendExpiration?: boolean } = {},
  ) {
    const snapshot = await this.buildChunkSnapshot(session);
    const nextStatus = this.resolveSnapshotStatus(session, snapshot.uploadedChunkCount);
    const nextErrorMessage =
      nextStatus === FILE_UPLOAD_SESSION_STATUS.Expired ? session.errorMessage : null;
    const nextExpiresAt = options.extendExpiration ? this.buildExpiresAt() : session.expiresAt;
    const shouldSave =
      session.uploadedBytes !== snapshot.uploadedBytes ||
      session.uploadedChunkCount !== snapshot.uploadedChunkCount ||
      session.status !== nextStatus ||
      session.errorMessage !== nextErrorMessage ||
      session.expiresAt.getTime() !== nextExpiresAt.getTime();

    const activeSession = shouldSave
      ? await this.repository.save({
          ...session,
          uploadedBytes: snapshot.uploadedBytes,
          uploadedChunkCount: snapshot.uploadedChunkCount,
          status: nextStatus,
          errorMessage: nextErrorMessage,
          expiresAt: nextExpiresAt,
        })
      : session;

    await this.syncRedisSnapshot(fileId, activeSession, snapshot.uploadedChunkIndexes);
    return {
      session: activeSession,
      uploadedChunkIndexes: snapshot.uploadedChunkIndexes,
    };
  }

  private resolveSnapshotStatus(session: FileUploadSession, uploadedChunkCount: number) {
    if (this.isExpired(session)) {
      return FILE_UPLOAD_SESSION_STATUS.Expired;
    }
    if (session.status === FILE_UPLOAD_SESSION_STATUS.Completed) {
      return FILE_UPLOAD_SESSION_STATUS.Completed;
    }
    if (session.status === FILE_UPLOAD_SESSION_STATUS.Merging) {
      return FILE_UPLOAD_SESSION_STATUS.Merging;
    }
    if (uploadedChunkCount >= session.chunkCount) {
      return FILE_UPLOAD_SESSION_STATUS.ReadyToMerge;
    }
    if (uploadedChunkCount > 0) {
      return FILE_UPLOAD_SESSION_STATUS.Uploading;
    }
    if (session.status === FILE_UPLOAD_SESSION_STATUS.Failed) {
      return FILE_UPLOAD_SESSION_STATUS.Failed;
    }
    return FILE_UPLOAD_SESSION_STATUS.Pending;
  }

  private async syncRedisSnapshot(
    fileId: string,
    session: FileUploadSession,
    uploadedChunkIndexes: number[],
  ) {
    await this.fileUploadRedisService.saveSnapshot({
      meta: this.toRedisMeta(fileId, session),
      uploadedChunkIndexes,
      ttlMs: this.getUploadTempTtlMs(),
    });
  }

  private toRedisMeta(fileId: string, session: FileUploadSession): FileUploadRedisMeta {
    return {
      fileId,
      uploadId: session.uploadId,
      chunkDirPath: session.chunkDirPath,
      originalName: session.originalName ?? undefined,
      mimeType: session.mimeType ?? undefined,
      totalSize: session.totalSize,
      chunkSize: session.chunkSize,
      chunkCount: session.chunkCount,
      uploadedBytes: session.uploadedBytes,
      uploadedChunkCount: session.uploadedChunkCount,
      status: session.status,
      scene: session.scene ?? undefined,
      businessType: session.businessType ?? undefined,
      isTemporary: session.isTemporary,
      errorMessage: session.errorMessage ?? undefined,
      updatedAt: session.updatedAt.toISOString(),
    };
  }

  private toProgressRecord(
    fileId: string,
    session: FileUploadSession,
    uploadedChunkIndexes?: number[],
  ): FileUploadProgressRecord {
    return {
      fileId,
      uploadId: session.uploadId,
      status: session.status,
      totalSize: session.totalSize,
      uploadedBytes: session.uploadedBytes,
      chunkSize: session.chunkSize,
      chunkCount: session.chunkCount,
      uploadedChunkCount: session.uploadedChunkCount,
      uploadedChunkIndexes,
      percent: FileUploadUtil.calculateUploadPercent(session.uploadedBytes, session.totalSize),
      canMerge:
        session.uploadedChunkCount >= session.chunkCount &&
        session.status !== FILE_UPLOAD_SESSION_STATUS.Merging &&
        session.status !== FILE_UPLOAD_SESSION_STATUS.Completed &&
        session.status !== FILE_UPLOAD_SESSION_STATUS.Expired &&
        session.status !== FILE_UPLOAD_SESSION_STATUS.Failed,
      mergedFileId: session.fileId ?? undefined,
      errorMessage: session.errorMessage ?? undefined,
    };
  }

  private toMergeRecord(
    fileId: string,
    session: FileUploadSession,
    file?: FileRecord,
    uploadedChunkIndexes?: number[],
  ): FileUploadMergeRecord {
    return {
      ...this.toProgressRecord(fileId, session, uploadedChunkIndexes),
      ...(file ? { file } : {}),
    };
  }

  private toFileRecord(entity: FileItem): FileRecord {
    const accessUrls = this.fileStorageService.buildAccessUrls(entity.storagePath);

    return {
      id: entity.id,
      originalName: entity.originalName,
      storageKey: entity.storageKey,
      storagePath: entity.storagePath,
      url: accessUrls.url,
      previewUrl: accessUrls.previewUrl,
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

  private async calculateStorageHash(storagePath: string) {
    const fullPath = FileUploadUtil.resolveSafePath(this.getUploadRootDir(), storagePath);
    const hash = createHash('sha256');
    const readStream = createReadStream(fullPath);
    readStream.on('data', (chunk) => {
      hash.update(chunk);
    });
    await finished(readStream);
    return hash.digest('hex');
  }

  private getUploadRootDir() {
    return MiddlewareConfigUtil.getString(
      MiddlewareConfigKeys.UploadRootDir,
      DEFAULT_UPLOAD_ROOT_DIR,
    );
  }

  private getChunkTempRootDir() {
    return MiddlewareConfigUtil.getString(
      MiddlewareConfigKeys.UploadChunkTempRootDir,
      DEFAULT_UPLOAD_CHUNK_TEMP_ROOT_DIR,
    );
  }

  private getUploadTempTtlMs() {
    return MiddlewareConfigUtil.getNumber(
      MiddlewareConfigKeys.UploadTempTtlMs,
      DEFAULT_UPLOAD_TEMP_TTL_MS,
    );
  }

  private buildExpiresAt() {
    return new Date(Date.now() + this.getUploadTempTtlMs());
  }

  private isExpired(session: FileUploadSession) {
    return session.expiresAt.getTime() <= Date.now();
  }

  /**
   * zip 文件合并后解压到同名目录，并识别 3D 模型入口文件
   */
  private async extractZipAfterMerge(fileItem: FileItem, storagePath: string) {
    const rootDir = this.getUploadRootDir();
    const zipFullPath = FileUploadUtil.resolveSafePath(rootDir, storagePath);
    // 解压目录：去掉扩展名作为目录名
    const extLen = (fileItem.extension ?? '').length;
    const extractDirRelative = extLen > 0 ? storagePath.slice(0, -extLen) : storagePath;
    const extractDirFull = FileUploadUtil.resolveSafePath(rootDir, extractDirRelative);

    try {
      const entries = await this.fileZipExtractService.extractZip(zipFullPath, extractDirFull);
      const entryFile = this.fileZipExtractService.findModelEntryFile(entries);

      fileItem.isExtracted = true;
      fileItem.bundleEntryPath = entryFile;
      await this.fileService.update(fileItem.id, {
        isExtracted: true,
        bundleEntryPath: entryFile,
      });
    } catch {
      // 解压失败不影响文件上传结果，记录标记但不抛出
      fileItem.isExtracted = false;
      fileItem.bundleEntryPath = null;
      await this.fileService.update(fileItem.id, {
        isExtracted: false,
        bundleEntryPath: null,
      });
    }
  }

  /** 异步通知 RAG 服务生成附件描述，描述生成后触发向量化 */
  private async notifyAttachmentDescription(fileItem: FileItem): Promise<void> {
    try {
      const fileUrl = this.fileStorageService.buildAccessUrls(fileItem.storagePath);
      const result = await this.taskQueueService.addJob(ATTACHMENT_VECTORIZE_JOB_NAME, {
        fileId: fileItem.id,
        fileUrl: fileUrl.previewUrl,
        mimeType: fileItem.mimeType,
        fileName: fileItem.originalName,
      });
      this.logger.log(`Queued attachment description: fileId=${fileItem.id} jobId=${result.id}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to queue attachment description: fileId=${fileItem.id} - ${msg}`);
    }
  }
}
