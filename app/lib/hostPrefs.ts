/**
 * Keeps the renderer's host-owned `localStorage` entries (`hostPrefBindings`)
 * in step with this Mac's host. Stores keep reading `localStorage`
 * synchronously; it is a cache the host fills at boot and every write goes
 * back to it.
 *
 * A second window can share the host (Argus for Mac attached to this app), so
 * the host's `prefs:changed` refetches what it names; last write wins.
 */

import type { AppSettings } from "./types";
import { PREF_BINDINGS, type PrefBinding, slotId } from "./hostPrefBindings";
import { localTransport } from "./transport/local";

/** Set once this renderer's own values have been handed to the host. */
const IMPORTED_KEY = "argus:host-prefs-imported";
const FLUSH_DELAY_MS = 300;

export interface HostPrefsIo {
  getAppSettings: () => Promise<AppSettings>;
  getUiState: (key: string) => Promise<string | null>;
  setAppSettings: (settings: AppSettings) => Promise<unknown>;
  setUiState: (key: string, value: string) => Promise<unknown>;
}

/** Always this Mac's host, whichever machine the window is looking at. */
const localIo: HostPrefsIo = {
  getAppSettings: () => localTransport.invoke("get_app_settings", {}),
  setAppSettings: (settings) =>
    localTransport.invoke("set_app_settings", { settings }),
  getUiState: (key) => localTransport.invoke("ui_state_get", { key }),
  setUiState: (key, value) =>
    localTransport.invoke("ui_state_set", { key, value }),
};

let io: HostPrefsIo | null = null;
/** What the host holds per slot, as JSON, so unchanged values aren't resent. */
const synced = new Map<string, string>();
let pendingSettings: AppSettings = {};
const pendingUi = new Map<string, string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let importedCount = 0;
/** Stores to reload when the host changes their `localStorage` key under them. */
const reloaders = new Map<string, Set<() => void>>();

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function queue(binding: PrefBinding, value: unknown): void {
  const encoded = JSON.stringify(value);
  const id = slotId(binding.host);
  if (synced.get(id) === encoded) {
    return;
  }
  synced.set(id, encoded);
  if ("setting" in binding.host) {
    pendingSettings = { ...pendingSettings, [binding.host.setting]: value };
  } else {
    pendingUi.set(binding.host.uiState, encoded);
  }
}

async function flush(): Promise<void> {
  flushTimer = null;
  if (!io) {
    return;
  }
  const settings = pendingSettings;
  pendingSettings = {};
  const ui = [...pendingUi];
  pendingUi.clear();
  const writes: Promise<unknown>[] = ui.map(([key, value]) =>
    io!.setUiState(key, value),
  );
  if (Object.keys(settings).length > 0) {
    writes.push(io.setAppSettings(settings));
  }
  await Promise.allSettled(writes);
}

/**
 * Fill `localStorage` from the host before any store reads it. On this
 * renderer's first run its own values win and are copied to the host; after
 * that the host wins, and the renderer only supplies what the host lacks.
 * Returns how many values were copied to the host on that first run.
 */
export async function hydrateHostPrefs(
  hostIo: HostPrefsIo = localIo,
): Promise<number> {
  io = hostIo;
  const firstRun = readLocal(IMPORTED_KEY) === null;
  const settings = await hostIo.getAppSettings();
  const uiKeys = [
    ...new Set(
      PREF_BINDINGS.flatMap((b) =>
        "uiState" in b.host ? [b.host.uiState] : [],
      ),
    ),
  ];
  const uiValues = new Map(
    await Promise.all(
      uiKeys.map(async (key) => [key, await hostIo.getUiState(key)] as const),
    ),
  );

  let imported = 0;
  for (const binding of PREF_BINDINGS) {
    const raw = readLocal(binding.local);
    const local = raw === null ? undefined : binding.read(raw);
    const hostValue = hostValueOf(binding, settings, uiValues);
    if (hostValue !== undefined) {
      synced.set(slotId(binding.host), JSON.stringify(hostValue));
    }
    if (local !== undefined && (firstRun || hostValue === undefined)) {
      queue(binding, local);
      imported += firstRun ? 1 : 0;
      continue;
    }
    const next =
      hostValue === undefined ? undefined : binding.write(hostValue, raw);
    if (next !== undefined && next !== raw) {
      localStorage.setItem(binding.local, next);
    }
  }
  await flush();
  localStorage.setItem(IMPORTED_KEY, "1");
  importedCount = imported;

  return imported;
}

/** Values the first run copied to the host; 0 on every later run. */
export function hostPrefsImportedCount(): number {
  return importedCount;
}

function hostValueOf(
  binding: PrefBinding,
  settings: AppSettings,
  ui: Map<string, string | null>,
): unknown {
  if ("setting" in binding.host) {
    return settings[binding.host.setting];
  }
  const raw = ui.get(binding.host.uiState);
  if (raw === null || raw === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Write-through without the boot read, for popouts: the main window already
 * filled the `localStorage` they share.
 */
export function connectHostPrefs(hostIo: HostPrefsIo = localIo): void {
  io = hostIo;
}

/** A store just wrote `localKey`: send whatever the host should know. */
export function mirrorToHost(localKey: string): void {
  if (!io) {
    return;
  }
  const raw = readLocal(localKey);
  if (raw === null) {
    return;
  }
  for (const binding of PREF_BINDINGS) {
    if (binding.local !== localKey) {
      continue;
    }
    const value = binding.read(raw);
    if (value !== undefined) {
      queue(binding, value);
    }
  }
  flushTimer ??= setTimeout(() => {
    flush().catch(() => undefined);
  }, FLUSH_DELAY_MS);
}

/** Reload a store whenever another window changes `localKey` on the host. */
export function onHostPrefChange(localKey: string, reload: () => void): void {
  let set = reloaders.get(localKey);
  if (!set) {
    set = new Set();
    reloaders.set(localKey, set);
  }
  set.add(reload);
}

/** The host's `prefs:changed` payload. */
export interface HostPrefsChange {
  settings?: string[];
  ui_state?: string[];
}

/**
 * Another window wrote some of the host's values: pull those, write them to
 * `localStorage` and reload the stores reading them. A value of ours still
 * waiting to flush is newer and stays; our own write echoing back is a no-op.
 */
export async function applyHostPrefsChange(
  change: HostPrefsChange,
): Promise<void> {
  const hostIo = io;
  if (!hostIo) {
    return;
  }
  const settingKeys = new Set(change.settings ?? []);
  const uiKeys = new Set(change.ui_state ?? []);
  const bindings = PREF_BINDINGS.filter((b) =>
    "setting" in b.host
      ? settingKeys.has(b.host.setting) && !(b.host.setting in pendingSettings)
      : uiKeys.has(b.host.uiState) && !pendingUi.has(b.host.uiState),
  );
  if (bindings.length === 0) {
    return;
  }
  const settings = bindings.some((b) => "setting" in b.host)
    ? await hostIo.getAppSettings()
    : {};
  const uiValues = new Map(
    await Promise.all(
      [...uiKeys].map(
        async (key) => [key, await hostIo.getUiState(key)] as const,
      ),
    ),
  );
  const changed = new Set<string>();
  for (const binding of bindings) {
    const value = hostValueOf(binding, settings, uiValues);
    const encoded = JSON.stringify(value);
    const id = slotId(binding.host);
    if (value === undefined || synced.get(id) === encoded) {
      continue;
    }
    synced.set(id, encoded);
    const raw = readLocal(binding.local);
    const next = binding.write(value, raw);
    if (next !== undefined && next !== raw) {
      localStorage.setItem(binding.local, next);
      changed.add(binding.local);
    }
  }
  for (const key of changed) {
    reloaders.get(key)?.forEach((reload) => reload());
  }
}

/** Test-only: forget the host and everything queued for it. */
export function resetHostPrefs(): void {
  io = null;
  importedCount = 0;
  synced.clear();
  reloaders.clear();
  pendingSettings = {};
  pendingUi.clear();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}
