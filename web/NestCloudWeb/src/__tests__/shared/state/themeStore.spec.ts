import { afterEach, describe, expect, it, vi } from 'vitest';
import html from '../../../../index.html?raw';

// Exercise the pre-paint script used by the browser before React starts.
async function openApp() {
  const page = new DOMParser().parseFromString(html, 'text/html');
  const root = document.documentElement;
  root.dataset.theme = page.documentElement.dataset.theme;
  root.dataset.bsTheme = page.documentElement.dataset.bsTheme;
  const script = page.head.querySelector('script')!;
  window.eval(script.textContent);
  vi.resetModules();
  return (await import('../../../shared/state/themeStore')).useThemeStore;
}

afterEach(() => {
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.bsTheme;
});

describe('主题切换', () => {
  it.each([
    [null, 'light', null],
    ['light', 'light', 'light'],
    ['dark', 'dark', 'dark'],
    ['abyss', 'dark', 'dark'],
    ['unknown', 'light', 'unknown'],
  ])('首次绘制和状态层使用同一主题（已保存 %s）', async (saved, expected, persisted) => {
    if (saved) localStorage.setItem('theme', saved);
    const store = await openApp();
    expect(store.getState().themes).toEqual(['light', 'dark']);
    expect(store.getState().theme).toBe(expected);
    expect(document.documentElement.dataset.theme).toBe(expected);
    expect(document.documentElement.dataset.bsTheme).toBe(expected);
    expect(localStorage.getItem('theme')).toBe(persisted);
  });

  it('切换会通知订阅者并在刷新后保留', async () => {
    const store = await openApp();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.getState().setTheme('dark');
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    expect(localStorage.getItem('theme')).toBe('dark');
    expect((await openApp()).getState().theme).toBe('dark');
  });

  it('存储不可用时仍可在当前页切换', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    const store = await openApp();
    expect(store.getState().theme).toBe('light');
    store.getState().setTheme('dark');
    expect(document.documentElement.dataset.bsTheme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
