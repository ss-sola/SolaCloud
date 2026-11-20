interface ImageViewerProps {
  url: string;
  fileName: string;
}

export function ImageViewer({ url, fileName }: ImageViewerProps) {
  return (
    <div
      className="d-flex justify-content-center align-items-center p-3"
      style={{ minHeight: '400px' }}
    >
      <img
        src={url}
        alt={fileName}
        className="img-fluid"
        style={{ maxHeight: '70vh', maxWidth: '100%' }}
      />
    </div>
  );
}
