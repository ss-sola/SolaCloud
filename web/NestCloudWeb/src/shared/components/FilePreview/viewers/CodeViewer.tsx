import { useEffect, useMemo, useRef, useState } from 'react';
import { Streamdown } from 'streamdown';
import type { Components } from 'streamdown';
import MonacoEditorLocal from '@/shared/components/MonacoEditorLocal';
import { getMonacoLanguage } from '../filePreviewTypes';
import { mermaid } from '@streamdown/mermaid';
interface CodeViewerProps {
  url: string;
  fileName: string;
  extension: string;
}

/** Heading 目录条目 */
interface TocItem {
  id: string;
  text: string;
  level: number;
}

/** 从 Markdown 源码解析 heading */
function parseHeadings(markdown: string): TocItem[] {
  const regex = /^(#{1,6})\s+(.+)$/gm;
  const items: TocItem[] = [];
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const level = match[1].length;
    const text = match[2].trim().replace(/\s+$/, '');
    items.push({
      id: `h-${items.length}`,
      text,
      level,
    });
  }
  return items;
}

export function CodeViewer({ url, fileName, extension }: CodeViewerProps) {
  const [code, setCode] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview');
  const [tocOpen, setTocOpen] = useState(true);

  const ext = extension.replace(/^\./, '').toLowerCase();
  const isMarkdown = ext === 'md';
  const toc = useMemo(() => parseHeadings(code), [code]);

  // heading data-id 计数器（用于在 DOM 中查找）
  const headingIdx = useRef(0);
  const [activeHeadingId, setActiveHeadingId] = useState<string>('');

  const components = useMemo(
    () => darkComponents(headingIdx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [code],
  );

  // code 变化时重置计数器
  useEffect(() => {
    headingIdx.current = 0;
  }, [code]);

  // 切换回预览时也重置
  useEffect(() => {
    if (viewMode === 'preview') {
      headingIdx.current = 0;
    }
  }, [viewMode]);

  // 滚动条样式注入（仅当前组件生效）
  useEffect(() => {
    const styleId = 'codeviewer-scrollbar-style';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* 预览面板滚动条 */
      .cv-preview-pane::-webkit-scrollbar { width: 8px; height: 8px; }
      .cv-preview-pane::-webkit-scrollbar-track { background: transparent; }
      .cv-preview-pane::-webkit-scrollbar-thumb {
        background: rgba(110,118,129,0.4);
        border-radius: 4px;
      }
      .cv-preview-pane::-webkit-scrollbar-thumb:hover { background: rgba(110,118,129,0.6); }
      .cv-preview-pane::-webkit-scrollbar-corner { background: transparent; }

      /* 目录侧栏滚动条 */
      .cv-sidebar::-webkit-scrollbar { width: 6px; }
      .cv-sidebar::-webkit-scrollbar-track { background: transparent; }
      .cv-sidebar::-webkit-scrollbar-thumb {
        background: rgba(110,118,129,0.3);
        border-radius: 3px;
      }
      .cv-sidebar::-webkit-scrollbar-thumb:hover { background: rgba(110,118,129,0.5); }

      /* 源码编辑器区域滚动条 */
      .cv-source-area::-webkit-scrollbar { width: 8px; height: 8px; }
      .cv-source-area::-webkit-scrollbar-track { background: transparent; }
      .cv-source-area::-webkit-scrollbar-thumb {
        background: rgba(110,118,129,0.4);
        border-radius: 4px;
      }
      .cv-source-area::-webkit-scrollbar-thumb:hover { background: rgba(110,118,129,0.6); }
      .cv-source-area::-webkit-scrollbar-corner { background: transparent; }
    `;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, []);

  const scrollToHeading = (id: string) => {
    const findAndScroll = () => {
      const previewPane = document.querySelector('.cv-preview-pane') as HTMLElement | null;
      if (!previewPane) return;
      const el = previewPane.querySelector<HTMLHeadingElement>(`[data-cv-id="${id}"]`);
      if (!el) return;

      const elRect = el.getBoundingClientRect();
      const paneRect = previewPane.getBoundingClientRect();
      const targetScroll = previewPane.scrollTop + (elRect.top - paneRect.top) - 20;
      previewPane.scrollTo({
        top: Math.max(0, targetScroll),
        behavior: 'smooth',
      });

      setActiveHeadingId(id);
    };
    requestAnimationFrame(() => {
      findAndScroll();
      if (!document.querySelector(`.cv-preview-pane [data-cv-id="${id}"]`)) {
        setTimeout(findAndScroll, 300);
      }
    });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (!cancelled) {
          setCode(text);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载失败');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

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
    return (
      <div className="alert alert-danger m-3" role="alert">
        加载文件失败: {error}
      </div>
    );
  }

  return (
    <div style={layout.container}>
      {/* 顶部工具栏：仅 md 文件显示切换按钮 */}
      {isMarkdown && (
        <div style={layout.toolbar}>
          <button
            className={`btn btn-sm ${viewMode === 'preview' ? 'btn-primary' : 'btn-outline-secondary'}`}
            type="button"
            onClick={() => setViewMode('preview')}
          >
            预览
          </button>
          <button
            className={`btn btn-sm ${viewMode === 'source' ? 'btn-primary' : 'btn-outline-secondary'}`}
            type="button"
            onClick={() => setViewMode('source')}
          >
            源码
          </button>
          {toc.length > 0 && viewMode === 'preview' && (
            <button
              className={`btn btn-sm ${tocOpen ? 'btn-primary' : 'btn-outline-secondary'}`}
              type="button"
              onClick={() => setTocOpen((v) => !v)}
              style={layout.tocToggle}
              title="目录导航"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M3 3h8M3 7h8M3 11h8"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* 内容区 */}
      <div style={layout.body}>
        {/* 左侧目录 */}
        {isMarkdown && toc.length > 0 && tocOpen && viewMode === 'preview' && (
          <aside style={layout.sidebar} className="cv-sidebar">
            <div style={layout.sidebarTitle}>目录</div>
            <nav>
              {toc.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => scrollToHeading(item.id)}
                  style={{
                    ...layout.tocLink,
                    paddingLeft: `${(item.level - 1) * 16 + 16}px`,
                    fontWeight: activeHeadingId === item.id ? 600 : 400,
                    color: activeHeadingId === item.id ? '#58a6ff' : '#8b949e',
                  }}
                >
                  {item.text}
                  {activeHeadingId === item.id && <span style={{ marginLeft: 4 }}>▸</span>}
                </button>
              ))}
            </nav>
          </aside>
        )}

        {/* 主内容 */}
        <div style={layout.contentArea}>
          {viewMode === 'preview' ? (
            <div style={layout.previewPane} className="cv-preview-pane">
              <Streamdown
                components={components}
                shikiTheme={['one-dark-pro', 'one-dark-pro']}
                controls={{
                  code: false,
                  table: false,
                  mermaid: false,
                }}
                plugins={{ mermaid }}
              >
                {code}
              </Streamdown>
            </div>
          ) : (
            <div style={layout.sourcePane} className="cv-source-area">
              <MonacoEditorLocal
                language={getMonacoLanguage(extension)}
                value={code}
                theme="vs-dark"
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontSize: 14,
                  lineNumbers: 'off',
                  overviewRulerLanes: 0,
                  renderLineHighlight: 'none',
                  padding: { top: 16, bottom: 16 },
                  fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
                  colorDecorators: false,
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- 暗黑主题 Streamdown 自定义组件 ---- */
function darkComponents(idxRef: React.MutableRefObject<number>): Components {
  return {
    h1: (props) => {
      const id = `h-${idxRef.current++}`;
      return <h1 data-cv-id={id} style={darkHeadingStyle(1)} {...props} />;
    },
    h2: (props) => {
      const id = `h-${idxRef.current++}`;
      return <h2 data-cv-id={id} style={darkHeadingStyle(2)} {...props} />;
    },
    h3: (props) => {
      const id = `h-${idxRef.current++}`;
      return <h3 data-cv-id={id} style={darkHeadingStyle(3)} {...props} />;
    },
    h4: (props) => {
      const id = `h-${idxRef.current++}`;
      return <h4 data-cv-id={id} style={darkHeadingStyle(4)} {...props} />;
    },
    h5: (props) => {
      const id = `h-${idxRef.current++}`;
      return <h5 data-cv-id={id} style={darkHeadingStyle(5)} {...props} />;
    },
    h6: (props) => {
      const id = `h-${idxRef.current++}`;
      return <h6 data-cv-id={id} style={darkHeadingStyle(6)} {...props} />;
    },
    p: (props) => <p style={darkTextStyle}>{props.children}</p>,
    a: (props) => (
      <a style={darkLinkStyle} target="_blank" rel="noopener noreferrer">
        {props.children}
      </a>
    ),
    code: (props) => <code style={darkInlineCode}>{props.children}</code>,
    pre: (props) => <pre style={darkPreStyle}>{props.children}</pre>,
    blockquote: (props) => <blockquote style={darkBlockquoteStyle}>{props.children}</blockquote>,
    ul: (props) => <ul style={darkListStyle}>{props.children}</ul>,
    ol: (props) => <ol style={darkListStyle}>{props.children}</ol>,
    li: (props) => <li style={darkListItemStyle}>{props.children}</li>,
    table: (props) => <table style={darkTableStyle}>{props.children}</table>,
    th: (props) => <th style={darkThStyle}>{props.children}</th>,
    td: (props) => <td style={darkTdStyle}>{props.children}</td>,
    hr: (props) => <hr style={darkHrStyle} />,
    img: (props) => <img style={darkImgStyle} />,
  };
}

/* ---- Dark theme styles ---- */
function darkHeadingStyle(level: number): React.CSSProperties {
  const sizes: Record<number, number> = { 1: 26, 2: 22, 3: 18, 4: 16, 5: 15, 6: 14 };
  return {
    color: '#e6edf3',
    marginTop: '24px',
    marginBottom: '16px',
    paddingBottom: '8px',
    fontWeight: 600,
    fontSize: `${sizes[level]}px`,
    borderBottom: level <= 2 ? '1px solid #30363d' : 'none',
  };
}

const darkTextStyle: React.CSSProperties = {
  color: '#c9d1d9',
  lineHeight: 1.7,
  marginBottom: '16px',
};

const darkLinkStyle: React.CSSProperties = {
  color: '#58a6ff',
  textDecoration: 'none',
};

const darkInlineCode: React.CSSProperties = {
  backgroundColor: 'rgba(110,118,129,0.4)',
  padding: '2px 6px',
  borderRadius: 6,
  fontFamily: "'SF Mono', 'Fira Code', monospace",
  fontSize: '13px',
  color: '#ffa657',
};

const darkPreStyle: React.CSSProperties = {
  backgroundColor: '#161b22',
  borderRadius: 8,
  padding: '12px 16px',
  overflowX: 'auto',
  marginBottom: '16px',
  border: '1px solid #30363d',
};

const darkBlockquoteStyle: React.CSSProperties = {
  borderLeft: '4px solid #3b444b',
  margin: '0 0 16px 0',
  padding: '4px 16px',
  color: '#8b949e',
  backgroundColor: 'rgba(110,118,129,0.08)',
  borderRadius: '0 8px 8px 0',
};

const darkListStyle: React.CSSProperties = {
  paddingLeft: '24px',
  marginBottom: '16px',
  color: '#c9d1d9',
};

const darkListItemStyle: React.CSSProperties = {
  marginBottom: '4px',
  lineHeight: 1.6,
};

const darkTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  marginBottom: '16px',
  fontSize: '14px',
};

const darkThStyle: React.CSSProperties = {
  border: '1px solid #30363d',
  padding: '8px 12px',
  backgroundColor: '#161b22',
  color: '#e6edf3',
  fontWeight: 600,
  textAlign: 'left',
};

const darkTdStyle: React.CSSProperties = {
  border: '1px solid #30363d',
  padding: '8px 12px',
  color: '#c9d1d9',
};

const darkHrStyle: React.CSSProperties = {
  border: 'none',
  borderTop: '1px solid #30363d',
  margin: '24px 0',
};

const darkImgStyle: React.CSSProperties = {
  maxWidth: '100%',
  borderRadius: 8,
  margin: '8px 0',
};

/* ---- Layout ---- */
const layout: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#0d1117',
    color: '#c9d1d9',
    borderRadius: 8,
    overflow: 'hidden',
    minHeight: 0,
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    borderBottom: '1px solid #30363d',
    backgroundColor: '#161b22',
  },
  tocToggle: {
    marginLeft: 'auto',
  },
  body: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
    minHeight: 0,
  },
  sidebar: {
    width: 220,
    minWidth: 220,
    borderRight: '1px solid #30363d',
    backgroundColor: '#0d1117',
    overflowY: 'auto',
    padding: '12px 0',
  },
  sidebarTitle: {
    padding: '4px 12px 8px',
    fontSize: 12,
    fontWeight: 600,
    color: '#8b949e',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  tocLink: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'none',
    border: 'none',
    padding: '4px 8px',
    fontSize: 13,
    lineHeight: 1.5,
    cursor: 'pointer',
    borderRadius: 4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  contentArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    minHeight: 0,
    minWidth: 0,
  },
  previewPane: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    padding: '20px 28px',
  },
  sourcePane: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
  },
};
