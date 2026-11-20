interface FallbackViewerProps {
  url: string;
  fileName: string;
  extension: string;
}

export function FallbackViewer({ url, fileName, extension }: FallbackViewerProps) {
  return (
    <div
      className="d-flex flex-column justify-content-center align-items-center p-5 text-center"
      style={{ minHeight: '400px' }}
    >
      <i className="bi bi-file-earmark" style={{ fontSize: '5rem', color: '#6c757d' }} />
      <div className="mt-4">
        <h5>{fileName}</h5>
        <p className="text-muted">暂不支持预览 .{extension} 文件</p>
      </div>
      <a href={url} download={fileName} className="btn btn-primary mt-3">
        <i className="bi bi-download me-2" />
        下载文件
      </a>
    </div>
  );
}
