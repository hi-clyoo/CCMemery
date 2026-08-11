/**
 * useTheme - Shared dark/light theme state.
 *
 * The theme is driven by the `light` class on <html>, persisted to
 * localStorage under THEME_STORAGE_KEY (read by index.html before React
 * mounts to avoid a flash of the wrong theme).
 *
 * Multiple components (sidebar toggle, Win/Linux CustomTitleBar toggle) share
 * this hook. Toggling dispatches THEME_CHANGE_EVENT so every mounted instance
 * stays in sync even though each holds its own local `isLight` state.
 */

import { useCallback, useEffect, useState } from 'react';

export const THEME_STORAGE_KEY = 'cc-memory-theme-cache';
export const THEME_CHANGE_EVENT = 'cc-memory-theme-change';

function isLightTheme(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('light');
}

export function useTheme() {
  const [isLight, setIsLight] = useState<boolean>(isLightTheme);

  useEffect(() => {
    const sync = (): void => setIsLight(isLightTheme());
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, sync);
  }, []);

  const setTheme = useCallback((light: boolean): void => {
    const root = document.documentElement;
    root.classList.toggle('light', light);
    try { localStorage.setItem(THEME_STORAGE_KEY, light ? 'light' : 'dark'); } catch { /* */ }
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
  }, []);

  const toggleTheme = useCallback((): void => setTheme(!isLightTheme()), [setTheme]);

  return { isLight, setTheme, toggleTheme };
}
