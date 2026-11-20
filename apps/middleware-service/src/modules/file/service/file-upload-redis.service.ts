import { Injectable } from '@nestjs/common';
import { MiddlewareConfigKeys } from '../../../config-keys';
import { MiddlewareConfigUtil } from '../../../utils/middleware-config.util';
import { DEFAULT_FILE_UPLOAD_REDIS_PREFIX } from '../file.constants';
import { FileUploadRedisMeta } from '../file.types';
import { TaskQueueService } from '../../task/service/task-queue.service';

@Injectable()
export class FileUploadRedisService {
  constructor(private readonly taskQueueService: TaskQueueService) {}

  async getMeta(fileId: string): Promise<FileUploadRedisMeta | undefined> {
    const payload = await this.taskQueueService.getConnection().hgetall(this.buildMetaKey(fileId));
    if (!payload || Object.keys(payload).length === 0) {
      return undefined;
    }
    return {
      fileId,
      uploadId: payload.uploadId,
      chunkDirPath: payload.chunkDirPath,
      originalName: payload.originalName || undefined,
      mimeType: payload.mimeType || undefined,
      totalSize: Number(payload.totalSize || 0),
      chunkSize: Number(payload.chunkSize || 0),
      chunkCount: Number(payload.chunkCount || 0),
      uploadedBytes: Number(payload.uploadedBytes || 0),
      uploadedChunkCount: Number(payload.uploadedChunkCount || 0),
      status: payload.status as FileUploadRedisMeta['status'],
      scene: payload.scene || undefined,
      businessType: payload.businessType || undefined,
      isTemporary: payload.isTemporary === 'true',
      errorMessage: payload.errorMessage || undefined,
      updatedAt: payload.updatedAt || new Date(0).toISOString(),
    };
  }

  async getUploadedChunkIndexes(fileId: string) {
    const fields = await this.taskQueueService.getConnection().hkeys(this.buildChunksKey(fileId));
    return fields
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0)
      .sort((left, right) => left - right);
  }

  async saveSnapshot(options: {
    meta: FileUploadRedisMeta;
    uploadedChunkIndexes: number[];
    ttlMs: number;
  }) {
    const redis = this.taskQueueService.getConnection();
    const metaKey = this.buildMetaKey(options.meta.fileId);
    const chunksKey = this.buildChunksKey(options.meta.fileId);
    const pipeline = redis.pipeline();
    pipeline.del(metaKey);
    pipeline.hset(metaKey, this.serializeMeta(options.meta));
    pipeline.pexpire(metaKey, options.ttlMs);
    pipeline.del(chunksKey);
    if (options.uploadedChunkIndexes.length > 0) {
      pipeline.hset(
        chunksKey,
        Object.fromEntries(
          options.uploadedChunkIndexes.map((chunkIndex) => [String(chunkIndex), '1']),
        ),
      );
      pipeline.pexpire(chunksKey, options.ttlMs);
    }
    await pipeline.exec();
  }

  async deleteUpload(fileId: string) {
    const redis = this.taskQueueService.getConnection();
    await redis.del(
      this.buildMetaKey(fileId),
      this.buildChunksKey(fileId),
      this.buildLockKey(fileId),
    );
  }

  async acquireMergeLock(fileId: string, ttlMs: number) {
    const result = await this.taskQueueService
      .getConnection()
      .set(this.buildLockKey(fileId), '1', 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  async releaseMergeLock(fileId: string) {
    await this.taskQueueService.getConnection().del(this.buildLockKey(fileId));
  }

  private buildMetaKey(fileId: string) {
    return `${this.getPrefix()}:meta:${fileId}`;
  }

  private buildChunksKey(fileId: string) {
    return `${this.getPrefix()}:chunks:${fileId}`;
  }

  private buildLockKey(fileId: string) {
    return `${this.getPrefix()}:lock:${fileId}`;
  }

  private getPrefix() {
    return MiddlewareConfigUtil.getString(
      MiddlewareConfigKeys.FileUploadRedisPrefix,
      DEFAULT_FILE_UPLOAD_REDIS_PREFIX,
    );
  }

  private serializeMeta(meta: FileUploadRedisMeta) {
    return {
      uploadId: meta.uploadId,
      chunkDirPath: meta.chunkDirPath,
      originalName: meta.originalName,
      mimeType: meta.mimeType,
      totalSize: String(meta.totalSize),
      chunkSize: String(meta.chunkSize),
      chunkCount: String(meta.chunkCount),
      uploadedBytes: String(meta.uploadedBytes),
      uploadedChunkCount: String(meta.uploadedChunkCount),
      status: meta.status,
      scene: meta.scene ?? '',
      businessType: meta.businessType ?? '',
      isTemporary: String(meta.isTemporary),
      errorMessage: meta.errorMessage ?? '',
      updatedAt: meta.updatedAt,
    };
  }
}
