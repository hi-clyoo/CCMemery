/**
 * CustomTitleBar - Conventional title bar for Windows and Linux when the native frame is hidden.
 *
 * Renders a draggable top strip with window controls (minimize, maximize/restore, close)
 * on the right. Only shown in Electron on Windows or Linux (macOS uses native traffic lights).
 */

import { useEffect, useState } from 'react';

import { isElectronMode } from '@renderer/api';
import iconUrl from '@renderer/icon.svg';
import { Minus, Square, X, Sun, Moon } from 'lucide-react';

const TITLE_BAR_HEIGHT = 32;

function needsCustomTitleBar(): boolean {
  if (!isElectronMode()) return false;
  const ua = window.navigator.userAgent;
  return ua.includes('Windows') || ua.includes('Linux');
}

export const CustomTitleBar = (): React.JSX.Element | null => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [useNativeTitleBar, setUseNativeTitleBar] = useState(false);
  const [isLight, setIsLight] = useState(() => document.documentElement.classList.contains('light'));
  const showTitleBar = needsCustomTitleBar() && !useNativeTitleBar;
  const api = typeof window !== 'undefined' ? window.electronAPI?.windowControls : null;

  const toggleTheme = () => {
    const root = document.documentElement;
    root.classList.toggle('light');
    const nowLight = root.classList.contains('light');
    setIsLight(nowLight);
    try { localStorage.setItem('claude-devtools-theme-cache', nowLight ? 'light' : 'dark'); } catch { /* */ }
  };

  useEffect(() => {
    if (api) void api.isMaximized().then(setIsMaximized);
  }, [api]);

  useEffect(() => {
    window.electronAPI?.config?.get().then(cfg => {
      setUseNativeTitleBar(cfg?.general?.useNativeTitleBar ?? false);
    }).catch(() => {});
  }, []);

  if (!showTitleBar || !api) return null;

  const { minimize, maximize, close, isMaximized: getIsMaximized } = api;

  const handleMaximize = async (): Promise<void> => {
    await maximize();
    const maximized = await getIsMaximized();
    setIsMaximized(maximized);
  };

  const buttonBase =
    'flex h-full w-12 items-center justify-center transition-colors border-0 outline-none';
  const buttonHover = 'hover:bg-white/10';

  const titleBarStyle = {
    height: `${TITLE_BAR_HEIGHT}px`,
    backgroundColor: 'var(--color-surface-sidebar)',
    borderBottom: '1px solid var(--color-border)',
    WebkitAppRegion: 'drag',
  } as React.CSSProperties;

  return (
    <div className="flex shrink-0 select-none items-stretch" style={titleBarStyle}>
      {/* Draggable area — app icon */}
      <div className="flex flex-1 items-center pl-3" style={{ minWidth: 0 }}>
        <img src={iconUrl} alt="" className="size-5 shrink-0 rounded-sm" draggable={false} />
        <button
          type="button"
          onClick={toggleTheme}
          className="ml-2 p-1 rounded transition-colors hover:bg-white/10"
          style={{ color: 'var(--color-text-secondary)', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title={isLight ? 'Switch to dark' : 'Switch to light'}
          aria-label="Toggle theme"
        >
          {isLight ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
        </button>
      </div>

      {/* Window controls — no-drag so they receive clicks */}
      <div className="flex shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          type="button"
          className={`${buttonBase} ${buttonHover}`}
          style={{ color: 'var(--color-text-secondary)' }}
          onClick={() => void minimize()}
          title="Minimize"
          aria-label="Minimize"
        >
          <Minus className="size-4" strokeWidth={2.5} />
        </button>
        <button
          type="button"
          className={`${buttonBase} ${buttonHover}`}
          style={{ color: 'var(--color-text-secondary)' }}
          onClick={() => void handleMaximize()}
          title={isMaximized ? 'Restore' : 'Maximize'}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          <Square className="size-3.5" strokeWidth={2.5} />
        </button>
        <button
          type="button"
          className={`${buttonBase} hover:bg-red-500/90 hover:text-white`}
          style={{ color: 'var(--color-text-secondary)' }}
          onClick={() => void close()}
          title="Close"
          aria-label="Close"
        >
          <X className="size-4" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
};
