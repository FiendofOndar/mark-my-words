export type Theme = 'dark' | 'light';

const KEY = 'mmw-theme';
export const DEFAULT_THEME: Theme = 'dark';

/**
 * A per-device display preference, so it belongs in localStorage rather than
 * the database. Reads can throw in a private window or with site data blocked.
 */
export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === 'light' || stored === 'dark' ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'light' ? '#f3efe4' : '#111014');
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* preference simply will not stick */
  }
}
