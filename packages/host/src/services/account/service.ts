/**
 * The account service's entry points: boot/shutdown, unlinking, the Mac app's
 * local link (§5.2b), settings, and the read models the consoles show.
 */

import type {
  AccountConfigPatch,
  AccountDeviceKey,
  AccountHost,
  AccountLocalLinkOffer,
  AccountMemberInfo,
  AccountStatus,
  LogEntry,
} from "@argus/remote-protocol";
import {
  makeEntry,
  makeProof,
  sha256Hex,
  verifyLog,
  verifyPresence,
} from "@argus/remote-protocol";
import { warn } from "@argus/host/logger";
import { capture } from "../telemetry/telemetry";
import { AccountClient } from "./client";
import {
  adoptAccount,
  forgetAccount,
  memberClient,
  startBackground,
  stopBackground,
} from "./lifecycle";
import { cancelLink, linkInProgress, startLink } from "./link";
import { accountStatus, emitAccountStatus } from "./status";
import {
  ensureAccountRecord,
  hostMember,
  mergeConfig,
  serviceUrl,
  writeAccountRecord,
} from "./store";
import {
  currentRecord,
  currentState,
  isLinked,
  loadTrust,
  setDeviceDisconnector,
  setTrust,
} from "./trust";
import { releaseAccountTunnel, stopAccountTunnel } from "./tunnel";

/** Presence older than this shows the host as offline. */
const ONLINE_WINDOW_MS = 15 * 60_000;

export async function startAccount(opts: {
  disconnect: (deviceId: string) => void;
}): Promise<void> {
  setDeviceDisconnector(opts.disconnect);
  await loadTrust();
  startBackground();
  emitAccountStatus();
}

export function stopAccount(): void {
  stopBackground();
  stopAccountTunnel();
  if (linkInProgress()) {
    cancelLink().catch(() => undefined);
  }
}

export async function getAccountStatus(): Promise<AccountStatus> {
  if (!currentRecord()) {
    await loadTrust();
  }

  return accountStatus();
}

/**
 * Unlink this computer: its window device (Electron) and then the host itself
 * sign their own revokes. If the service can't be reached the host still
 * forgets the account locally — it keeps its QR-paired devices either way.
 */
export async function logout(): Promise<AccountStatus> {
  const record = currentRecord();
  const state = currentState();
  if (!record || !state || !isLinked()) {
    return accountStatus();
  }
  const header = { account_id: state.account_id, epoch: state.epoch };
  const entries: LogEntry[] = [];
  let prior = state;
  const device = record.device;
  if (device && state.members[device.id]?.live) {
    entries.push(
      makeEntry(
        { ...header, head: prior.head },
        { id: device.id, priv: device.sign_priv },
        { type: "revoke", member_id: device.id, reason: "unlinked" },
      ),
    );
    const next = verifyLog(entries, { prior: state });
    if (next.ok) {
      prior = next.state;
    }
  }
  entries.push(
    makeEntry(
      { ...header, head: prior.head },
      { id: record.host_id, priv: record.host_sign_priv },
      { type: "revoke", member_id: record.host_id, reason: "unlinked" },
    ),
  );
  // Before the revoke: afterwards this host can no longer sign for its tunnel.
  await releaseAccountTunnel();
  try {
    await memberClient(record).append(state.epoch, entries);
  } catch (err) {
    warn(`[account] unlink not recorded: ${(err as Error).message}`);
  }
  capture("account_member_revoked", { role: "host", source: "local" });
  await forgetAccount();

  return accountStatus();
}

/** The Mac app's bundled host: hand the app this host's member and proof. */
export async function linkLocalBegin(): Promise<AccountLocalLinkOffer> {
  if (isLinked()) {
    throw "This computer is already linked to an account";
  }
  const record = await ensureAccountRecord();
  const host = await hostMember(record);

  return { host, proof: makeProof(host, record.host_sign_priv) };
}

/**
 * The app appended our `add_host`. The pin comes from the app over the 0600
 * socket — the same user on the same machine — and the log must verify
 * against it and contain this host.
 */
export async function linkLocalFinish(root: {
  accountId: string;
  epoch: number;
  genesisHash: string;
}): Promise<AccountStatus> {
  const record = await ensureAccountRecord();
  const client = new AccountClient(serviceUrl(record), {
    sign_priv: record.host_sign_priv,
    sign_pub: record.host_sign_pub,
    member_id: record.host_id,
  });
  const entries = await client.log(root.epoch, -1);
  const result = verifyLog(entries, {
    root: {
      account_id: root.accountId,
      epoch: root.epoch,
      genesis_hash: root.genesisHash,
    },
  });
  if (!result.ok) {
    capture("account_log_rejected", { reason: result.reason });
    throw "The account's log didn't check out";
  }
  const ownEntry = result.state.members[record.host_id];
  if (!ownEntry?.live || ownEntry.member.sign_pub !== record.host_sign_pub) {
    throw "This computer isn't in the account's log yet";
  }
  await adoptAccount(record, entries, result.state);
  capture("account_linked", {
    via: "local",
    first_member: false,
    kind: "host",
  });

  return accountStatus();
}

export async function setAccountConfig(
  patch: AccountConfigPatch,
): Promise<AccountStatus> {
  const record = await ensureAccountRecord();
  record.config = mergeConfig(record.config, patch);
  await writeAccountRecord(record);
  setTrust(record, currentState());
  startBackground();
  emitAccountStatus();

  return accountStatus();
}

export function listMembers(): AccountMemberInfo[] {
  const record = currentRecord();
  const state = currentState();
  if (!record || !state || !isLinked()) {
    return [];
  }

  return Object.values(state.members)
    .filter((m) => m.live)
    .map(({ member }) => ({
      id: member.id,
      role: member.role,
      kind: member.role === "device" ? member.kind : member.platform,
      name: member.name,
      created_at: member.created_at,
      is_self: member.id === record.host_id || member.id === record.device?.id,
    }));
}

/** Computers on the account with their verified endpoints. */
export async function listHosts(): Promise<AccountHost[]> {
  const record = currentRecord();
  const state = currentState();
  if (!record || !state || !isLinked()) {
    return [];
  }
  const records = await memberClient(record)
    .directory()
    .then((d) => d.hosts)
    .catch(() => []);
  const now = Date.now();

  return Object.values(state.members)
    .filter((m) => m.live && m.member.role === "host")
    .map(({ member }) => {
      const row = records.find((r) => r.host_id === member.id);
      const presence = row ? verifyPresence(state, row) : null;
      const lastSeen = presence && row ? row.last_seen : null;

      return {
        host_id: member.id,
        name: member.name,
        platform: member.role === "host" ? member.platform : "darwin",
        noise_pub: member.noise_pub,
        endpoints: presence?.endpoints ?? [],
        last_seen: lastSeen,
        online: lastSeen !== null && now - lastSeen < ONLINE_WINDOW_MS,
        is_self: member.id === record.host_id,
      };
    });
}

/** Electron's own device key, once that device is in the account. */
export function deviceKey(): AccountDeviceKey | null {
  const device = currentRecord()?.device;
  if (!device || !isLinked() || !currentState()?.members[device.id]?.live) {
    return null;
  }

  return {
    device_id: device.id,
    noise_priv: device.noise_priv,
    noise_pub: device.noise_pub,
  };
}

/** `account.status` for a paired phone: hashed id only. */
export function remoteAccountStatus(): {
  linked: boolean;
  account_id_hash: string | null;
  head_seq: number | null;
} {
  const state = currentState();
  const linked = isLinked();

  return {
    linked,
    account_id_hash: linked && state ? sha256Hex(state.account_id) : null,
    head_seq: linked && state ? state.head.seq : null,
  };
}

/** `account.request_link`: start a code link the paired phone then approves. */
export async function requestLinkFromPaired(): Promise<{ user_code: string }> {
  const state = await startLink("paired");
  if (state.kind !== "awaiting_claim") {
    throw state.kind === "error" ? state.message : "Couldn't start linking";
  }

  return { user_code: state.user_code };
}
