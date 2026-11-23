import { create } from 'zustand';

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

interface ThemeState {
  theme: Theme;
  themes: readonly Theme[];
  setTheme: (theme: Theme) => void;
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.bsTheme = theme;
}

export const useThemeStore = create<ThemeState>((set) => {
  // index.html resolves the saved preference before the first paint.
  const initial = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

  return {
    theme: initial,
    themes: THEMES,
    setTheme: (theme: Theme) => {
      applyTheme(theme);
      try {
        localStorage.setItem('theme', theme);
      } catch {
        // localStorage unavailable
      }
      set({ theme });
    },
  };
});
