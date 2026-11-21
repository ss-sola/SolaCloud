import { afterEach, describe, expect, it, vi } from 'vitest';

function createApiResponse(data: unknown, status = 200, code = 200, message = 'ok') {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ code, message, data }),
  };
}

class MockWorker {
  private readonly messageListeners = new Set<(event: MessageEvent) => void>();
  private readonly errorListeners = new Set<(event: Event) => void>();

  addEventListener(type: 'message' | 'error', listener: (event: MessageEvent | Event) => void) {
    if (type === 'message') {
      this.messageListeners.add(listener as (event: MessageEvent) => void);
      return;
    }
    this.errorListeners.add(listener as (event: Event) => void);
  }

  removeEventListener(type: 'message' | 'error', listener: (event: MessageEvent | Event) => void) {
    if (type === 'message') {
      this.messageListeners.delete(listener as (event: MessageEvent) => void);
      return;
    }
    this.errorListeners.delete(listener as (event: Event) => void);
  }

  postMessage() {
    queueMicrotask(() => {
      this.messageListeners.forEach((listener) => {
        listener({ data: { type: 'done', fileHash: 'worker-file-hash' } } as MessageEvent);
      });
    });
  }

  terminate() {}
}

describe('resumableUploadApi', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('builds companion upload urls from uploadUrl', async () => {
    const { buildResumableUploadUrls } = await import('../shared/api/resumableUploadApi');

    expect(buildResumableUploadUrls('/api/file/upload/')).toEqual({
      uploadUrl: '/api/file/upload',
      checkUrl: '/api/file/upload/check',
      mergeUrl: '/api/file/upload/merge',
    });
  });

  it('runs the shared uploader through check/upload/merge and skips uploaded chunks', async () => {
    const gatewayOrigin = 'https://gateway.example.test';
    vi.stubEnv('VITE_GATEWAY_ORIGIN', gatewayOrigin);
    const checkBodyAssertions = {
      fileId: 'frontend-session-1:01020304',
      totalSize: 5,
      chunkSize: 2,
      chunkCount: 3,
      sourceHash: '01020304',
    };

    const mergeBodyAssertions = {
      fileId: 'frontend-session-1:01020304',
      fileHash: 'worker-file-hash',
      originalName: 'avatar.png',
      mimeType: 'image/png',
      scene: 'account',
      businessType: 'account-avatar',
      isTemporary: false,
    };

    function createFetchMock() {
      const checkSpy = vi.fn((body: Record<string, unknown>) => {
        expect(body).toMatchObject(checkBodyAssertions);
        return createApiResponse({
          fileId: 'frontend-session-1:01020304',
          uploadId: 'upload-id',
          totalSize: 5,
          uploadedBytes: 2,
          chunkSize: 2,
          chunkCount: 3,
          uploadedChunkCount: 1,
          uploadedChunkIndexes: [0],
          percent: 40,
          canMerge: false,
          status: 'uploading',
        });
      });

      const mergeSpy = vi.fn((body: Record<string, unknown>) => {
        expect(body).toEqual(mergeBodyAssertions);
        return createApiResponse({
          fileId: 'frontend-session-1:01020304',
          uploadId: 'upload-id',
          totalSize: 5,
          uploadedBytes: 5,
          chunkSize: 2,
          chunkCount: 3,
          uploadedChunkCount: 3,
          uploadedChunkIndexes: [0, 1, 2],
          percent: 100,
          canMerge: false,
          status: 'completed',
          file: {
            url: '/public/uploads/avatar.png',
            previewUrl: '/public/uploads/avatar.png',
          },
        });
      });

      return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body ?? '{}'));
        if (url.endsWith('/check')) return checkSpy(body);
        if (url.endsWith('/merge')) return mergeSpy(body);
        throw new Error(`Unexpected fetch url: ${url}`);
      });
    }

    const fetchMock = createFetchMock();

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('crypto', {
      subtle: {
        digest: vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer),
      },
    });
    window.sessionStorage.setItem('resumable-upload.session-id', 'frontend-session-1');
    vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker);

    const sentChunkIndexes: number[] = [];
    class MockXMLHttpRequest {
      upload = { onprogress: null as ((event: ProgressEvent<EventTarget>) => void) | null };
      withCredentials = false;
      responseType = '';
      status = 200;
      responseText = '';
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      onload: (() => void) | null = null;

      open(method: string, url: string) {
        expect(method).toBe('POST');
        expect(url).toBe(`${gatewayOrigin}/api/file/upload`);
      }

      send(body: Document | XMLHttpRequestBodyInit | null | undefined) {
        expect(this.withCredentials).toBe(true);
        const formData = body as FormData;
        const chunkIndex = Number(formData.get('chunkIndex'));
        const chunkFile = formData.get('file') as File;
        sentChunkIndexes.push(chunkIndex);
        this.upload.onprogress?.({
          lengthComputable: true,
          loaded: chunkFile.size,
          total: chunkFile.size,
        } as ProgressEvent<EventTarget>);

        const uploadedChunkIndexes = chunkIndex === 1 ? [0, 1] : [0, 1, 2];
        const uploadedBytes = chunkIndex === 1 ? 4 : 5;
        this.responseText = JSON.stringify({
          code: 200,
          message: 'ok',
          data: {
            fileId: 'frontend-session-1:01020304',
            uploadId: 'upload-id',
            totalSize: 5,
            uploadedBytes,
            chunkSize: 2,
            chunkCount: 3,
            uploadedChunkCount: uploadedChunkIndexes.length,
            uploadedChunkIndexes,
            percent: chunkIndex === 1 ? 80 : 100,
            canMerge: chunkIndex === 2,
            status: chunkIndex === 1 ? 'uploading' : 'ready-to-merge',
          },
        });
        this.onload?.();
      }

      abort() {
        this.onabort?.();
      }
    }
    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest as unknown as typeof XMLHttpRequest);

    const progressSnapshots: Array<{ percent: number; bytesPerSecond: number }> = [];
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], 'avatar.png', {
      type: 'image/png',
      lastModified: 1,
    });
    const { ResumableUploader } = await import('../shared/api/resumableUploadApi');

    const uploader = new ResumableUploader({
      uploadUrl: '/api/file/upload',
      file,
      scene: 'account',
      businessType: 'account-avatar',
      isTemporary: false,
      chunkSize: 2,
      onProgress: (progress) => {
        progressSnapshots.push({
          percent: progress.percent,
          bytesPerSecond: progress.bytesPerSecond,
        });
      },
    });
    const result = await uploader.start();

    expect(sentChunkIndexes).toEqual([1, 2]);
    expect(progressSnapshots[0]?.percent).toBe(40);
    expect(progressSnapshots.at(-1)?.percent).toBe(100);
    expect(progressSnapshots.some((item) => item.bytesPerSecond > 0)).toBe(true);
    expect(result.url).toBe('/public/uploads/avatar.png');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${gatewayOrigin}/api/file/upload/check`,
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${gatewayOrigin}/api/file/upload/merge`,
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});
