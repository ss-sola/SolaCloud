import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useThemeStore } from '../../../shared/state/themeStore';

function resetStore() {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  useThemeStore.getState().setTheme('light');
}

describe('themeStore', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    resetStore();
  });

  it('should default to light theme when no localStorage value exists', () => {
    const state = useThemeStore.getState();
    expect(state.theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('should persist theme to localStorage when setTheme is called', () => {
    useThemeStore.getState().setTheme('dark');
    const state = useThemeStore.getState();

    expect(localStorage.getItem('theme')).toBe('dark');
    expect(state.theme).toBe('dark');
  });

  it('should update document.documentElement.dataset.theme when setTheme is called', () => {
    useThemeStore.getState().setTheme('abyss');

    expect(document.documentElement.getAttribute('data-theme')).toBe('abyss');
  });

  it('should update reactively via Zustand subscription', () => {
    let captured: string = 'light';

    const unsub = useThemeStore.subscribe((s) => {
      captured = s.theme;
    });

    useThemeStore.getState().setTheme('dark');
    expect(captured).toBe('dark');

    unsub();
  });
});
