import type { ReactNode } from 'react';

interface Props {
  title: string;
  description: string;
  toolbarRight: ReactNode;
  infoStrip?: ReactNode;
  /** 隐藏顶部 header（topbar），通过菜单 meta.hideHeader 控制 */
  hideHeader?: boolean;
  /** 隐藏 info-strip 信息条，通过菜单 meta.hideInfoStrip 控制 */
  hideInfoStrip?: boolean;
  children: ReactNode;
}

export function SystemPageFrame({
  title,
  description,
  toolbarRight,
  infoStrip,
  hideHeader,
  hideInfoStrip,
  children,
}: Props) {
  return (
    <>
      {!hideHeader ? (
        <header className="topbar">
          <div className="topbar-main">
            <div className="topbar-title">{title}</div>
            <div className="topbar-subtitle">{description}</div>
          </div>
          <div className="topbar-right">{toolbarRight}</div>
        </header>
      ) : null}
      {/* {!hideInfoStrip && infoStrip ? (
        <section className="info-strip" aria-label="当前页信息">
          {infoStrip}
        </section>
      ) : null} */}
      <section className="page-body">{children}</section>
    </>
  );
}
