import { ApiClient, type ApiResponse } from './apiClient';

const DEFAULT_CHUNK_SIZE = 1024 * 1024 * 2;
const SPEED_SAMPLE_WINDOW_MS = 4000;
const FRONTEND_UPLOAD_SESSION_STORAGE_KEY = 'resumable-upload.session-id';

type UploadStatus =
  | 'pending'
  | 'uploading'
  | 'ready-to-merge'
  | 'merging'
  | 'completed'
  | 'failed'
  | 'expired';

export interface UploadedFileRecord {
  id?: number;
  url?: string;
  previewUrl?: string;
  originalName?: string;
  storagePath?: string;
  mimeType?: string;
  size?: number;
}

export interface UploadProgressSnapshot {
  fileId: string;
  uploadId: string;
  uploadedBytes: number;
  totalBytes: number;
  percent: number;
  uploadedChunkIndexes: number[];
  bytesPerSecond: number;
}

interface UploadProgressRecord {
  fileId: string;
  uploadId: string;
  status: UploadStatus;
  totalSize: number;
  uploadedBytes: number;
  chunkSize: number;
  chunkCount: number;
  uploadedChunkCount: number;
  uploadedChunkIndexes?: number[];
  percent: number;
  canMerge: boolean;
  mergedFileId?: number;
  errorMessage?: string;
}

interface UploadMergeRecord extends UploadProgressRecord {
  file?: UploadedFileRecord;
}

interface UploadCheckRequest {
  fileId: string;
  totalSize: number;
  chunkSize: number;
  chunkCount: number;
  sourceHash: string;
}

interface UploadMergeRequest {
  fileId: string;
  fileHash: string;
  originalName: string;
  mimeType?: string;
  scene?: string;
  businessType?: string;
  isTemporary?: boolean;
}

type HashWorkerResponse = { type: 'done'; fileHash: string } | { type: 'error'; message: string };

export interface ResumableUploadOptions {
  uploadUrl: string;
  file: File;
  scene?: string;
  businessType?: string;
  isTemporary?: boolean;
  chunkSize?: number;
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgressSnapshot) => void;
}

export function buildResumableUploadUrls(uploadUrl: string) {
  const normalizedUploadUrl = uploadUrl.replace(/\/+$/, '');
  return {
    uploadUrl: normalizedUploadUrl,
    checkUrl: `${normalizedUploadUrl}/check`,
    mergeUrl: `${normalizedUploadUrl}/merge`,
  };
}

export class ResumableUploader {
  private readonly urls;
  private readonly chunkSize: number;
  private readonly chunkCount: number;
  private readonly abortController = new AbortController();
  private readonly speedSamples: Array<{ at: number; bytes: number }> = [];
  private progressRecord?: UploadProgressRecord;

  constructor(private readonly options: ResumableUploadOptions) {
    this.urls = buildResumableUploadUrls(options.uploadUrl);
    this.chunkSize = resolveChunkSize(options.file.size, options.chunkSize);
    this.chunkCount = Math.max(1, Math.ceil(options.file.size / this.chunkSize));
    if (options.signal?.aborted) {
      this.abort();
    } else {
      options.signal?.addEventListener('abort', () => this.abort(), { once: true });
    }
  }

  async prepare() {
    const sourceHash = await buildSourceHash(this.options.file);
    const fileId = buildFrontendFileId(sourceHash);
    const progressRecord = await ApiClient.post<UploadProgressRecord>(this.urls.checkUrl, {
      fileId,
      totalSize: this.options.file.size,
      chunkSize: this.chunkSize,
      chunkCount: this.chunkCount,
      sourceHash,
    } satisfies UploadCheckRequest);
    if (progressRecord.fileId !== fileId) {
      throw new Error('上传接口返回的 fileId 与请求不一致');
    }
    this.progressRecord = withChunkIndexes(progressRecord);
    this.emitProgress(this.progressRecord);
    return this.progressRecord;
  }

  async start(): Promise<UploadedFileRecord> {
    const hashPromise = this.computeFileHash();
    let progressRecord = await this.prepare();
    for (let chunkIndex = 0; chunkIndex < this.chunkCount; chunkIndex += 1) {
      if ((progressRecord.uploadedChunkIndexes ?? []).includes(chunkIndex)) {
        continue;
      }
      const chunkFile = createChunkFile(this.options.file, chunkIndex, this.chunkSize);
      progressRecord = await this.uploadChunkWithProgress(chunkIndex, chunkFile);
      this.progressRecord = progressRecord;
      this.emitProgress(progressRecord);
    }

    const fileHash = await hashPromise;
    const merged = await ApiClient.post<UploadMergeRecord>(this.urls.mergeUrl, {
      fileId: progressRecord.fileId,
      fileHash,
      originalName: this.options.file.name,
      mimeType: this.options.file.type || undefined,
      scene: this.options.scene,
      businessType: this.options.businessType,
      isTemporary: this.options.isTemporary,
    } satisfies UploadMergeRequest);
    if (!merged.file?.url) {
      throw new Error('上传接口未返回文件 URL');
    }

    const completedRecord = withChunkIndexes({
      ...progressRecord,
      status: 'completed',
      uploadedBytes: this.options.file.size,
      percent: 100,
      uploadedChunkIndexes: buildAllChunkIndexes(this.chunkCount),
      canMerge: false,
    });
    this.progressRecord = completedRecord;
    this.emitProgress(completedRecord);
    return merged.file;
  }

  abort() {
    if (!this.abortController.signal.aborted) {
      this.abortController.abort();
    }
  }

  private async computeFileHash() {
    if (this.abortController.signal.aborted) {
      throw new DOMException('Upload aborted', 'AbortError');
    }
    return await new Promise<string>((resolve, reject) => {
      const worker = new Worker(new URL('./resumableUploadHash.worker.ts', import.meta.url), {
        type: 'module',
      });
      const handleAbort = () => {
        worker.terminate();
        reject(new DOMException('Upload aborted', 'AbortError'));
      };
      const cleanup = () => {
        worker.removeEventListener('message', handleMessage);
        worker.removeEventListener('error', handleError);
        this.abortController.signal.removeEventListener('abort', handleAbort);
      };
      const handleMessage = (event: MessageEvent<HashWorkerResponse>) => {
        cleanup();
        worker.terminate();
        if (event.data.type === 'done') {
          resolve(event.data.fileHash);
          return;
        }
        reject(new Error(event.data.message));
      };
      const handleError = () => {
        cleanup();
        worker.terminate();
        reject(new Error('文件哈希计算失败'));
      };
      this.abortController.signal.addEventListener('abort', handleAbort, { once: true });
      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', handleError);
      worker.postMessage({
        file: this.options.file,
        chunkSize: this.chunkSize,
      });
    });
  }

  private async uploadChunkWithProgress(chunkIndex: number, chunkFile: File) {
    if (!this.progressRecord) {
      throw new Error('上传会话未初始化');
    }
    if (this.abortController.signal.aborted) {
      throw new DOMException('Upload aborted', 'AbortError');
    }

    const confirmedUploadedBytes = this.progressRecord.uploadedBytes;
    let previousLoaded = 0;
    const formData = new FormData();
    formData.append('file', chunkFile, chunkFile.name);
    formData.append('fileId', this.progressRecord.fileId);
    formData.append('chunkIndex', String(chunkIndex));

    return await new Promise<UploadProgressRecord>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const handleAbort = () => xhr.abort();
      const cleanup = () => {
        this.abortController.signal.removeEventListener('abort', handleAbort);
      };

      xhr.open('POST', ApiClient.buildUrl(this.urls.uploadUrl));
      xhr.withCredentials = true;
      xhr.responseType = 'text';
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) {
          return;
        }
        const deltaBytes = Math.max(0, event.loaded - previousLoaded);
        previousLoaded = event.loaded;
        this.recordTransferredBytes(deltaBytes);
        this.emitProgress(
          {
            ...this.progressRecord!,
            uploadedBytes: Math.min(this.options.file.size, confirmedUploadedBytes + event.loaded),
            percent:
              (Math.min(this.options.file.size, confirmedUploadedBytes + event.loaded) /
                Math.max(this.options.file.size, 1)) *
              100,
          },
          this.progressRecord!.uploadedChunkIndexes,
        );
      };
      xhr.onerror = () => {
        cleanup();
        reject(new Error('上传分片失败'));
      };
      xhr.onabort = () => {
        cleanup();
        reject(new DOMException('Upload aborted', 'AbortError'));
      };
      xhr.onload = () => {
        cleanup();
        try {
          const payload = JSON.parse(xhr.responseText || '{}') as ApiResponse<UploadProgressRecord>;
          if (xhr.status < 200 || xhr.status >= 300 || payload.code >= 400 || !payload.data) {
            reject(new Error(payload.message || `Request failed: ${xhr.status}`));
            return;
          }
          resolve(withChunkIndexes(payload.data));
        } catch {
          reject(new Error('上传分片响应解析失败'));
        }
      };
      this.abortController.signal.addEventListener('abort', handleAbort, { once: true });
      xhr.send(formData);
    });
  }

  private recordTransferredBytes(bytes: number) {
    if (bytes <= 0) {
      return;
    }
    const now = Date.now();
    this.speedSamples.push({ at: now, bytes });
    this.pruneSpeedSamples(now);
  }

  private pruneSpeedSamples(now: number) {
    while (
      this.speedSamples.length > 0 &&
      now - this.speedSamples[0]!.at > SPEED_SAMPLE_WINDOW_MS
    ) {
      this.speedSamples.shift();
    }
  }

  private getBytesPerSecond() {
    const now = Date.now();
    this.pruneSpeedSamples(now);
    if (this.speedSamples.length === 0) {
      return 0;
    }
    const oldest = this.speedSamples[0]!;
    const durationMs = Math.max(1, now - oldest.at);
    const totalBytes = this.speedSamples.reduce((sum, sample) => sum + sample.bytes, 0);
    return Math.max(0, Math.round((totalBytes * 1000) / durationMs));
  }

  private emitProgress(
    record: Pick<
      UploadProgressRecord,
      'fileId' | 'uploadId' | 'uploadedBytes' | 'totalSize' | 'percent' | 'uploadedChunkIndexes'
    >,
    uploadedChunkIndexes = record.uploadedChunkIndexes ?? [],
  ) {
    if (!this.options.onProgress) {
      return;
    }
    this.options.onProgress({
      fileId: record.fileId,
      uploadId: record.uploadId,
      uploadedBytes: record.uploadedBytes,
      totalBytes: record.totalSize,
      percent: normalizePercent(record.percent),
      uploadedChunkIndexes,
      bytesPerSecond: this.getBytesPerSecond(),
    });
  }
}

export async function uploadFileWithResume(
  options: ResumableUploadOptions,
): Promise<UploadedFileRecord> {
  return await new ResumableUploader(options).start();
}

function resolveChunkSize(fileSize: number, chunkSize?: number) {
  if (chunkSize && chunkSize > 0) {
    return Math.min(fileSize || chunkSize, chunkSize);
  }
  return Math.min(fileSize || DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_SIZE);
}

function createChunkFile(file: File, chunkIndex: number, chunkSize: number) {
  const start = chunkIndex * chunkSize;
  const end = Math.min(file.size, start + chunkSize);
  return new File([file.slice(start, end)], `${chunkIndex}.part`, {
    type: file.type || 'application/octet-stream',
  });
}

async function buildSourceHash(file: File) {
  const metadata = [file.name, String(file.size), String(file.lastModified), file.type || ''].join(
    '|',
  );
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(metadata));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function buildFrontendFileId(sourceHash: string) {
  return `${getFrontendUploadSessionId()}:${sourceHash}`;
}

function getFrontendUploadSessionId() {
  const fallbackSessionId = buildFallbackFrontendSessionId();
  if (typeof window === 'undefined') {
    return fallbackSessionId;
  }
  try {
    const existingSessionId = window.sessionStorage
      .getItem(FRONTEND_UPLOAD_SESSION_STORAGE_KEY)
      ?.trim();
    if (existingSessionId) {
      return existingSessionId;
    }
    const sessionId = globalThis.crypto?.randomUUID?.() ?? fallbackSessionId;
    window.sessionStorage.setItem(FRONTEND_UPLOAD_SESSION_STORAGE_KEY, sessionId);
    return sessionId;
  } catch {
    return globalThis.crypto?.randomUUID?.() ?? fallbackSessionId;
  }
}

function buildFallbackFrontendSessionId() {
  return `frontend-session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildAllChunkIndexes(chunkCount: number) {
  return Array.from({ length: chunkCount }, (_, index) => index);
}

function normalizePercent(percent: number) {
  if (!Number.isFinite(percent)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function withChunkIndexes(record: UploadProgressRecord): UploadProgressRecord {
  return {
    ...record,
    uploadedChunkIndexes: record.uploadedChunkIndexes ?? [],
  };
}
