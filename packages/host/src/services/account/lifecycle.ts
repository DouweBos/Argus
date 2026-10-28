/**
 * Adopting, refreshing and dropping the account this host is linked to. The
 * one place that persists a newly verified log and starts or stops the
 * background work (presence, polling) that follows from it.
 */

import type { AccountRecord } from "./store";
import type { PairedDevice } from "../remote/deviceStore";
import type { LogEntry, LogState } from "@argus/remote-protocol";
import { verifyLog } from "@argus/remote-protocol";
import { warn } from "@argus/host/logger";
import { capture } from "../telemetry/telemetry";
import { AccountClient, AccountServiceError } from "./client";
import { reflectedName, renameEntries } from "./nameEntries";
import { startPresence, stopPresence } from "./presence";
import { emitAccountStatus } from "./status";
import {
  computerName,
  resetAccountRecord,
  serviceUrl,
  writeAccountRecord,
} from "./store";
import {
  currentRecord,
  currentState,
  dropAccountDevices,
  findAccountDevice,
  isLinked,
  reconcileDevices,
  setTrust,
} from "./trust";
import { stopAccountTunnel, syncAccountTunnel } from "./tunnel";

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
  await reconcileDevices("log");
  startBackground();
  emitAccountStatus();
}

export function startBackground(): void {
  stopBackground();
  // Follows link, pause and remote state itself, so it runs either way.
  syncAccountTunnel();
  if (!isLinked() || !currentRecord()?.config.enabled) {
    return;
  }
  startPresence();
  flushComputerName().catch(() => undefined);
  pollTimer = setInterval(() => {
    syncLog()
      .then(() => flushComputerName())
      .catch(() => undefined);
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
  stopAccountTunnel();
  if (!record) {
    return;
  }
  const next = await resetAccountRecord(record);
  setTrust(next, null);
  await dropAccountDevices();
  emitAccountStatus();
}

export type LogSource = "log" | "sync";

/**
 * Verify entries past the head and adopt the good prefix. A fork or a forged
 * entry never moves this host's view of the account. Returns how many applied.
 */
async function applyFresh(
  entries: LogEntry[],
  source: LogSource,
): Promise<number> {
  const record = currentRecord();
  const state = currentState();
  if (!record?.root || !state || !isLinked() || entries.length === 0) {
    return 0;
  }
  const result = verifyLog(entries, { root: record.root, prior: state });
  const good = result.ok ? entries : entries.slice(0, result.index);
  if (!result.ok) {
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
    capture("account_member_revoked", { role: "host", source });
    await forgetAccount();

    return good.length;
  }
  const renamed = reflectedName(record, state, nextState);
  if (renamed) {
    // Follow the rename, then bring this computer's other member in line.
    record.name = renamed;
    record.name_pending = true;
    await writeAccountRecord(record);
    setTimeout(() => {
      flushComputerName().catch(() => undefined);
    }, 0).unref?.();
  }
  await reconcileDevices(source);
  emitAccountStatus();

  return good.length;
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
  await applyFresh(entries, "log");
}

/**
 * `account.sync`: a connected device hands over entries it verified. They're
 * checked against this host's own pinned log like anything the service
 * serves, so a frozen service can't hold back a removal (§5.5).
 */
export async function applyPushedEntries(
  epoch: number,
  entries: LogEntry[],
): Promise<{ head_seq: number | null; applied: number }> {
  await syncing?.catch(() => undefined);
  const state = currentState();
  if (!state || !isLinked() || epoch !== state.epoch) {
    return {
      head_seq: isLinked() ? (state?.head.seq ?? null) : null,
      applied: 0,
    };
  }
  const fresh = entries.filter((e) => entrySeq(e) > state.head.seq);
  const applied = await applyFresh(fresh, "sync");
  const after = isLinked() ? currentState() : null;

  return { head_seq: after?.head.seq ?? null, applied };
}

function entrySeq(entry: LogEntry): number {
  try {
    const seq = (JSON.parse(entry.body) as { seq?: unknown }).seq;

    return typeof seq === "number" ? seq : -1;
  } catch {
    return -1;
  }
}

/**
 * Sign entries on the current head, append them and adopt them. When another
 * member moved the head first, catch up and sign again, once.
 */
export async function appendOwn(
  build: (state: LogState) => LogEntry[],
): Promise<LogState> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const record = currentRecord();
    const state = currentState();
    if (!record || !state || !isLinked()) {
      throw "This computer isn't linked to an account";
    }
    const entries = build(state);
    const next = verifyLog(entries, { prior: state });
    if (!next.ok) {
      throw "Couldn't build the account entry";
    }
    try {
      await memberClient(record).append(state.epoch, entries);
    } catch (err) {
      if (
        attempt === 0 &&
        err instanceof AccountServiceError &&
        err.status === 409
      ) {
        await syncLog();
        continue;
      }
      throw err instanceof AccountServiceError
        ? "Couldn't reach the account service"
        : err;
    }
    record.entries = [...record.entries, ...entries];
    await writeAccountRecord(record);
    setTrust(record, next.state);
    if (next.state.members[record.host_id]?.live) {
      await reconcileDevices("log");
    }
    emitAccountStatus();

    return next.state;
  }
  throw "The account changed meanwhile — try again";
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

/** Unknown keys may only make this host ask the service this often. */
const MISS_SYNC_MS = 15_000;
const MISS_SYNC_WAIT_MS = 5_000;
let lastMissSync = 0;

/**
 * The account device behind a handshaking key. A miss on a linked host reads
 * the log once before refusing, so a device approved a moment ago connects
 * straight away instead of after the next 5-minute poll.
 */
export async function findAccountDeviceFresh(
  noisePubB64: string,
): Promise<PairedDevice | null> {
  const found = await findAccountDevice(noisePubB64);
  if (found || !isLinked() || !currentRecord()?.config.enabled) {
    return found;
  }
  const now = Date.now();
  if (now - lastMissSync < MISS_SYNC_MS) {
    return null;
  }
  lastMissSync = now;
  await Promise.race([
    syncLog(),
    new Promise((resolve) => setTimeout(resolve, MISS_SYNC_WAIT_MS).unref?.()),
  ]);

  return findAccountDevice(noisePubB64);
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

let flushing: Promise<void> | null = null;

/**
 * Put this computer's name setting on the account once it's reachable: a
 * rename signed by this host, and one by its window's device. Never throws;
 * a failure leaves it pending for the next poll.
 */
export function flushComputerName(): Promise<void> {
  flushing ??= pushComputerName().finally(() => {
    flushing = null;
  });

  return flushing;
}

async function pushComputerName(): Promise<void> {
  for (;;) {
    const record = currentRecord();
    const state = currentState();
    if (!record?.name_pending) {
      return;
    }
    const name = computerName(record);
    try {
      if (isLinked() && state && renameEntries(record, state, name).length) {
        await appendOwn((s) => renameEntries(record, s, name));
      }
    } catch (err) {
      warn(`[account] name not on the account yet: ${String(err)}`);

      return;
    }
    // Edited again meanwhile: go round with the newer name.
    if (computerName(record) !== name) {
      continue;
    }
    record.name_pending = false;
    await writeAccountRecord(record);
    emitAccountStatus();

    return;
  }
}
