import { useId, useSyncExternalStore, type ReactNode } from 'react';
import { useSystemPageFrame } from './SystemPageFrameContext';
import styles from './SystemPageFrame.module.css';

interface Props {
  sidebar: ReactNode;
  toolbarRight: ReactNode;
  hideHeader?: boolean;
  viewportWorkspace?: boolean;
  children: ReactNode;
}

const compactWidth = '(max-width: 960px)';

function subscribeWidth(callback: () => void) {
  const media = window.matchMedia?.(compactWidth);
  media?.addEventListener('change', callback);
  return () => media?.removeEventListener('change', callback);
}

function CompactNavigation({ sidebar }: { sidebar: ReactNode }) {
  const id = useId();
  return (
    <>
      <button
        className={styles.menuButton}
        type="button"
        popoverTarget={id}
        aria-controls={id}
        aria-label="管理菜单"
      >
        菜单
      </button>
      <div
        className={styles.menu}
        id={id}
        popover="auto"
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest('a'))
            event.currentTarget.hidePopover();
        }}
      >
        {sidebar}
      </div>
    </>
  );
}

export function SystemPageFrame({
  sidebar,
  toolbarRight,
  hideHeader,
  viewportWorkspace,
  children,
}: Props) {
  const { frameState } = useSystemPageFrame();
  const narrowScreen = useSyncExternalStore(
    subscribeWidth,
    () => Boolean(window.matchMedia?.(compactWidth).matches),
    () => false,
  );
  const compactNavigation = viewportWorkspace && narrowScreen && Boolean(sidebar);

  return (
    <div className={viewportWorkspace ? `system-layout ${styles.viewport}` : 'system-layout'}>
      {(!hideHeader || compactNavigation) && (
        <header className="topbar">
          {compactNavigation && <CompactNavigation sidebar={sidebar} />}
          {!hideHeader && (
            <>
              <h1 className="topbar-title" title={frameState.title}>
                {frameState.title}
              </h1>
              {toolbarRight}
            </>
          )}
        </header>
      )}
      <div className="system-workspace">
        {!compactNavigation && sidebar}
        <main className="page-body">{children}</main>
      </div>
    </div>
  );
}
