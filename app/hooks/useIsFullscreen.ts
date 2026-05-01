import { useSyncExternalStore } from "react";

let fullscreen = false;
const listeners = new Set<() => void>();
let subscribed = false;

function emit(): void {
  for (const l of listeners) {
    l();
  }
}

function ensureSubscribed(): void {
  if (subscribed) {
    return;
  }
  subscribed = true;
  window.argus.on<{ fullscreen: boolean }>("window:fullscreen", (payload) => {
    if (fullscreen !== payload.fullscreen) {
      fullscreen = payload.fullscreen;
      emit();
    }
  });
}

function subscribe(cb: () => void): () => void {
  ensureSubscribed();
  listeners.add(cb);

  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): boolean {
  return fullscreen;
}

/** Whether the Electron main window is in native macOS fullscreen. */
export function useIsFullscreen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
