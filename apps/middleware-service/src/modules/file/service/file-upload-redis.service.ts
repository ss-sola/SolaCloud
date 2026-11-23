import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { MiddlewareConfigKeys } from '../../../config-keys';
import { MiddlewareConfigUtil } from '../../../utils/middleware-config.util';
import { DEFAULT_FILE_UPLOAD_REDIS_PREFIX } from '../file.constants';
import { FileUploadRedisMeta } from '../file.types';
import { TaskQueueService } from '../../task/service/task-queue.service';

@Injectable()
export class FileUploadRedisService implements OnModuleDestroy {
  private readonly cleanupRedis: Redis;

  constructor(private readonly taskQueueService: TaskQueueService) {
    // The worker connection retries indefinitely. Reads and cleanup on the HTTP path must finish.
    this.cleanupRedis = taskQueueService.getConnection().duplicate({
      commandTimeout: 2_000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  }

  onModuleDestroy() {
    this.cleanupRedis.disconnect();
  }

  async getMeta(fileId: string): Promise<FileUploadRedisMeta | undefined> {
    const payload = await this.cleanupRedis.hgetall(this.buildMetaKey(fileId));
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

  async deleteUpload(fileId: string, uploadId: string) {
    // A new session may already have reused the same frontend fileId.
    await this.cleanupRedis.eval(
      "if redis.call('HGET', KEYS[1], 'uploadId') == ARGV[1] then return redis.call('DEL', KEYS[1], KEYS[2]) end return 0",
      2,
      this.buildMetaKey(fileId),
      this.buildChunksKey(fileId),
      uploadId,
    );
  }

  async acquireMergeLock(fileId: string, ttlMs: number) {
    const token = randomUUID();
    const result = await this.taskQueueService
      .getConnection()
      .set(this.buildLockKey(fileId), token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  async releaseMergeLock(fileId: string, token: string) {
    await this.cleanupRedis.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
      1,
      this.buildLockKey(fileId),
      token,
    );
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
