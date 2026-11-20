import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, readdir, rm, stat, unlink, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { finished } from 'stream/promises';
import { MiddlewareConfigKeys } from '../../../config-keys';
import { MiddlewareConfigUtil } from '../../../utils/middleware-config.util';
import {
  DEFAULT_UPLOAD_CHUNK_TEMP_ROOT_DIR,
  DEFAULT_UPLOAD_PUBLIC_BASE_URL,
  DEFAULT_UPLOAD_ROOT_DIR,
} from '../file.constants';
import { ChunkSaveResult, StoredFile, UploadedChunkRecord } from '../file.types';
import { FileUploadUtil } from '../utils/file-upload.util';

@Injectable()
export class FileStorageService {
  buildStorageKey(originalName: string): string {
    const extension = FileUploadUtil.getSafeExtension(originalName);
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    return `${day}/${randomUUID()}${extension ?? ''}`;
  }

  buildChunkDirPath(uploadId: string): string {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    return `${day}/${uploadId}`;
  }

  async saveChunkBuffer(options: {
    tempRootDir?: string;
    chunkDirPath: string;
    chunkIndex: number;
    buffer: Buffer;
  }): Promise<ChunkSaveResult> {
    const tempRootDir = options.tempRootDir ?? DEFAULT_UPLOAD_CHUNK_TEMP_ROOT_DIR;
    const relativePath = this.getChunkRelativePath(options.chunkDirPath, options.chunkIndex);
    const fullPath = FileUploadUtil.resolveSafePath(tempRootDir, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });

    const existing = await stat(fullPath).catch(() => undefined);
    if (existing) {
      return {
        existed: true,
        size: existing.size,
      };
    }

    await writeFile(fullPath, options.buffer);
    return {
      existed: false,
      size: options.buffer.length,
    };
  }

  async hasChunk(options: { tempRootDir?: string; chunkDirPath: string; chunkIndex: number }) {
    const tempRootDir = options.tempRootDir ?? DEFAULT_UPLOAD_CHUNK_TEMP_ROOT_DIR;
    const relativePath = this.getChunkRelativePath(options.chunkDirPath, options.chunkIndex);
    const fullPath = FileUploadUtil.resolveSafePath(tempRootDir, relativePath);
    return Boolean(await stat(fullPath).catch(() => undefined));
  }

  async listUploadedChunks(options: {
    tempRootDir?: string;
    chunkDirPath: string;
  }): Promise<UploadedChunkRecord[]> {
    const tempRootDir = options.tempRootDir ?? DEFAULT_UPLOAD_CHUNK_TEMP_ROOT_DIR;
    const chunkDirFullPath = FileUploadUtil.resolveSafePath(tempRootDir, options.chunkDirPath);
    const entries = await readdir(chunkDirFullPath, {
      withFileTypes: true,
    }).catch(() => undefined);
    if (!entries) {
      return [];
    }

    const chunkRecords = await Promise.all(
      entries.map(async (entry) => {
        if (!entry.isFile()) {
          return undefined;
        }
        const chunkIndex = FileUploadUtil.parseChunkFileName(entry.name);
        if (chunkIndex === undefined) {
          return undefined;
        }
        const fullPath = FileUploadUtil.resolveSafePath(chunkDirFullPath, entry.name);
        const info = await stat(fullPath).catch(() => undefined);
        if (!info?.isFile()) {
          return undefined;
        }
        return {
          chunkIndex,
          size: info.size,
        } satisfies UploadedChunkRecord;
      }),
    );

    return chunkRecords
      .filter((item): item is UploadedChunkRecord => Boolean(item))
      .sort((left, right) => left.chunkIndex - right.chunkIndex);
  }

  async mergeChunks(options: {
    tempRootDir?: string;
    rootDir?: string;
    chunkDirPath: string;
    chunkCount: number;
    originalName: string;
  }): Promise<StoredFile> {
    const rootDir = options.rootDir ?? DEFAULT_UPLOAD_ROOT_DIR;
    const tempRootDir = options.tempRootDir ?? DEFAULT_UPLOAD_CHUNK_TEMP_ROOT_DIR;
    const storageKey = this.buildStorageKey(options.originalName);
    const fullPath = FileUploadUtil.resolveSafePath(rootDir, storageKey);
    await mkdir(dirname(fullPath), { recursive: true });

    const writeStream = createWriteStream(fullPath);
    try {
      for (let chunkIndex = 0; chunkIndex < options.chunkCount; chunkIndex += 1) {
        const chunkRelativePath = this.getChunkRelativePath(options.chunkDirPath, chunkIndex);
        const chunkFullPath = FileUploadUtil.resolveSafePath(tempRootDir, chunkRelativePath);
        await this.appendChunk(writeStream, chunkFullPath);
      }
      writeStream.end();
      await finished(writeStream);
      return {
        storageKey,
        storagePath: storageKey,
        extension: FileUploadUtil.getSafeExtension(options.originalName),
      };
    } catch (error) {
      writeStream.destroy();
      await unlink(fullPath).catch(() => undefined);
      throw error;
    }
  }

  buildAccessUrls(storagePath: string, publicBaseUrl?: string) {
    const baseUrl =
      publicBaseUrl ??
      MiddlewareConfigUtil.getString(
        MiddlewareConfigKeys.UploadPublicBaseUrl,
        DEFAULT_UPLOAD_PUBLIC_BASE_URL,
      );
    const servicePublicBaseUrl = MiddlewareConfigUtil.getOptionalString(
      MiddlewareConfigKeys.ServicePublicBaseUrl,
    );
    const url = FileUploadUtil.toFullAccessUrl(baseUrl, storagePath, () => servicePublicBaseUrl);
    return {
      url,
      previewUrl: url,
    };
  }

  async removeStorage(options: { rootDir?: string; storagePath: string }) {
    const rootDir = options.rootDir ?? DEFAULT_UPLOAD_ROOT_DIR;
    const fullPath = FileUploadUtil.resolveSafePath(rootDir, options.storagePath);

    // 尝试删除文件
    await unlink(fullPath).catch(() => undefined);

    // 如果是可解压文件，同时删除解压目录
    const lowerPath = options.storagePath.toLowerCase();
    if (lowerPath.endsWith('.zip')) {
      const extractDirPath = options.storagePath.slice(0, -4);
      const extractFullPath = FileUploadUtil.resolveSafePath(rootDir, extractDirPath);
      await rm(extractFullPath, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async removeChunkDir(options: { tempRootDir?: string; chunkDirPath: string }) {
    const tempRootDir = options.tempRootDir ?? DEFAULT_UPLOAD_CHUNK_TEMP_ROOT_DIR;
    const fullPath = FileUploadUtil.resolveSafePath(tempRootDir, options.chunkDirPath);
    await rm(fullPath, { recursive: true, force: true }).catch(() => undefined);
  }

  private async appendChunk(
    writeStream: ReturnType<typeof createWriteStream>,
    chunkFullPath: string,
  ) {
    await new Promise<void>((resolve, reject) => {
      const readStream = createReadStream(chunkFullPath);
      const handleError = (error: Error) => {
        readStream.destroy();
        writeStream.removeListener('error', handleError);
        reject(error);
      };

      readStream.on('error', handleError);
      writeStream.once('error', handleError);
      readStream.on('end', () => {
        writeStream.removeListener('error', handleError);
        resolve();
      });
      readStream.pipe(writeStream, { end: false });
    });
  }

  private getChunkRelativePath(chunkDirPath: string, chunkIndex: number): string {
    return `${chunkDirPath}/${FileUploadUtil.buildChunkFileName(chunkIndex)}`;
  }
}
