/**
 * The transport chokepoint. `invoke()`, `send()` and `listen()` resolve the
 * active transport here; components never learn which machine answered.
 *
 * The mode is decided once, before the app boots, from persisted settings —
 * switching hosts reloads the window rather than hot-swapping, because every
 * store, subscription and cache in the renderer is derived from one host's
 * state (§3.6: a full remount, not a live swap).
 */

import type { ArgusTransport } from "./types";
import type { ConnectionState } from "@argus/remote-client";
import { getConnection, setConnectionInfo } from "../../stores/connectionStore";
import {
  getActiveRemoteHostId,
  getRemoteHost,
  setActiveRemoteHostId,
} from "../../stores/settingsStore";
import { localTransport } from "./local";
import { RemoteTransport } from "./remote";

/** How long a saved host gets to answer at launch before we boot local. */
const CONNECT_TIMEOUT_MS = 8000;

let active: ArgusTransport = localTransport;
let remote: RemoteTransport | null = null;

export function getTransport(): ArgusTransport {
  return active;
}

export function isRemoteMode(): boolean {
  return remote !== null;
}

/** Resolve and connect the transport. Must finish before any store loads. */
export async function initTransport(): Promise<void> {
  const hostId = getActiveRemoteHostId();
  if (!hostId) {
    return;
  }
  const host = getRemoteHost(hostId);
  if (!host) {
    // Host was forgotten in another window — don't boot into a dead transport.
    setActiveRemoteHostId(null);

    return;
  }

  setConnectionInfo({
    mode: "remote",
    hostId: host.id,
    hostLabel: host.label,
    state: "connecting",
    hydrated: false,
  });

  const transport = new RemoteTransport(host, { onState: handleState });
  remote = transport;
  active = transport;
  transport.connect();

  const ready = await waitForReady(CONNECT_TIMEOUT_MS);
  if (ready) {
    return;
  }

  transport.disconnect();
  remote = null;
  active = localTransport;
  setActiveRemoteHostId(null);
  setConnectionInfo({
    mode: "local",
    hostId: null,
    hostLabel: null,
    state: "ready",
    hydrated: true,
    fallbackFrom: host.label,
    lastError: `Could not reach ${host.label}.`,
  });
}

function waitForReady(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (getConnection().state === "ready") {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 50);
  });
}

function handleState(state: ConnectionState): void {
  const previous = getConnection().state;
  setConnectionInfo({ state });
  if (state !== "ready") {
    return;
  }
  if (previous === "offline") {
    // The gateway dropped and came back — the host kept running agents while
    // we were away, so pull a fresh snapshot rather than trusting the stores.
    setConnectionInfo({ hydrated: false });
    rehydrate().catch(() => undefined);
  }
}

async function rehydrate(): Promise<void> {
  const { hydrateFromHost } = await import("../hostHydration");
  await hydrateFromHost();
}

/**
 * Attach to a different machine. `null` is This Mac. Reloads the window: the
 * renderer's stores, subscriptions and caches all belong to one host.
 */
export function switchConnection(hostId: string | null): void {
  setActiveRemoteHostId(hostId);
  window.location.reload();
}

export { RemoteUnavailableError } from "./types";
