/**
 * The managed tunnel's lifecycle on a linked host: ask the account service for
 * this host's tunnel credentials, install the pinned `cloudflared`, and keep
 * the connector running while the host is linked, the account is on and remote
 * access is listening. The service only ever hands a host its own tunnel; the
 * tunnel only ever carries Noise ciphertext.
 */

import type { AccountRecord, StoredTunnel } from "./store";
import { warn } from "@argus/host/logger";
import {
  CloudflaredInstallError,
  ensureCloudflared,
  type CloudflaredSource,
} from "../remote/cloudflared";
import {
  isGatewayOnLan,
  LOCAL_GATEWAY_PORT,
  onLanChange,
} from "../remote/endpoints";
import {
  getManagedTunnelState,
  runningToken,
  setManagedTunnelState,
  startManagedTunnel,
  stopManagedTunnel,
  type ManagedTunnelOffReason,
} from "../remote/managedTunnel";
import { capture } from "../telemetry/telemetry";
import { AccountClient, AccountServiceError } from "./client";
import { serviceUrl, writeAccountRecord } from "./store";
import { currentRecord, isLinked } from "./trust";

/** The service has no tunnels to give: ask again this much later. */
const UNAVAILABLE_RETRY_MS = 60 * 60_000;
const RETRY_MS = [60_000, 5 * 60_000, 30 * 60_000];
/** Fresh credentials at most this often when the connector keeps failing. */
const REFRESH_MIN_MS = 2 * 60_000;

type FailureStage = "connect" | "credentials" | "install" | "unavailable";

let active = false;
let generation = 0;
let retryTimer: NodeJS.Timeout | null = null;
let retries = 0;
let lastFailureRefresh = 0;
let unsubscribeLan: (() => void) | null = null;
/** How this run's binary was found, reported once the connector registers. */
let pendingStart: {
  created: boolean;
  install: CloudflaredSource | "downloaded";
} | null = null;
const reportedFailures = new Set<FailureStage>();

function client(record: AccountRecord): AccountClient {
  return new AccountClient(serviceUrl(record), {
    sign_priv: record.host_sign_priv,
    sign_pub: record.host_sign_pub,
    member_id: record.host_id,
  });
}

/** Why the tunnel shouldn't run right now, or null when it should. */
export function offReason(): ManagedTunnelOffReason | null {
  const record = currentRecord();
  if (!active || !record || !isLinked()) {
    return "not_linked";
  }
  if (!record.config.enabled) {
    return "account_paused";
  }
  if (record.config.tunnel === false) {
    return "turned_off";
  }
  if (!isGatewayOnLan()) {
    return "remote_off";
  }

  return null;
}

function reportFailure(stage: FailureStage): void {
  // One report per stage per process: a connector that keeps failing would
  // otherwise send the same event every few seconds.
  if (reportedFailures.has(stage)) {
    return;
  }
  reportedFailures.add(stage);
  capture("managed_tunnel_failed", { stage });
}

function clearRetry(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function retryIn(ms: number): void {
  clearRetry();
  retryTimer = setTimeout(() => {
    retryTimer = null;
    reconcile().catch(() => undefined);
  }, ms);
  retryTimer.unref?.();
}

function retryLater(): void {
  retryIn(RETRY_MS[Math.min(retries, RETRY_MS.length - 1)]);
  retries += 1;
}

async function fetchCredentials(record: AccountRecord): Promise<StoredTunnel> {
  const issued = await client(record).hostTunnel(LOCAL_GATEWAY_PORT);
  const stored: StoredTunnel = {
    hostname: issued.hostname,
    url: issued.url,
    tunnel_id: issued.tunnel_id,
    token: issued.token,
    port: LOCAL_GATEWAY_PORT,
    fetched_at: Date.now(),
  };
  record.tunnel = stored;
  await writeAccountRecord(record);
  pendingStart = { created: issued.created, install: "managed" };

  return stored;
}

/** Bring the tunnel in line with what it should be doing now. Never throws. */
export async function reconcile(
  opts: { refresh?: boolean } = {},
): Promise<void> {
  const gen = ++generation;
  const reason = offReason();
  if (reason) {
    clearRetry();
    stopManagedTunnel();
    setManagedTunnelState({ phase: "off", reason, url: null, error: null });

    return;
  }
  const record = currentRecord() as AccountRecord;
  let creds = record.tunnel ?? null;
  const stale = !creds || creds.port !== LOCAL_GATEWAY_PORT || opts.refresh;
  if (!stale && creds && runningToken() === creds.token) {
    return;
  }

  if (stale) {
    setManagedTunnelState({
      phase: "provisioning",
      reason: null,
      error: null,
    });
    try {
      creds = await fetchCredentials(record);
    } catch (err) {
      if (gen !== generation) {
        return;
      }
      // A service without tunnels says so; one that predates them has no route.
      if (
        err instanceof AccountServiceError &&
        (err.code === "unavailable" || err.status === 404)
      ) {
        stopManagedTunnel();
        setManagedTunnelState({ phase: "unavailable", url: null, error: null });
        reportFailure("unavailable");
        retryIn(UNAVAILABLE_RETRY_MS);

        return;
      }
      warn(`[account] tunnel credentials: ${(err as Error).message}`);
      setManagedTunnelState({
        phase: "error",
        error:
          err instanceof AccountServiceError
            ? "The account service couldn't set up this computer's tunnel."
            : "Couldn't reach the account service for this computer's tunnel.",
      });
      reportFailure("credentials");
      retryLater();

      return;
    }
  }
  if (gen !== generation || !creds) {
    return;
  }

  setManagedTunnelState({ phase: "installing", reason: null, error: null });
  let bin: string;
  try {
    const resolved = await ensureCloudflared();
    bin = resolved.path;
    pendingStart = {
      created: pendingStart?.created ?? false,
      install: resolved.downloaded ? "downloaded" : resolved.source,
    };
  } catch (err) {
    if (gen !== generation) {
      return;
    }
    setManagedTunnelState({
      phase: "error",
      error:
        err instanceof CloudflaredInstallError
          ? err.message
          : "Couldn't install cloudflared.",
    });
    reportFailure("install");
    retryLater();

    return;
  }
  if (gen !== generation || offReason()) {
    return;
  }
  clearRetry();
  startManagedTunnel(
    { bin, token: creds.token, url: creds.url },
    {
      onRegistered: () => {
        retries = 0;
        if (pendingStart) {
          capture("managed_tunnel_started", pendingStart);
          pendingStart = null;
        }
      },
      onExit: ({ failures, rejected }) => {
        if (failures === 1 && !rejected) {
          return;
        }
        reportFailure("connect");
        // The token or the tunnel may be gone (reclaimed while offline): ask
        // for fresh credentials rather than retrying the dead ones forever.
        if (Date.now() - lastFailureRefresh >= REFRESH_MIN_MS) {
          lastFailureRefresh = Date.now();
          reconcile({ refresh: true }).catch(() => undefined);
        }
      },
    },
  );
}

/** Start following the account and remote state. Idempotent. */
export function syncAccountTunnel(): void {
  active = true;
  unsubscribeLan ??= onLanChange(() => {
    reconcile().catch(() => undefined);
  });
  reconcile().catch(() => undefined);
}

/** Stop the connector and stop following state (shutdown, unlink). */
export function stopAccountTunnel(): void {
  active = false;
  generation += 1;
  clearRetry();
  unsubscribeLan?.();
  unsubscribeLan = null;
  stopManagedTunnel();
  setManagedTunnelState({
    phase: "off",
    reason: "not_linked",
    url: null,
    error: null,
  });
}

/**
 * Unlinking: give the tunnel back while this host can still sign for it. The
 * service also releases it when it sees the revoke, so failing here is fine.
 */
export async function releaseAccountTunnel(): Promise<void> {
  const record = currentRecord();
  stopAccountTunnel();
  if (!record?.tunnel) {
    return;
  }
  try {
    await client(record).releaseHostTunnel();
  } catch (err) {
    warn(`[account] tunnel release: ${(err as Error).message}`);
  }
  record.tunnel = null;
  await writeAccountRecord(record).catch(() => undefined);
}

export { getManagedTunnelState };
