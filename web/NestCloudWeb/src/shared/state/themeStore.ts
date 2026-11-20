import { create } from 'zustand';

export const THEMES = ['light', 'dark', 'abyss'] as const;
export type Theme = (typeof THEMES)[number];

interface ThemeState {
  theme: Theme;
  themes: readonly Theme[];
  setTheme: (theme: Theme) => void;
}

function resolveInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem('theme');
    if (stored && THEMES.includes(stored as Theme)) {
      return stored as Theme;
    }
  } catch {
    // localStorage unavailable
  }
  return 'light';
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export const useThemeStore = create<ThemeState>((set) => {
  const initial = resolveInitialTheme();
  applyTheme(initial);

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
