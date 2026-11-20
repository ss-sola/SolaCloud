import { createSHA256 } from 'hash-wasm';

type HashWorkerRequest = {
  file: File;
  chunkSize: number;
};

type HashWorkerResponse = { type: 'done'; fileHash: string } | { type: 'error'; message: string };

self.onmessage = async (event: MessageEvent<HashWorkerRequest>) => {
  try {
    const { file, chunkSize } = event.data;
    const hasher = await createSHA256();
    hasher.init();
    for (let start = 0; start < file.size; start += chunkSize) {
      const buffer = await file.slice(start, Math.min(file.size, start + chunkSize)).arrayBuffer();
      hasher.update(new Uint8Array(buffer));
    }
    const payload: HashWorkerResponse = {
      type: 'done',
      fileHash: hasher.digest('hex'),
    };
    self.postMessage(payload);
  } catch (error) {
    const payload: HashWorkerResponse = {
      type: 'error',
      message: error instanceof Error ? error.message : '文件哈希计算失败',
    };
    self.postMessage(payload);
  }
};

export {};
