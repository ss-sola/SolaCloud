import { Suspense, lazy } from 'react';
import { resolveViewerType, type ViewerType } from './filePreviewTypes';
import { ImageViewer } from './viewers/ImageViewer';
import { VideoViewer } from './viewers/VideoViewer';
import { AudioViewer } from './viewers/AudioViewer';
import { CodeViewer } from './viewers/CodeViewer';
import { FallbackViewer } from './viewers/FallbackViewer';

const OfficeViewer = lazy(() =>
  import('./viewers/OfficeViewer').then((m) => ({ default: m.OfficeViewer })),
);
const ModelViewer = lazy(() =>
  import('./viewers/ModelViewer').then((m) => ({ default: m.ModelViewer })),
);
const ZipBrowserViewer = lazy(() =>
  import('./viewers/ZipBrowserViewer').then((m) => ({ default: m.ZipBrowserViewer })),
);

export interface FilePreviewProps {
  url: string;
  fileName: string;
  extension: string;
  mimeType?: string;
  /** zip 文件专用：文件 ID（用于请求目录树） */
  fileId?: number;
  /** zip 文件专用：是否已解压 */
  isExtracted?: boolean;
  /** zip 文件专用：解压后的基础 URL（previewUrl 去掉入口文件部分） */
  basePreviewUrl?: string;
}

function LoadingSpinner() {
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

export function FilePreview({
  url,
  fileName,
  extension,
  mimeType,
  fileId,
  isExtracted,
  basePreviewUrl,
}: FilePreviewProps) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      <InnerPreview
        url={url}
        fileName={fileName}
        extension={extension}
        mimeType={mimeType}
        fileId={fileId}
        isExtracted={isExtracted}
        basePreviewUrl={basePreviewUrl}
      />
    </div>
  );
}

function InnerPreview({
  url,
  fileName,
  extension,
  mimeType,
  fileId,
  isExtracted,
  basePreviewUrl,
}: FilePreviewProps) {
  const viewerType: ViewerType = resolveViewerType(extension, mimeType);

  const commonProps = { url, fileName, extension };

  switch (viewerType) {
    case 'image':
      return <ImageViewer {...commonProps} />;
    case 'video':
      return <VideoViewer {...commonProps} />;
    case 'audio':
      return <AudioViewer {...commonProps} />;
    case 'code':
      return <CodeViewer {...commonProps} />;
    case 'office':
      return (
        <Suspense fallback={<LoadingSpinner />}>
          <OfficeViewer {...commonProps} />
        </Suspense>
      );
    case 'model3d':
      return (
        <Suspense fallback={<LoadingSpinner />}>
          <ModelViewer {...commonProps} />
        </Suspense>
      );
    case 'zip':
      if (isExtracted && fileId && basePreviewUrl) {
        return (
          <Suspense fallback={<LoadingSpinner />}>
            <ZipBrowserViewer fileId={fileId} basePreviewUrl={basePreviewUrl} fileName={fileName} />
          </Suspense>
        );
      }
      return <FallbackViewer {...commonProps} />;
    case 'fallback':
    default:
      return <FallbackViewer {...commonProps} />;
  }
}
