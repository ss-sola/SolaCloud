import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';

/**
 * 文件下载工具。
 * 从指定 URL 下载文件到本地路径，支持 http/https。
 */
export class FileDownloadUtil {
  /** 下载文件超时（毫秒） */
  static readonly TIMEOUT_MS = 30_000;

  /** 下载文件到指定路径 */
  static async downloadToFile(url: string, destPath: string): Promise<void> {
    const dir = path.dirname(destPath);
    await fs.promises.mkdir(dir, { recursive: true });

    return new Promise<void>((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      client
        .get(url, { timeout: this.TIMEOUT_MS }, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed with status ${res.statusCode}`));
            return;
          }
          const writer = fs.createWriteStream(destPath);
          res.pipe(writer);
          writer.on('finish', () => {
            writer.close();
            resolve();
          });
          writer.on('error', reject);
        })
        .on('error', reject);
    });
  }
}
