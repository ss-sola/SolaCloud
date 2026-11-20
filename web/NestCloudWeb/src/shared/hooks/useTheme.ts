import { useThemeStore } from '../state/themeStore';

/**
 * Hook for accessing theme state and the setTheme setter.
 * Re-exports from Zustand store for convenience.
 */
export function useTheme() {
  return {
    theme: useThemeStore((state) => state.theme),
    themes: useThemeStore((state) => state.themes),
    setTheme: useThemeStore((state) => state.setTheme),
  };
}
