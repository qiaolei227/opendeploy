import { useEffect, type ReactElement, type ReactNode } from 'react';
import { useSettingsStore } from '../stores/settings-store';

const DARK_CLASS = 'theme-dark';

/**
 * Applies the current theme setting to the document.
 *
 * The design system targets `body.theme-dark` (see design/styles.css line 48),
 * so we toggle that class on `document.body` rather than on `html`.
 *
 * When `theme === 'system'`, we subscribe to the OS `prefers-color-scheme`
 * media query so the UI flips automatically when the user toggles their
 * system theme.
 */
export function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
  const theme = useSettingsStore((state) => state.settings.theme);

  useEffect(() => {
    const body = document.body;

    const apply = (isDark: boolean): void => {
      body.classList.toggle(DARK_CLASS, isDark);
    };

    if (theme === 'dark') {
      apply(true);
      return;
    }

    if (theme === 'light') {
      apply(false);
      return;
    }

    // system: follow the OS preference and react to changes
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    apply(media.matches);

    const handleChange = (event: MediaQueryListEvent): void => {
      apply(event.matches);
    };

    media.addEventListener('change', handleChange);
    return () => {
      media.removeEventListener('change', handleChange);
    };
  }, [theme]);

  return <>{children}</>;
}
