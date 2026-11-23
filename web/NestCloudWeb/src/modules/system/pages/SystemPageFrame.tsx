import type { ReactNode } from 'react';
import { useSystemPageFrame } from './SystemPageFrameContext';

interface Props {
  sidebar: ReactNode;
  toolbarRight: ReactNode;
  hideHeader?: boolean;
  children: ReactNode;
}

export function SystemPageFrame({ sidebar, toolbarRight, hideHeader, children }: Props) {
  const { frameState } = useSystemPageFrame();

  return (
    <div className="system-layout">
      {!hideHeader && (
        <header className="topbar">
          <h1 className="topbar-title" title={frameState.title}>
            {frameState.title}
          </h1>
          {toolbarRight}
        </header>
      )}
      <div className="system-workspace">
        {sidebar}
        <main className="page-body">{children}</main>
      </div>
    </div>
  );
}
