import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { getRouteByPath } from '../app/routes/appRoutes';
import { SystemPageFrame } from '../modules/system/pages/SystemPageFrame';
import { SystemPageFrameProvider } from '../modules/system/pages/SystemPageFrameContext';

const state = {
  title: '接口调用图',
  description: '',
  serviceLabel: '',
  capabilityLabel: '',
  descriptionLabel: '',
};

function frame(viewportWorkspace: boolean) {
  return (
    <SystemPageFrameProvider initialState={state}>
      <SystemPageFrame
        viewportWorkspace={viewportWorkspace}
        toolbarRight={<button type="button">账户</button>}
        sidebar={
          <aside className="system-sidebar">
            <nav>
              <a href="#trace">链路日志</a>
            </nav>
          </aside>
        }
      >
        <p>图内容</p>
      </SystemPageFrame>
    </SystemPageFrameProvider>
  );
}

afterEach(() => vi.unstubAllGlobals());

it('只给接口调用图启用工作区，按屏幕大小移动同一套导航', () => {
  expect(getRouteByPath('/system/api-call-graph')?.meta.viewportWorkspace).toBe(true);
  expect(getRouteByPath('/system/trace-log')!.meta.viewportWorkspace).toBeUndefined();
  let narrow = true;
  const change = new EventTarget();
  vi.stubGlobal('matchMedia', () => ({
    matches: narrow,
    addEventListener: change.addEventListener.bind(change),
    removeEventListener: change.removeEventListener.bind(change),
  }));
  const screen = render(frame(true));
  const trigger = screen.getByRole('button', { name: '管理菜单' });
  const menu = screen.container.querySelector<HTMLElement>('[popover]')!;
  expect(trigger.getAttribute('popovertarget')).toBe(menu.id);
  expect(trigger.getAttribute('aria-controls')).toBe(menu.id);
  expect(menu.getAttribute('popover')).toBe('auto');
  expect(screen.container.querySelector('.system-workspace > .system-sidebar')).toBe(null);
  const hide = vi.fn();
  menu.hidePopover = hide;
  fireEvent.click(menu.querySelector('a')!);
  expect(hide).toHaveBeenCalledOnce();
  act(() => {
    narrow = false;
    change.dispatchEvent(new Event('change'));
  });
  expect(screen.queryByRole('button', { name: '管理菜单' })).toBe(null);
  expect(screen.container.querySelector('.system-workspace > .system-sidebar nav')).toBeTruthy();
  expect(screen.getByRole('main')).toHaveTextContent('图内容');
  act(() => {
    narrow = true;
    change.dispatchEvent(new Event('change'));
  });
  screen.rerender(frame(false));
  expect(screen.container.querySelector('[popover]')).toBe(null);
  expect(screen.container.querySelector('.system-workspace > .system-sidebar nav')).toBeTruthy();
});
