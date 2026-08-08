import { createLogger } from '@shared/utils/logger';
import { ipcMain } from 'electron';

import { initializeConfigHandlers, registerConfigHandlers, removeConfigHandlers } from './config';
import { initializeContextHandlers, registerContextHandlers, removeContextHandlers } from './context';
const logger = createLogger('IPC:handlers');
import { initializeMemoryHandlers, registerMemoryHandlers, removeMemoryHandlers } from './memory';
import { registerNotificationHandlers, removeNotificationHandlers } from './notifications';
import { initializeProjectHandlers, registerProjectHandlers, removeProjectHandlers } from './projects';
import { initializeSearchHandlers, registerSearchHandlers, removeSearchHandlers } from './search';
import { initializeSessionHandlers, registerSessionHandlers, removeSessionHandlers } from './sessions';
import { initializeSubagentHandlers, registerSubagentHandlers, removeSubagentHandlers } from './subagents';
import { registerUtilityHandlers, removeUtilityHandlers } from './utility';
import { registerValidationHandlers, removeValidationHandlers } from './validation';
import { registerWindowHandlers, removeWindowHandlers } from './window';

import type { ServiceContext, ServiceContextRegistry } from '../services';

export function initializeIpcHandlers(
  registry: ServiceContextRegistry,
  contextCallbacks: {
    rewire: (context: ServiceContext) => void;
    onClaudeRootPathUpdated: (claudeRootPath: string | null) => Promise<void> | void;
  }
): void {
  initializeProjectHandlers(registry);
  initializeSessionHandlers(registry);
  initializeSearchHandlers(registry);
  initializeSubagentHandlers(registry);
  initializeContextHandlers(registry, contextCallbacks.rewire);
  initializeMemoryHandlers(registry);
  initializeConfigHandlers({ onClaudeRootPathUpdated: contextCallbacks.onClaudeRootPathUpdated });

  registerProjectHandlers(ipcMain);
  registerSessionHandlers(ipcMain);
  registerSearchHandlers(ipcMain);
  registerSubagentHandlers(ipcMain);
  registerValidationHandlers(ipcMain);
  registerUtilityHandlers(ipcMain);
  registerNotificationHandlers(ipcMain);
  registerConfigHandlers(ipcMain);
  registerContextHandlers(ipcMain);
  registerMemoryHandlers(ipcMain);
  registerWindowHandlers(ipcMain);
}

export function removeIpcHandlers(): void {
  removeProjectHandlers(ipcMain);
  removeSessionHandlers(ipcMain);
  removeSearchHandlers(ipcMain);
  removeSubagentHandlers(ipcMain);
  removeValidationHandlers(ipcMain);
  removeUtilityHandlers(ipcMain);
  removeNotificationHandlers(ipcMain);
  removeConfigHandlers(ipcMain);
  removeContextHandlers(ipcMain);
  removeMemoryHandlers(ipcMain);
  removeWindowHandlers(ipcMain);
}
