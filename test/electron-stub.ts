/**
 * Vitest stub for the `electron` module.
 *
 * Main-process unit tests transitively import modules that do value-imports of
 * `electron` (e.g. `import { app } from "electron"` in telemetry). The real
 * `electron` package's entry point throws when its binary isn't resolvable in a
 * plain Node/vitest context — which happens on CI (notably Windows). Unit tests
 * of our own logic shouldn't depend on the Electron runtime at all, so we alias
 * `electron` to this lightweight stub in `vitest.config.ts`.
 *
 * Only the surface our code touches at import/test time is provided; extend as
 * needed. Behaviour is intentionally inert (no-ops / neutral defaults).
 */
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";

type AnyFn = (...args: unknown[]) => unknown;

const appEmitter = new EventEmitter();

export const app = Object.assign(appEmitter, {
  getVersion: (): string => "0.0.0-test",
  getName: (): string => "Argus",
  getPath: (name: string): string => path.join(os.tmpdir(), "argus-test", name),
  getAppPath: (): string => process.cwd(),
  isPackaged: false,
  whenReady: (): Promise<void> => Promise.resolve(),
  quit: (): void => {},
  exit: (): void => {},
  setAppUserModelId: (): void => {},
  requestSingleInstanceLock: (): boolean => true,
});

export class BrowserWindow extends EventEmitter {
  webContents = new EventEmitter();
  static getAllWindows(): BrowserWindow[] {
    return [];
  }
  static fromWebContents(): BrowserWindow | undefined {
    return undefined;
  }
  loadURL(): Promise<void> {
    return Promise.resolve();
  }
  show(): void {}
  hide(): void {}
  destroy(): void {}
  isDestroyed(): boolean {
    return false;
  }
}

export class Tray extends EventEmitter {
  setToolTip(): void {}
  setImage(): void {}
  setContextMenu(): void {}
  destroy(): void {}
}

export const Menu = {
  setApplicationMenu: (): void => {},
  buildFromTemplate: (): Record<string, unknown> => ({}),
};

export const nativeImage = {
  createFromPath: (): { isEmpty: () => boolean; resize: AnyFn } => ({
    isEmpty: () => true,
    resize: () => ({}),
  }),
  createEmpty: (): Record<string, unknown> => ({}),
};

export const dialog = {
  showOpenDialog: (): Promise<{ canceled: boolean; filePaths: string[] }> =>
    Promise.resolve({ canceled: true, filePaths: [] }),
  showSaveDialog: (): Promise<{ canceled: boolean; filePath?: string }> =>
    Promise.resolve({ canceled: true }),
  showMessageBox: (): Promise<{ response: number }> =>
    Promise.resolve({ response: 0 }),
};

export const shell = {
  openExternal: (): Promise<void> => Promise.resolve(),
  openPath: (): Promise<string> => Promise.resolve(""),
  showItemInFolder: (): void => {},
  trashItem: (): Promise<void> => Promise.resolve(),
};

export const clipboard = {
  readText: (): string => "",
  writeText: (): void => {},
};

export const ipcMain = {
  handle: (): void => {},
  on: (): void => {},
  removeHandler: (): void => {},
};

export const safeStorage = {
  isEncryptionAvailable: (): boolean => false,
  encryptString: (s: string): Buffer => Buffer.from(s, "utf-8"),
  decryptString: (b: Buffer): string => b.toString("utf-8"),
};

export const globalShortcut = {
  register: (): boolean => true,
  unregister: (): void => {},
  unregisterAll: (): void => {},
  isRegistered: (): boolean => false,
};

export const screen = {
  getPrimaryDisplay: (): Record<string, unknown> => ({
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
  }),
  getAllDisplays: (): Record<string, unknown>[] => [],
};

export const nativeTheme = Object.assign(new EventEmitter(), {
  shouldUseDarkColors: true,
});

export const systemPreferences = {
  getMediaAccessStatus: (): string => "granted",
};

const electronStub = {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  dialog,
  shell,
  clipboard,
  ipcMain,
  safeStorage,
  globalShortcut,
  screen,
  nativeTheme,
  systemPreferences,
};

export default electronStub;
