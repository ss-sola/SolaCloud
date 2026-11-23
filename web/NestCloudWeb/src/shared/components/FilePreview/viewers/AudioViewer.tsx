interface AudioViewerProps {
  url: string;
  fileName: string;
}

export function AudioViewer({ url, fileName }: AudioViewerProps) {
  return (
    <div
      className="d-flex flex-column justify-content-center align-items-center p-5"
      style={{ minHeight: '300px' }}
    >
      <div className="mb-4 text-center">
        <i className="bi bi-music-note-beamed text-secondary" style={{ fontSize: '4rem' }} />
        <div className="mt-3 text-muted">{fileName}</div>
      </div>
      <audio src={url} controls className="w-100" style={{ maxWidth: '500px' }}>
        您的浏览器不支持音频播放
      </audio>
    </div>
  );
}
