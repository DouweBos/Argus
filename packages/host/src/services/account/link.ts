/**
 * Linking this host to an account with a code (§5.2a): the state machine the
 * Electron window, the Mac app, the menu bar and `argus-host login` all
 * drive, the way `serverPairing.ts` serves pairing.
 *
 *   idle → awaiting_claim(code) → awaiting_first (empty account)  → linked
 *                               → awaiting_sas → awaiting_approval → linked
 */

import type { RequestStatus } from "./client";
import type { AccountRecord } from "./store";
import type {
  AccountLinkState,
  AccountLinkSurface,
  DeviceMember,
  HostMember,
  LogEntry,
} from "@argus/remote-protocol";
import {
  accountSas,
  admitsMember,
  makeEntry,
  makeProof,
  verifyLog,
} from "@argus/remote-protocol";
import { warn } from "@argus/host/logger";
import { hostPlatform } from "../../platform";
import { capture } from "../telemetry/telemetry";
import { AccountClient, AccountServiceError } from "./client";
import { adoptAccount } from "./lifecycle";
import { getLinkState, setLinkState } from "./status";
import {
  deviceMember,
  ensureAccountRecord,
  ensureDevice,
  hostMember,
  serviceUrl,
  writeAccountRecord,
} from "./store";
import { isLinked } from "./trust";

export type LinkSurface = AccountLinkSurface | "paired";
type FailStage =
  | "claim_timeout"
  | "denied"
  | "network"
  | "sas_rejected"
  | "start"
  | "verify";

/** Consecutive poll failures before giving up. */
const MAX_POLL_FAILURES = 12;
/** Never poll faster than this, whatever interval the service asks for. */
let pollFloorMs = 2_000;

/** Test-only: poll quickly. */
export function setLinkPollFloorMs(ms: number): void {
  pollFloorMs = ms;
}

interface PendingSas {
  sas: string;
  commit: string;
  approverId: string;
  approverRole: "device" | "host";
  headHash: string;
}

interface Session {
  requestId: string;
  client: AccountClient;
  record: AccountRecord;
  host: HostMember;
  device: DeviceMember | null;
  surface: LinkSurface;
  intervalMs: number;
  timer: NodeJS.Timeout | null;
  failures: number;
  status: RequestStatus | null;
  pending: PendingSas | null;
  confirmed: PendingSas | null;
  approved: boolean;
  busy: boolean;
}

let session: Session | null = null;

export function linkInProgress(): boolean {
  return session !== null;
}

function stop(): void {
  if (session?.timer) {
    clearTimeout(session.timer);
  }
  session = null;
}

function fail(stage: FailStage, message: string): AccountLinkState {
  capture("account_link_failed", { stage });
  stop();
  setLinkState({ kind: "error", message });

  return getLinkState();
}

function schedule(s: Session): void {
  s.timer = setTimeout(() => {
    poll(s).catch(() => undefined);
  }, s.intervalMs);
  s.timer.unref?.();
}

export async function startLink(
  surface: LinkSurface,
): Promise<AccountLinkState> {
  if (isLinked()) {
    throw "This computer is already linked to an account";
  }
  if (session) {
    await cancelLink();
  }
  const record = await ensureAccountRecord();
  const withDevice = surface === "electron";
  if (withDevice) {
    ensureDevice(record);
    await writeAccountRecord(record);
  }
  const host = await hostMember(record);
  const device =
    withDevice && record.device ? deviceMember(record.device, host.name) : null;
  const proofs: Record<string, string> = {
    [host.id]: makeProof(host, record.host_sign_priv),
  };
  if (device && record.device) {
    proofs[device.id] = makeProof(device, record.device.sign_priv);
  }
  const client = new AccountClient(serviceUrl(record), {
    sign_priv: record.host_sign_priv,
    sign_pub: record.host_sign_pub,
    member_id: null,
  });
  let start;
  try {
    start = await client.linkStart(
      device ? { host, device } : { host },
      proofs,
    );
  } catch (err) {
    warn(`[account] link start failed: ${(err as Error).message}`);

    return fail(
      err instanceof AccountServiceError ? "start" : "network",
      "Couldn't reach the account service",
    );
  }
  capture("account_link_started", { surface });
  const s: Session = {
    requestId: start.request_id,
    client,
    record,
    host,
    device,
    surface,
    intervalMs: Math.max(pollFloorMs, start.interval * 1000),
    timer: null,
    failures: 0,
    status: null,
    pending: null,
    confirmed: null,
    approved: false,
    busy: false,
  };
  session = s;
  setLinkState({
    kind: "awaiting_claim",
    user_code: start.user_code,
    verification_uri: start.verification_uri,
    verification_uri_complete: start.verification_uri_complete,
    expires_at: Date.now() + start.expires_in * 1000,
  });
  if (surface === "electron") {
    hostPlatform()
      .openExternal(start.verification_uri_complete)
      .catch(() => undefined);
  }
  schedule(s);

  return getLinkState();
}

async function poll(s: Session): Promise<void> {
  if (session !== s) {
    return;
  }
  let status: RequestStatus;
  try {
    status = await s.client.linkStatus(s.requestId);
    s.failures = 0;
  } catch {
    s.failures += 1;
    if (s.failures >= MAX_POLL_FAILURES) {
      fail("network", "Lost contact with the account service");
    } else {
      schedule(s);
    }

    return;
  }
  if (session !== s) {
    return;
  }
  s.status = status;
  switch (status.status) {
    case "denied":
      fail("denied", "The link was declined");

      return;
    case "expired":
      fail("claim_timeout", "The code expired before it was approved");

      return;
    case "claimed":
      if (status.account_empty && getLinkState().kind === "awaiting_claim") {
        setLinkState({ kind: "awaiting_first" });
      }
      break;
    case "approving":
      await onApproving(s, status);
      break;
    case "approved":
      s.approved = true;
      if (s.confirmed) {
        await finish(s);
      }
      break;
    case "pending":
      break;
  }
  if (session === s) {
    schedule(s);
  }
}

/** An approver picked the request up: show the code both sides compare. */
async function onApproving(s: Session, status: RequestStatus): Promise<void> {
  const { approver, head, account_id: accountId, epoch } = status;
  if (!approver || !head || !accountId || epoch === undefined) {
    return;
  }
  if (
    s.pending?.approverId === approver.id &&
    s.pending.headHash === head.hash
  ) {
    return;
  }
  // The approver must be a live member of a log that verifies up to `head`.
  const entries = await s.client.log(epoch, -1).catch(() => null);
  if (!entries || session !== s) {
    return;
  }
  const result = verifyLog(entries);
  const member = result.ok ? result.state.members[approver.id] : undefined;
  if (
    !result.ok ||
    result.state.account_id !== accountId ||
    result.state.head.hash !== head.hash ||
    !member?.live ||
    member.member.sign_pub !== approver.sign_pub
  ) {
    if (!result.ok) {
      capture("account_log_rejected", { reason: result.reason });
    }
    fail("verify", "The account's log didn't check out");

    return;
  }
  const { sas, commit } = accountSas({
    account_id: accountId,
    epoch,
    head_hash: head.hash,
    approver_sign_pub: approver.sign_pub,
    subject_sign_pub: s.host.sign_pub,
    subject_noise_pub: s.host.noise_pub,
    request_id: s.requestId,
  });
  s.pending = {
    sas,
    commit,
    approverId: approver.id,
    approverRole: member.member.role,
    headHash: head.hash,
  };
  s.confirmed = null;
  setLinkState({
    kind: "awaiting_sas",
    sas,
    approver_name: member.member.name,
  });
}

/** The user answered the console prompt (codes match / become the first). */
export async function confirmLink(match: boolean): Promise<AccountLinkState> {
  const s = session;
  const state = getLinkState();
  if (!s || s.busy) {
    return state;
  }
  if (!match) {
    await s.client.linkCancel(s.requestId).catch(() => undefined);

    return state.kind === "awaiting_sas"
      ? fail("sas_rejected", "The codes didn't match, so nothing was linked")
      : cancelLink();
  }
  if (state.kind === "awaiting_first") {
    return writeGenesis(s);
  }
  if (state.kind === "awaiting_sas" && s.pending) {
    s.confirmed = s.pending;
    setLinkState({ kind: "awaiting_approval" });
    if (s.approved) {
      await finish(s);
    }
  }

  return getLinkState();
}

function linkKind(s: Session): "computer" | "host" {
  return s.device ? "computer" : "host";
}

/** Empty account: this host becomes its first member (TOFU, §5.1). */
async function writeGenesis(s: Session): Promise<AccountLinkState> {
  const accountId = s.status?.account_id;
  const epoch = s.status?.epoch ?? 0;
  if (!accountId) {
    return getLinkState();
  }
  s.busy = true;
  const header = { account_id: accountId, epoch };
  const signer = { id: s.host.id, priv: s.record.host_sign_priv };
  const entries: LogEntry[] = [
    makeEntry({ ...header, head: null }, signer, {
      type: "genesis",
      member: s.host,
    }),
  ];
  if (s.device && s.record.device) {
    const first = verifyLog(entries);
    if (first.ok) {
      entries.push(
        makeEntry({ ...header, head: first.state.head }, signer, {
          type: "add_device",
          member: s.device,
          request_id: s.requestId,
          sas_commit: "",
          proof: makeProof(s.device, s.record.device.sign_priv),
        }),
      );
    }
  }
  const result = verifyLog(entries);
  try {
    await s.client.append(epoch, entries);
  } catch (err) {
    s.busy = false;
    const conflict = err instanceof AccountServiceError && err.status === 409;

    return fail(
      conflict ? "verify" : "network",
      conflict
        ? "Another device set up this account first — start again"
        : "Couldn't reach the account service",
    );
  }
  if (!result.ok) {
    return fail("verify", "Couldn't build the account log");
  }
  await adoptAccount(s.record, entries, result.state);
  capture("account_linked", {
    via: s.surface === "paired" ? "paired" : "browser",
    first_member: true,
    kind: linkKind(s),
  });
  stop();
  setLinkState({ kind: "linked" });

  return getLinkState();
}

/** Approved and confirmed: verify the log from genesis and adopt it. */
async function finish(s: Session): Promise<void> {
  const confirmed = s.confirmed;
  const epoch = s.status?.epoch;
  if (!confirmed || epoch === undefined || s.busy) {
    return;
  }
  s.busy = true;
  let entries: LogEntry[];
  try {
    entries = await s.client.log(epoch, -1);
  } catch {
    s.busy = false;

    return;
  }
  const result = verifyLog(entries);
  if (!result.ok) {
    capture("account_log_rejected", { reason: result.reason });
    fail("verify", "The account's log didn't check out");

    return;
  }
  const ownEntry = result.state.members[s.host.id];
  const admitted =
    admitsMember(result.state, s.host.id, {
      request_id: s.requestId,
      sas_commit: confirmed.commit,
    }) &&
    ownEntry?.added_by === confirmed.approverId &&
    ownEntry.member.sign_pub === s.host.sign_pub &&
    ownEntry.member.noise_pub === s.host.noise_pub;
  if (!admitted) {
    capture("account_log_rejected", { reason: "sas_mismatch" });
    fail("verify", "The approval doesn't match the code you confirmed");

    return;
  }
  await adoptAccount(s.record, entries, result.state);
  let via: "app" | "host" | "paired" = "app";
  if (s.surface === "paired") {
    via = "paired";
  } else if (confirmed.approverRole === "host") {
    via = "host";
  }
  capture("account_linked", { via, first_member: false, kind: linkKind(s) });
  stop();
  setLinkState({ kind: "linked" });
}

export async function cancelLink(): Promise<AccountLinkState> {
  const s = session;
  stop();
  if (s) {
    await s.client.linkCancel(s.requestId).catch(() => undefined);
  }
  setLinkState({ kind: "idle" });

  return getLinkState();
}

/** The code of a link in progress (for `account.request_link`). */
export function pendingUserCode(): string | null {
  const state = getLinkState();

  return state.kind === "awaiting_claim" ? state.user_code : null;
}
