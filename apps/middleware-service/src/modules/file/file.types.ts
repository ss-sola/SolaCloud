import { FileStatus, FileUploadSessionStatus } from './file.constants';

export type FileRecord = {
  id: number;
  originalName: string;
  storageKey: string;
  storagePath: string;
  url: string;
  previewUrl: string;
  mimeType: string;
  size: number;
  extension?: string;
  scene?: string;
  businessType?: string;
  isTemporary: boolean;
  status: FileStatus;
  createdAt: string;
  updatedAt: string;
  bundleEntryPath?: string;
  isExtracted: boolean;
  description?: string | null;
};

export type StoredFile = {
  storageKey: string;
  storagePath: string;
  extension?: string;
};

export type ChunkSaveResult = {
  existed: boolean;
  size: number;
};

export type UploadedChunkRecord = {
  chunkIndex: number;
  size: number;
};

export type FileUploadProgressRecord = {
  fileId: string;
  uploadId: string;
  status: FileUploadSessionStatus;
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
};

export type FileUploadMergeRecord = FileUploadProgressRecord & {
  file?: FileRecord;
};

export type FileUploadRedisMeta = {
  fileId: string;
  uploadId: string;
  chunkDirPath: string;
  originalName?: string;
  mimeType?: string;
  totalSize: number;
  chunkSize: number;
  chunkCount: number;
  uploadedBytes: number;
  uploadedChunkCount: number;
  status: FileUploadSessionStatus;
  scene?: string;
  businessType?: string;
  isTemporary: boolean;
  errorMessage?: string;
  updatedAt: string;
};

export type CleanupResult = {
  matched: number;
  removed: number;
  failed: number;
};
