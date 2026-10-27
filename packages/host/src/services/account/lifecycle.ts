/**
 * Adopting, refreshing and dropping the account this host is linked to. The
 * one place that persists a newly verified log and starts or stops the
 * background work (presence, polling) that follows from it.
 */

import type { AccountRecord } from "./store";
import type { LogEntry, LogState } from "@argus/remote-protocol";
import { verifyLog } from "@argus/remote-protocol";
import { warn } from "@argus/host/logger";
import { capture } from "../telemetry/telemetry";
import { AccountClient } from "./client";
import { startPresence, stopPresence } from "./presence";
import { emitAccountStatus } from "./status";
import { resetAccountRecord, serviceUrl, writeAccountRecord } from "./store";
import {
  currentRecord,
  currentState,
  dropAccountDevices,
  isLinked,
  reconcileDevices,
  setTrust,
} from "./trust";

const POLL_MS = 5 * 60_000;
const SYNC_SOON_MS = 2_000;

let pollTimer: NodeJS.Timeout | null = null;
let soonTimer: NodeJS.Timeout | null = null;
let syncing: Promise<void> | null = null;

export function memberClient(record: AccountRecord): AccountClient {
  return new AccountClient(serviceUrl(record), {
    sign_priv: record.host_sign_priv,
    sign_pub: record.host_sign_pub,
    member_id: record.host_id,
  });
}

/** Persist a log this host verified and now trusts, then go live on it. */
export async function adoptAccount(
  record: AccountRecord,
  entries: LogEntry[],
  state: LogState,
): Promise<void> {
  record.root = {
    account_id: state.account_id,
    epoch: state.epoch,
    genesis_hash: state.genesis_hash,
  };
  record.entries = entries;
  await writeAccountRecord(record);
  setTrust(record, state);
  await reconcileDevices();
  startBackground();
  emitAccountStatus();
}

export function startBackground(): void {
  stopBackground();
  if (!isLinked() || !currentRecord()?.config.enabled) {
    return;
  }
  startPresence();
  pollTimer = setInterval(() => {
    syncLog().catch(() => undefined);
  }, POLL_MS);
  pollTimer.unref?.();
}

export function stopBackground(): void {
  stopPresence();
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (soonTimer) {
    clearTimeout(soonTimer);
    soonTimer = null;
  }
}

/** Unlink locally: forget the account, its key and its devices. */
export async function forgetAccount(): Promise<void> {
  const record = currentRecord();
  stopBackground();
  if (!record) {
    return;
  }
  const next = await resetAccountRecord(record);
  setTrust(next, null);
  await dropAccountDevices();
  emitAccountStatus();
}

async function pull(): Promise<void> {
  const record = currentRecord();
  const state = currentState();
  if (!record?.root || !state || !isLinked()) {
    return;
  }
  const entries = await memberClient(record).log(
    record.root.epoch,
    state.head.seq,
  );
  if (entries.length === 0) {
    return;
  }
  const result = verifyLog(entries, { root: record.root, prior: state });
  const good = result.ok ? entries : entries.slice(0, result.index);
  if (!result.ok) {
    // Keep the last good state and stop there: a fork or a forged entry
    // never moves this host's view of the account.
    warn(`[account] log rejected: ${result.reason}`);
    capture("account_log_rejected", { reason: result.reason });
  }
  const nextState = result.ok ? result.state : (result.state ?? state);
  if (good.length > 0) {
    record.entries = [...record.entries, ...good];
    await writeAccountRecord(record);
  }
  setTrust(record, nextState, result.ok ? null : result.reason);
  if (!nextState.members[record.host_id]?.live) {
    capture("account_member_revoked", { role: "host", source: "log" });
    await forgetAccount();

    return;
  }
  await reconcileDevices();
  emitAccountStatus();
}

/** Fetch and verify anything new in the log. Serialized; never throws. */
export function syncLog(): Promise<void> {
  syncing ??= pull()
    .catch((err: unknown) => {
      warn(`[account] sync failed: ${(err as Error).message}`);
    })
    .finally(() => {
      syncing = null;
    });

  return syncing;
}

/** A device just connected: check for revocations soon (debounced). */
export function syncSoon(): void {
  if (!isLinked() || soonTimer) {
    return;
  }
  soonTimer = setTimeout(() => {
    soonTimer = null;
    syncLog().catch(() => undefined);
  }, SYNC_SOON_MS);
  soonTimer.unref?.();
}
