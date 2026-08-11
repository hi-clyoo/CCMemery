/**
 * CC Memory — Main process entry point.
 */

import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  DEV_SERVER_PORT,
  getTrafficLightPositionForZoom,
  WINDOW_ZOOM_FACTOR_CHANGED_CHANNEL,
} from '@shared/constants';
import { createLogger } from '@shared/utils/logger';
import { app, BrowserWindow } from 'electron';
import { existsSync } from 'fs';
import { totalmem } from 'os';
import { join } from 'path';

import { initializeIpcHandlers, removeIpcHandlers } from './ipc/handlers';
import { getProjectsBasePath, getTodosBasePath } from './utils/pathDecoder';
import {
  configManager,
  configManagerPromise,
  LocalFileSystemProvider,
  NotificationManager,
  ServiceContext,
  ServiceContextRegistry,
} from './services';

const totalMB = Math.floor(totalmem() / (1024 * 1024));
const heapMB = Math.min(4096, Math.max(2048, Math.floor(totalMB * 0.5)));
app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${heapMB}`);

const getWindowIconPath = (): string | undefined => {
  const isDev = process.env.NODE_ENV === 'development';
  const candidates = isDev
    ? [join(process.cwd(), 'resources/icon.png')]
    : [
        join(process.resourcesPath, 'resources/icon.png'),
        join(__dirname, '../../resources/icon.png'),
      ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
};

function setMacDockIcon(): void {
  if (process.platform !== 'darwin' || !app.dock || app.isPackaged) return;
  const iconPath = getWindowIconPath();
  if (iconPath) app.dock.setIcon(iconPath);
}

const logger = createLogger('App');

let mainWindow: BrowserWindow | null = null;
let contextRegistry: ServiceContextRegistry;
let notificationManager: NotificationManager;
let fileChangeCleanup: (() => void) | null = null;
let todoChangeCleanup: (() => void) | null = null;

function getRendererIndexPath(): string {
  const candidates = [
    join(__dirname, '../../out/renderer/index.html'),
    join(__dirname, '../renderer/index.html'),
  ];
  return candidates.find((c) => existsSync(c)) ?? candidates[0];
}

function wireFileWatcherEvents(context: ServiceContext): void {
  if (fileChangeCleanup) { fileChangeCleanup(); fileChangeCleanup = null; }
  if (todoChangeCleanup) { todoChangeCleanup(); todoChangeCleanup = null; }

  const fileChangeHandler = (event: unknown): void => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('file-change', event);
  };
  context.fileWatcher.on('file-change', fileChangeHandler);
  fileChangeCleanup = () => context.fileWatcher.off('file-change', fileChangeHandler);

  const todoChangeHandler = (event: unknown): void => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('todo-change', event);
  };
  context.fileWatcher.on('todo-change', todoChangeHandler);
  todoChangeCleanup = () => context.fileWatcher.off('todo-change', todoChangeHandler);

  const memoryChangeHandler = (event: unknown): void => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('memory:changed', event);
  };
  context.fileWatcher.on('memory-change', memoryChangeHandler);
}

export function rewireContextEvents(context: ServiceContext): void {
  wireFileWatcherEvents(context);
}

function reconfigureLocalContextForClaudeRoot(): void {
  try {
    const currentLocal = contextRegistry.get('local');
    if (!currentLocal) return;

    const wasLocalActive = contextRegistry.getActiveContextId() === 'local';
    const projectsDir = getProjectsBasePath();
    const todosDir = getTodosBasePath();

    if (wasLocalActive) currentLocal.stopFileWatcher();

    const replacementLocal = new ServiceContext({
      id: 'local', type: 'local',
      fsProvider: new LocalFileSystemProvider(),
      projectsDir, todosDir,
    });
    if (notificationManager) replacementLocal.fileWatcher.setNotificationManager(notificationManager);
    replacementLocal.start();
    if (!wasLocalActive) replacementLocal.stopFileWatcher();
    contextRegistry.replaceContext('local', replacementLocal);
    if (wasLocalActive) wireFileWatcherEvents(replacementLocal);
  } catch (error) {
    logger.error('Failed to reconfigure local context:', error);
  }
}

function initializeServices(): void {
  contextRegistry = new ServiceContextRegistry();

  const localContext = new ServiceContext({
    id: 'local', type: 'local',
    fsProvider: new LocalFileSystemProvider(),
    projectsDir: getProjectsBasePath(),
    todosDir: getTodosBasePath(),
  });
  contextRegistry.registerContext(localContext);
  localContext.start();

  notificationManager = NotificationManager.getInstance();
  localContext.fileWatcher.setNotificationManager(notificationManager);
  wireFileWatcherEvents(localContext);

  initializeIpcHandlers(contextRegistry, {
    rewire: rewireContextEvents,
    onClaudeRootPathUpdated: () => reconfigureLocalContextForClaudeRoot(),
  });

  logger.info('Services initialized');
}

function shutdownServices(): void {
  if (fileChangeCleanup) { fileChangeCleanup(); fileChangeCleanup = null; }
  if (todoChangeCleanup) { todoChangeCleanup(); todoChangeCleanup = null; }
  if (contextRegistry) contextRegistry.dispose();
  removeIpcHandlers();
}

function syncTrafficLightPosition(win: BrowserWindow): void {
  const zoomFactor = win.webContents.getZoomFactor();
  if (process.platform === 'darwin') win.setWindowButtonPosition(getTrafficLightPositionForZoom(zoomFactor));
  win.webContents.send(WINDOW_ZOOM_FACTOR_CHANGED_CHANNEL, zoomFactor);
}

function createWindow(): void {
  const isMac = process.platform === 'darwin';
  const iconPath = isMac ? undefined : getWindowIconPath();
  const useNativeTitleBar = !isMac && configManager.getConfig().general.useNativeTitleBar;
  mainWindow = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false, contextIsolation: true, backgroundThrottling: false,
    },
    backgroundColor: '#1a1a1a',
    ...(useNativeTitleBar ? {} : { titleBarStyle: 'hidden' as const }),
    ...(isMac && { trafficLightPosition: getTrafficLightPositionForZoom(1) }),
    title: 'CC Memory',
  });

  if (process.env.NODE_ENV === 'development') {
    void mainWindow.loadURL(`http://localhost:${DEV_SERVER_PORT}`);
    mainWindow.webContents.openDevTools();
  } else {
    void mainWindow.loadFile(getRendererIndexPath());
  }

  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed()) syncTrafficLightPosition(mainWindow);
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (isMain) logger.error(`Renderer load failed (${code}): ${desc} - ${url}`);
  });

  const MIN_ZOOM = -3, MAX_ZOOM = 5;
  const ZOOM_IN = new Set(['+', '=']), ZOOM_OUT = new Set(['-', '_']);
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!mainWindow || mainWindow.isDestroyed() || input.type !== 'keyDown') return;
    if ((input.control || input.meta) && !input.shift && input.key.toLowerCase() === 'r') {
      event.preventDefault();
      mainWindow.webContents.send('session:refresh');
      return;
    }
    if ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'r') {
      event.preventDefault(); return;
    }
    if (!input.meta) return;
    const level = mainWindow.webContents.getZoomLevel();
    if (ZOOM_OUT.has(input.key) && level <= MIN_ZOOM) { event.preventDefault(); return; }
    if (ZOOM_IN.has(input.key) && level >= MAX_ZOOM) { event.preventDefault(); return; }
    if (ZOOM_IN.has(input.key) || ZOOM_OUT.has(input.key) || input.key === '0') {
      setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) syncTrafficLightPosition(mainWindow); }, 100);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (notificationManager) notificationManager.setMainWindow(null);
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logger.error('Renderer process gone:', details.reason, details.exitCode);
  });

  if (notificationManager) notificationManager.setMainWindow(mainWindow);
  logger.info('Main window created');
}

void app.whenReady().then(async () => {
  try {
    await configManagerPromise;
    initializeServices();
    const config = configManager.getConfig();
    app.setLoginItemSettings({ openAtLogin: config.general.launchAtLogin });
    setMacDockIcon();
    createWindow();
    notificationManager.on('notification-clicked', () => {
      if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    });
  } catch (error) {
    logger.error('Startup failed:', error);
    if (!mainWindow) createWindow();
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Single instance — bring existing window to front
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => shutdownServices());
