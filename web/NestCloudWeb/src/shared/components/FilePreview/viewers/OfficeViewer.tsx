import { useEffect, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';
import * as XLSX from 'xlsx';

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface OfficeViewerProps {
  url: string;
  fileName: string;
  extension: string;
}

export function OfficeViewer({ url, fileName, extension }: OfficeViewerProps) {
  const ext = extension.toLowerCase().replace(/^\./, '');

  if (ext === 'pdf') {
    return <PdfViewer url={url} fileName={fileName} />;
  }
  if (ext === 'docx' || ext === 'doc') {
    return <DocxViewer url={url} />;
  }
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
    return <XlsxViewer url={url} />;
  }
  if (ext === 'pptx' || ext === 'ppt') {
    return <PptxFallback url={url} fileName={fileName} />;
  }

  // 其他 office 格式
  return (
    <div
      className="d-flex flex-column justify-content-center align-items-center p-5 text-center"
      style={{ minHeight: '400px' }}
    >
      <div className="mb-3 text-muted" style={{ fontSize: '4rem' }}>
        &#128196;
      </div>
      <h5>{fileName}</h5>
      <p className="text-muted">暂不支持在线预览 .{ext} 文件</p>
      <a href={url} download={fileName} className="btn btn-primary mt-2">
        下载文件
      </a>
    </div>
  );
}

function PdfViewer({ url, fileName }: { url: string; fileName: string }) {
  return (
    <div style={{ height: '70vh', minHeight: '400px', display: 'flex', flexDirection: 'column' }}>
      <div className="d-flex justify-content-end p-2 border-bottom bg-light">
        <a href={url} download={fileName} className="btn btn-sm btn-outline-primary">
          下载 PDF
        </a>
      </div>
      <div className="flex-grow-1">
        <iframe
          src={`${url}#toolbar=1&navpanes=1`}
          title="PDF 预览"
          style={{ width: '100%', height: '100%', border: 'none' }}
        />
      </div>
    </div>
  );
}

function PptxFallback({ url, fileName }: { url: string; fileName: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let previewer: { destroy: () => void } | null = null;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();
        if (cancelled || !containerRef.current) return;

        const pptxPreview = await import('pptx-preview');
        containerRef.current.innerHTML = '';
        previewer = pptxPreview.init(containerRef.current, {
          width: containerRef.current.offsetWidth || 960,
          height: Math.floor(((containerRef.current.offsetWidth || 960) * 9) / 16),
          mode: 'list',
        });
        await (previewer as any).preview(buffer);
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'PPTX 加载失败');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      previewer?.destroy();
    };
  }, [url]);

  return (
    <div style={{ height: '70vh', minHeight: '400px', overflow: 'hidden', background: '#f0f0f0' }}>
      <style>{`
        .pptx-preview-wrapper,
        .pptx-preview-wrapper > div {
          max-width: 100% !important;
          height: 100% !important;
          overflow-y: auto !important;
          overflow-x: hidden !important;
          border: none !important;
          box-shadow: none !important;
        }
        .pptx-preview-wrapper > div > div {
          margin: 0 auto !important;
          border: none !important;
          box-shadow: none !important;
          max-width: 100% !important;
        }
      `}</style>
      {loading && !error && (
        <div className="d-flex justify-content-center align-items-center p-5">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">加载中...</span>
          </div>
        </div>
      )}
      {error && (
        <div className="d-flex flex-column justify-content-center align-items-center p-5 text-center">
          <div className="alert alert-danger">{error}</div>
          <a href={url} download={fileName} className="btn btn-primary mt-2">
            下载文件
          </a>
        </div>
      )}
      <div ref={containerRef} className="pptx-preview-wrapper" style={{ height: '100%' }} />
    </div>
  );
}

function DocxViewer({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buffer) => {
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = '';
        return renderAsync(buffer, containerRef.current, undefined, {
          className: 'docx-preview-wrapper',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
        });
      })
      .then(() => {
        if (!cancelled) setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '文档加载失败');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div style={{ height: '70vh', minHeight: '400px', overflow: 'auto', background: '#f5f5f5' }}>
      {loading && (
        <div className="d-flex justify-content-center align-items-center p-5">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">加载中...</span>
          </div>
        </div>
      )}
      {error && <div className="alert alert-danger m-3">加载失败: {error}</div>}
      <div ref={containerRef} style={{ padding: '16px' }} />
    </div>
  );
}

function XlsxViewer({ url }: { url: string }) {
  const [html, setHtml] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buffer) => {
        if (cancelled) return;
        const wb = XLSX.read(buffer, { type: 'array' });
        setWorkbook(wb);
        setSheets(wb.SheetNames);
        if (wb.SheetNames.length > 0) {
          setActiveSheet(wb.SheetNames[0]);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '表格加载失败');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  // 渲染当前激活的 sheet
  useEffect(() => {
    if (workbook && activeSheet && workbook.Sheets[activeSheet]) {
      setHtml(renderSheet(workbook.Sheets[activeSheet]));
    }
  }, [workbook, activeSheet]);

  const renderSheet = (sheet: XLSX.WorkSheet): string => {
    // sheet['!ref'] 表示数据范围，不存在时说明无数据
    if (!sheet['!ref']) {
      return '<div style="padding:20px;color:#999;">该 Sheet 为空</div>';
    }
    // 使用 sheet_to_json 转为行列数据再手动生成 HTML（绕开 sheet_to_html 对某些内容的兼容性问题）
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' });
    if (!rows.length) {
      return '<div style="padding:20px;color:#999;">该 Sheet 无内容</div>';
    }
    const headerRow = rows[0] as string[];
    const bodyRows = rows.slice(1) as string[][];
    const ths = headerRow.map((cell) => `<th>${escapeHtml(String(cell ?? ''))}</th>`).join('');
    const trs = bodyRows
      .map((row) => {
        const tds = row.map((cell) => `<td>${escapeHtml(String(cell ?? ''))}</td>`).join('');
        return `<tr>${tds}</tr>`;
      })
      .join('');
    return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
  };

  const switchSheet = (name: string) => {
    if (!workbook || !workbook.Sheets[name]) return;
    setActiveSheet(name);
  };

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
    return <div className="alert alert-danger m-3">加载失败: {error}</div>;
  }

  return (
    <div style={{ height: '70vh', minHeight: '400px', display: 'flex', flexDirection: 'column' }}>
      <div className="alert alert-warning m-2 py-2 small">
        <strong>提示：</strong>当前仅预览表格数据，Excel 中的图片、图表等富内容不会显示。
      </div>
      {sheets.length > 1 && (
        <div className="d-flex gap-1 p-2 border-bottom bg-light flex-wrap">
          {sheets.map((name) => (
            <button
              key={name}
              type="button"
              className={`btn btn-sm ${activeSheet === name ? 'btn-primary' : 'btn-outline-secondary'}`}
              onClick={() => switchSheet(name)}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <style>{`
        .xlsx-viewer-content table {
          border-collapse: collapse;
          font-size: 13px;
          background: white;
        }
        .xlsx-viewer-content table td,
        .xlsx-viewer-content table th {
          border: 1px solid #d0d0d0;
          padding: 4px 8px;
          min-width: 50px;
        }
        .xlsx-viewer-content table th {
          background: #f5f5f5;
          font-weight: 600;
        }
        .xlsx-viewer-content table tr:hover {
          background: #f9f9f9;
        }
      `}</style>
      <div
        className="flex-grow-1 overflow-auto p-2 xlsx-viewer-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
