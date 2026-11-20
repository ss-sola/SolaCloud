interface VideoViewerProps {
  url: string;
  fileName: string;
}

export function VideoViewer({ url, fileName }: VideoViewerProps) {
  return (
    <div
      className="d-flex justify-content-center align-items-center p-3"
      style={{ minHeight: '400px' }}
    >
      <video src={url} controls className="w-100" style={{ maxHeight: '70vh' }}>
        <track kind="captions" />
        您的浏览器不支持视频播放
      </video>
    </div>
  );
}
