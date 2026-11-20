import { useCallback, useEffect, useState } from 'react';
import { ApiClient } from '../../../../shared/api/apiClient';
import { FilePreview } from '../FilePreview';
import { resolveViewerType } from '../filePreviewTypes';

interface FileTreeNode {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  children?: FileTreeNode[];
}

interface ZipBrowserViewerProps {
  /** 文件 ID，用于请求目录树 */
  fileId: number;
  /** zip 文件解压后的基础 URL 路径（previewUrl 去掉入口文件部分） */
  basePreviewUrl: string;
  /** zip 文件名 */
  fileName: string;
}

export function ZipBrowserViewer({ fileId, basePreviewUrl, fileName }: ZipBrowserViewerProps) {
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileTreeNode | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    ApiClient.get<FileTreeNode[]>('/api/file/tree', { id: fileId })
      .then((data) => {
        setTree(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '加载目录失败');
        setLoading(false);
      });
  }, [fileId]);

  const getFileUrl = useCallback(
    (node: FileTreeNode) => {
      return `${basePreviewUrl}/${node.path}`;
    },
    [basePreviewUrl],
  );

  const getExtension = useCallback((filePath: string) => {
    const lastDot = filePath.lastIndexOf('.');
    return lastDot > 0 ? filePath.slice(lastDot + 1) : '';
  }, []);

  if (loading) {
    return (
      <div
        className="d-flex justify-content-center align-items-center p-5"
        style={{ minHeight: '400px' }}
      >
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">加载中...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="alert alert-danger m-3">加载目录树失败: {error}</div>;
  }

  return (
    <div className="d-flex" style={{ height: '70vh', minHeight: '400px' }}>
      {/* 左侧目录树 */}
      <div className="border-end overflow-auto p-2" style={{ width: '280px', minWidth: '200px' }}>
        <div className="small text-muted mb-2">{fileName}</div>
        <TreeNodeList
          nodes={tree}
          selectedPath={selectedFile?.path ?? null}
          onSelect={(node) => {
            if (!node.isDirectory) {
              setSelectedFile(node);
            }
          }}
          depth={0}
        />
      </div>

      {/* 右侧预览 */}
      <div className="flex-grow-1 overflow-auto">
        {selectedFile ? (
          <FilePreview
            url={getFileUrl(selectedFile)}
            fileName={selectedFile.name}
            extension={getExtension(selectedFile.path)}
          />
        ) : (
          <div className="d-flex justify-content-center align-items-center h-100 text-muted">
            选择左侧文件进行预览
          </div>
        )}
      </div>
    </div>
  );
}

function TreeNodeList({
  nodes,
  selectedPath,
  onSelect,
  depth,
}: {
  nodes: FileTreeNode[];
  selectedPath: string | null;
  onSelect: (node: FileTreeNode) => void;
  depth: number;
}) {
  return (
    <ul className="list-unstyled mb-0" style={{ paddingLeft: depth > 0 ? '12px' : '0' }}>
      {nodes.map((node) => (
        <TreeNodeItem
          key={node.path}
          node={node}
          selectedPath={selectedPath}
          onSelect={onSelect}
          depth={depth}
        />
      ))}
    </ul>
  );
}

function TreeNodeItem({
  node,
  selectedPath,
  onSelect,
  depth,
}: {
  node: FileTreeNode;
  selectedPath: string | null;
  onSelect: (node: FileTreeNode) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const isSelected = selectedPath === node.path;

  if (node.isDirectory) {
    return (
      <li>
        <div
          className="d-flex align-items-center py-1 px-1 rounded cursor-pointer"
          style={{ cursor: 'pointer' }}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="me-1 small">{expanded ? '▼' : '▶'}</span>
          <span className="small fw-medium">{node.name}</span>
        </div>
        {expanded && node.children && (
          <TreeNodeList
            nodes={node.children}
            selectedPath={selectedPath}
            onSelect={onSelect}
            depth={depth + 1}
          />
        )}
      </li>
    );
  }

  const ext = node.path.split('.').pop() ?? '';
  const viewerType = resolveViewerType(ext);
  const isPreviewable = viewerType !== 'fallback';

  return (
    <li>
      <div
        className={`py-1 px-2 rounded small ${isSelected ? 'bg-primary text-white' : isPreviewable ? '' : 'text-muted'}`}
        style={{ cursor: isPreviewable ? 'pointer' : 'default' }}
        onClick={() => {
          if (isPreviewable) {
            onSelect(node);
          }
        }}
      >
        {node.name}
      </div>
    </li>
  );
}
