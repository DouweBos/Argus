/**
 * Fan-out hub for H.264 device frames to non-renderer consumers (the remote
 * gateway). The desktop UI receives frames via `webContents.send` directly;
 * this module lets the gateway subscribe to the same config/frame stream
 * without going through Electron IPC or the renderer broadcast tap.
 *
 * Keyed by device id (iOS UDID / Android serial). The last-seen config is
 * cached per device so a late subscriber can configure its decoder
 * immediately instead of waiting for the next keyframe.
 */

import type { H264Config } from "./h264-parser";

export interface VideoForwardListener {
  onConfig: (config: H264Config) => void;
  onFrame: (data: Uint8Array, keyFrame: boolean, timestamp: number) => void;
}

const listenersByDevice = new Map<string, Set<VideoForwardListener>>();
const lastConfigByDevice = new Map<string, H264Config>();

/**
 * Subscribe to a device's frame stream. If a config was already seen it is
 * delivered synchronously so the decoder can initialize right away. Returns an
 * unsubscribe function.
 */
export function onVideo(
  deviceId: string,
  listener: VideoForwardListener,
): () => void {
  let set = listenersByDevice.get(deviceId);
  if (!set) {
    set = new Set();
    listenersByDevice.set(deviceId, set);
  }
  set.add(listener);

  const cached = lastConfigByDevice.get(deviceId);
  if (cached) {
    listener.onConfig(cached);
  }

  return () => {
    const current = listenersByDevice.get(deviceId);
    if (!current) {
      return;
    }
    current.delete(listener);
    if (current.size === 0) {
      listenersByDevice.delete(deviceId);
    }
  };
}

export function emitVideoConfig(deviceId: string, config: H264Config): void {
  lastConfigByDevice.set(deviceId, config);
  const set = listenersByDevice.get(deviceId);
  if (set) {
    for (const l of set) {
      l.onConfig(config);
    }
  }
}

export function emitVideoFrame(
  deviceId: string,
  data: Uint8Array,
  keyFrame: boolean,
  timestamp: number,
): void {
  const set = listenersByDevice.get(deviceId);
  if (set) {
    for (const l of set) {
      l.onFrame(data, keyFrame, timestamp);
    }
  }
}

/** Last-known coded dimensions for a device, for the device list. */
export function getVideoDims(
  deviceId: string,
): { width: number; height: number } | undefined {
  const cfg = lastConfigByDevice.get(deviceId);

  return cfg ? { width: cfg.codedWidth, height: cfg.codedHeight } : undefined;
}

/** Drop the cached config when a device's capture ends. */
export function clearVideo(deviceId: string): void {
  lastConfigByDevice.delete(deviceId);
}
