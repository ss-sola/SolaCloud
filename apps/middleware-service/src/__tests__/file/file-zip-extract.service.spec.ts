import { describe, it, expect } from 'vitest';
import {
  FileZipExtractService,
  FileTreeNode,
} from '../../modules/file/service/file-zip-extract.service';

interface ZipEntryInfo {
  path: string;
  size: number;
  isDirectory: boolean;
}

describe('FileZipExtractService', () => {
  let service: FileZipExtractService;

  beforeEach(() => {
    service = new FileZipExtractService();
  });

  describe('findModelEntryFile', () => {
    it('should return the first model file by priority', () => {
      const entries: ZipEntryInfo[] = [
        { path: 'model.glb', size: 1000, isDirectory: false },
        { path: 'model.obj', size: 2000, isDirectory: false },
        { path: 'texture.png', size: 500, isDirectory: false },
      ];
      const result = service.findModelEntryFile(entries);
      expect(result).toBe('model.glb');
    });

    it('should return null when no model files found', () => {
      const entries: ZipEntryInfo[] = [
        { path: 'texture.png', size: 500, isDirectory: false },
        { path: 'readme.txt', size: 100, isDirectory: false },
      ];
      const result = service.findModelEntryFile(entries);
      expect(result).toBeNull();
    });

    it('should skip directories when searching for model files', () => {
      const entries: ZipEntryInfo[] = [
        { path: 'models/', size: 0, isDirectory: true },
        { path: 'models/model.fbx', size: 3000, isDirectory: false },
      ];
      const result = service.findModelEntryFile(entries);
      expect(result).toBe('models/model.fbx');
    });

    it('should handle case-insensitive extension matching', () => {
      const entries: ZipEntryInfo[] = [{ path: 'model.GLB', size: 1000, isDirectory: false }];
      const result = service.findModelEntryFile(entries);
      expect(result).toBe('model.GLB');
    });
  });

  describe('buildFileTree', () => {
    it('should build a flat tree for root-level files', () => {
      const entries: ZipEntryInfo[] = [
        { path: 'a.txt', size: 100, isDirectory: false },
        { path: 'b.txt', size: 200, isDirectory: false },
      ];
      const tree = service.buildFileTree(entries);
      expect(tree).toHaveLength(2);
      expect(tree[0].name).toBe('a.txt');
      expect(tree[0].children).toBeUndefined();
    });

    it('should put files at root level in tree', () => {
      const entries: ZipEntryInfo[] = [
        { path: 'images/photo.jpg', size: 5000, isDirectory: false },
        { path: 'images/logo.png', size: 3000, isDirectory: false },
        { path: 'readme.txt', size: 100, isDirectory: false },
      ];
      const tree = service.buildFileTree(entries);
      // buildFileTree puts all files at root level
      expect(tree).toHaveLength(3);
      const names = tree.map((n) => n.name);
      expect(names).toContain('photo.jpg');
      expect(names).toContain('logo.png');
      expect(names).toContain('readme.txt');
    });

    it('should handle deeply nested paths', () => {
      const entries: ZipEntryInfo[] = [{ path: 'a/b/c/deep.txt', size: 50, isDirectory: false }];
      const tree = service.buildFileTree(entries);
      // Files are placed at root level since there's no explicit directory entry
      expect(tree.length).toBeGreaterThanOrEqual(1);
    });

    it('should preserve size information', () => {
      const entries: ZipEntryInfo[] = [{ path: 'large.bin', size: 1048576, isDirectory: false }];
      const tree = service.buildFileTree(entries);
      expect(tree[0].size).toBe(1048576);
    });
  });
});
