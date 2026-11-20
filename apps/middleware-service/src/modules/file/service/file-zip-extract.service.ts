import { Injectable, Logger } from '@nestjs/common';
import { ProjectException } from '@nest-cloud/sdk';
import * as StreamZip from 'node-stream-zip';
import * as iconv from 'iconv-lite';
import * as fs from 'fs';
import * as path from 'path';

interface ZipExtractOptions {
  /** 单个文件最大大小（字节），默认 100MB */
  maxFileSizeBytes?: number;
  /** 解压文件总数上限，默认 500 */
  maxFileCount?: number;
  /** 解压后总大小上限（字节），默认 500MB */
  maxTotalSizeBytes?: number;
}

interface ZipEntryInfo {
  /** 相对于解压目录的路径 */
  path: string;
  /** 文件大小（字节） */
  size: number;
  /** 是否为目录 */
  isDirectory: boolean;
}

const DEFAULT_EXTRACT_OPTIONS: Required<ZipExtractOptions> = {
  maxFileSizeBytes: 100 * 1024 * 1024,
  maxFileCount: 500,
  maxTotalSizeBytes: 500 * 1024 * 1024,
};

/** 模型文件扩展名优先级（按优先级从高到低） */
const MODEL_ENTRY_PRIORITY = ['.glb', '.gltf', '.pmx', '.obj', '.stl', '.fbx'];

@Injectable()
export class FileZipExtractService {
  private readonly logger = new Logger(FileZipExtractService.name);

  /**
   * 解压 zip 文件到目标目录
   * @param zipPath 源 zip 文件的绝对路径
   * @param targetDir 目标解压目录的绝对路径
   * @param options 解压选项
   * @returns 解压后的文件列表（相对路径）
   */
  async extractZip(
    zipPath: string,
    targetDir: string,
    options?: ZipExtractOptions,
  ): Promise<ZipEntryInfo[]> {
    const opts = { ...DEFAULT_EXTRACT_OPTIONS, ...options };

    if (!fs.existsSync(zipPath)) {
      throw new ProjectException(`Zip file not found: ${zipPath}`);
    }

    // 确保目标目录存在
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 使用 buffer 模式读取文件名，以便手动处理编码
    const zip = new StreamZip.async({ file: zipPath, nameEncoding: 'utf8' });
    const entries = await zip.entries();
    const entryKeys = Object.keys(entries);

    // 检测是否存在乱码（非 UTF-8 编码的 zip）
    const needsGbkDecode = this.detectNonUtf8Encoding(entryKeys);

    if (needsGbkDecode) {
      // 关闭 UTF-8 模式，用 buffer 模式重新打开
      await zip.close();
      return this.extractWithGbkEncoding(zipPath, targetDir, opts);
    }

    // 检查文件数上限
    if (entryKeys.length > opts.maxFileCount) {
      await zip.close();
      throw new ProjectException(
        `Zip contains too many files: ${entryKeys.length} (max: ${opts.maxFileCount})`,
      );
    }

    let totalSize = 0;
    const extractedEntries: ZipEntryInfo[] = [];

    for (const name of entryKeys) {
      const entry = entries[name];

      // 跳过系统文件
      if (this.shouldSkipEntry(name)) {
        continue;
      }

      // Zip-slip 防护：确保解压路径在目标目录内
      const safePath = this.resolveSafePath(targetDir, name);
      if (!safePath) {
        this.logger.warn(`Skipped unsafe zip entry: ${name}`);
        continue;
      }

      // 检查单个文件大小
      if (entry.size > opts.maxFileSizeBytes) {
        await zip.close();
        throw new ProjectException(
          `File too large in zip: ${name} (${entry.size} bytes, max: ${opts.maxFileSizeBytes})`,
        );
      }

      totalSize += entry.size;

      // 检查总大小
      if (totalSize > opts.maxTotalSizeBytes) {
        await zip.close();
        throw new ProjectException(
          `Zip total size exceeds limit: ${totalSize} bytes (max: ${opts.maxTotalSizeBytes})`,
        );
      }

      if (entry.isDirectory) {
        fs.mkdirSync(safePath, { recursive: true });
        extractedEntries.push({
          path: name.replace(/\/$/, ''),
          size: 0,
          isDirectory: true,
        });
      } else {
        // 确保父目录存在
        const parentDir = path.dirname(safePath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }

        await zip.extract(name, safePath);
        extractedEntries.push({
          path: name,
          size: entry.size,
          isDirectory: false,
        });
      }
    }

    await zip.close();

    this.logger.log(`Extracted ${extractedEntries.length} entries from ${zipPath} to ${targetDir}`);

    return extractedEntries;
  }

  /**
   * 从解压后的文件列表中自动识别 3D 模型入口文件
   * @param entries 解压后的文件列表
   * @returns 入口文件的相对路径，未找到则返回 null
   */
  findModelEntryFile(entries: ZipEntryInfo[]): string | null {
    const files = entries.filter((e) => !e.isDirectory);

    for (const ext of MODEL_ENTRY_PRIORITY) {
      const found = files.find((f) => f.path.toLowerCase().endsWith(ext));
      if (found) {
        return found.path;
      }
    }

    return null;
  }

  /**
   * 构建文件树结构（用于前端目录树展示）
   * @param entries 解压后的文件列表
   * @returns 树形结构
   */
  buildFileTree(entries: ZipEntryInfo[]): FileTreeNode[] {
    const root: FileTreeNode[] = [];
    const nodeMap = new Map<string, FileTreeNode>();

    // 先创建所有节点
    for (const entry of entries) {
      const node: FileTreeNode = {
        name: path.basename(entry.path),
        path: entry.path,
        size: entry.size,
        isDirectory: entry.isDirectory,
        children: entry.isDirectory ? [] : undefined,
      };
      nodeMap.set(entry.path, node);
    }

    // 构建父子关系
    for (const entry of entries) {
      const node = nodeMap.get(entry.path)!;
      const parentPath = path.dirname(entry.path);

      if (parentPath === '.' || parentPath === '') {
        // 根级别
        root.push(node);
      } else {
        // 有父节点
        const parent = nodeMap.get(parentPath);
        if (parent && parent.children) {
          parent.children.push(node);
        } else {
          // 父节点不存在（可能是隐式目录），创建并添加
          root.push(node);
        }
      }
    }

    return root;
  }

  /**
   * 判断是否应跳过此条目（系统文件/隐藏文件）
   */
  private shouldSkipEntry(entryName: string): boolean {
    const name = entryName.toLowerCase();
    return (
      name.startsWith('__macosx/') ||
      name.includes('/.ds_store') ||
      name.endsWith('/.ds_store') ||
      name === '.ds_store' ||
      name.includes('/thumbs.db') ||
      name.endsWith('/thumbs.db') ||
      name === 'thumbs.db'
    );
  }

  /**
   * 检测文件名是否包含非 UTF-8 编码（GBK 等）
   * UTF-8 编码的中文不会出现 0x80-0xFF 范围内的不合法 replacement character
   */
  private detectNonUtf8Encoding(names: string[]): boolean {
    for (const name of names) {
      // 如果包含 replacement character (U+FFFD) 说明 UTF-8 解码失败
      if (name.includes('\ufffd')) {
        return true;
      }
      // 检测是否有明显乱码特征（高字节被错误解码为拉丁字符）
      for (let i = 0; i < name.length; i++) {
        const code = name.charCodeAt(i);
        // 连续的高位字符通常说明是 GBK 被当作 Latin1 解码
        if (code >= 0x80 && code <= 0xff) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 使用 GBK 编码解压 zip 文件（处理中文 Windows 创建的 zip）
   */
  private async extractWithGbkEncoding(
    zipPath: string,
    targetDir: string,
    opts: Required<ZipExtractOptions>,
  ): Promise<ZipEntryInfo[]> {
    // 以 latin1 模式打开保留原始字节，手动用 GBK 解码文件名
    const zip = new StreamZip.async({ file: zipPath, nameEncoding: 'latin1' });
    const entries = await zip.entries();
    const entryKeys = Object.keys(entries);

    if (entryKeys.length > opts.maxFileCount) {
      await zip.close();
      throw new ProjectException(
        `Zip contains too many files: ${entryKeys.length} (max: ${opts.maxFileCount})`,
      );
    }

    let totalSize = 0;
    const extractedEntries: ZipEntryInfo[] = [];

    for (const rawName of entryKeys) {
      const entry = entries[rawName];

      // 将 latin1 字符串转为 buffer 再用 GBK 解码
      const nameBuffer = Buffer.from(rawName, 'latin1');
      const decodedName = iconv.decode(nameBuffer, 'gbk');

      if (this.shouldSkipEntry(decodedName)) {
        continue;
      }

      const safePath = this.resolveSafePath(targetDir, decodedName);
      if (!safePath) {
        this.logger.warn(`Skipped unsafe zip entry: ${decodedName}`);
        continue;
      }

      if (entry.size > opts.maxFileSizeBytes) {
        await zip.close();
        throw new ProjectException(
          `File too large in zip: ${decodedName} (${entry.size} bytes, max: ${opts.maxFileSizeBytes})`,
        );
      }

      totalSize += entry.size;
      if (totalSize > opts.maxTotalSizeBytes) {
        await zip.close();
        throw new ProjectException(
          `Zip total size exceeds limit: ${totalSize} bytes (max: ${opts.maxTotalSizeBytes})`,
        );
      }

      if (entry.isDirectory) {
        fs.mkdirSync(safePath, { recursive: true });
        extractedEntries.push({
          path: decodedName.replace(/\/$/, ''),
          size: 0,
          isDirectory: true,
        });
      } else {
        const parentDir = path.dirname(safePath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }

        await zip.extract(rawName, safePath);
        extractedEntries.push({
          path: decodedName,
          size: entry.size,
          isDirectory: false,
        });
      }
    }

    await zip.close();
    this.logger.log(
      `Extracted ${extractedEntries.length} entries (GBK) from ${zipPath} to ${targetDir}`,
    );
    return extractedEntries;
  }

  /**
   * Zip-slip 防护：确保解压路径在目标目录内
   * @param targetDir 目标目录的绝对路径
   * @param entryPath zip 条目的相对路径
   * @returns 安全的绝对路径，不安全则返回 null
   */
  private resolveSafePath(targetDir: string, entryPath: string): string | null {
    const resolved = path.resolve(targetDir, entryPath);
    const normalized = path.normalize(resolved);

    // 确保解析后的路径以目标目录开头
    if (!normalized.startsWith(path.normalize(targetDir))) {
      return null;
    }

    return normalized;
  }
}

export interface FileTreeNode {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  children?: FileTreeNode[];
}
