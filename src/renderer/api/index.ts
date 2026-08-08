/**
 * Whether the app is running inside Electron (true) or in a browser via HTTP server (false).
 * Use this to hide Electron-only UI (settings, traffic lights, etc.) in browser mode.
 */
export const isElectronMode = (): boolean => !!window.electronAPI;
