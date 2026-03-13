/**
 * Preload script — exposes a typed `stagehand` API to the renderer via
 * contextBridge. This is the only bridge between the renderer (React) and
 * the main process (Node.js).
 */

import { contextBridge, ipcRenderer } from "electron";

export interface StagehandAPI {
  invoke<T>(channel: string, args?: Record<string, unknown>): Promise<T>;
  on<T>(event: string, callback: (payload: T) => void): () => void;
}

const api: StagehandAPI = {
  /**
   * Calls ipcRenderer.invoke() and returns the result as a typed promise.
   * Errors thrown in the handler reject the returned promise.
   */
  invoke<T>(channel: string, args?: Record<string, unknown>): Promise<T> {
    return ipcRenderer.invoke(channel, args);
  },

  /**
   * Subscribe to a push event from the main process.
   * Returns an unlisten function.
   */
  on<T>(event: string, callback: (payload: T) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, payload: T) => {
      callback(payload);
    };
    ipcRenderer.on(event, handler);
    return () => {
      ipcRenderer.removeListener(event, handler);
    };
  },
};

contextBridge.exposeInMainWorld("stagehand", api);
