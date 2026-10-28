/**
 * This browser joining an account that already has devices (§5.4): ask,
 * compare a 6-digit code with the device that picks it up, and adopt the log
 * only when its `add_device` carries the code compared here. A port of the
 * Apple clients' `AccountStore+Join`, including resuming a request after a
 * reload and checking an approval that landed while the tab was closed.
 */

import type {
  AccountApproval,
  AccountSas,
  LogEntry,
  LogState,
} from "@argus/remote-protocol/account";
import {
  accountApprovals,
  accountSas,
  admitsMember,
  makeProofWith,
  verifyLog,
} from "@argus/remote-protocol/account";
import {
  type AccountInfo,
  AccountServiceError,
  describeAccountError,
  type RequestStatus,
  UNTRUSTED_LOG,
} from "./client";
import type { AccountSession } from "./session";
import { deviceMember, signWith } from "./webKeys";

export type JoinFlow =
  | { kind: "idle" }
  | { kind: "requesting" }
  /** Asked; no device has picked it up yet. */
  | { kind: "waiting" }
  /** Compare `sas` with the code on `approverName` before confirming. */
  | { kind: "compare"; sas: string; approverName: string }
  /** Codes match here; waiting for the approver to finish. */
  | { kind: "confirmed"; approverName: string }
  /** Approved while this tab wasn't watching: check `sas` against the approver's list. */
  | { kind: "alreadyApproved"; sas: string; approverName: string }
  | { kind: "denied" }
  | { kind: "expired" }
  | { kind: "failed"; message: string };

export interface PendingJoinState {
  requestId: string;
  info: AccountInfo;
  approver: { id: string; sign_pub: string } | null;
  sas: AccountSas | null;
  confirmedCommit: string | null;
}

export interface ApprovedJoin {
  entries: LogEntry[];
  state: LogState;
  approval: AccountApproval;
}

function setJoin(s: AccountSession, join: JoinFlow): void {
  s.join = join;
  s.changed();
}

/** A log fetched with no pin yet: adopt it only through the request and code confirmed here. */
export function admitsConfirmedJoin(s: AccountSession, state: LogState): boolean {
  const { keys, joinRequestId, joinCommit } = s.vault;

  return (
    !!keys &&
    !!joinRequestId &&
    !!joinCommit &&
    admitsMember(state, keys.memberId, {
      request_id: joinRequestId,
      sas_commit: joinCommit,
    })
  );
}

export function stopJoin(s: AccountSession): void {
  if (s.joinTimer) {
    clearInterval(s.joinTimer);
  }
  s.joinTimer = null;
  s.pendingJoin = null;
}

function startPolling(s: AccountSession): void {
  if (s.joinTimer) {
    clearInterval(s.joinTimer);
  }
  const every = s.deps.joinPollMs ?? 3_000;
  s.joinTimer = every > 0 ? setInterval(() => void pollJoin(s), every) : null;
}

async function clearPendingJoin(s: AccountSession): Promise<void> {
  if (s.vault.pendingJoin) {
    s.vault = { ...s.vault, pendingJoin: null };
    await s.save();
  }
}

async function endJoin(s: AccountSession, flow: JoinFlow): Promise<void> {
  stopJoin(s);
  await clearPendingJoin(s);
  setJoin(s, flow);
}

/** After a reload: pick the persisted request back up, or file a new one. */
export async function continueJoin(s: AccountSession, info: AccountInfo): Promise<void> {
  const saved = s.vault.pendingJoin;
  if (!saved || saved.accountId !== info.account_id || saved.epoch !== info.epoch) {
    await requestJoin(s, info);

    return;
  }
  stopJoin(s);
  s.pendingJoin = {
    requestId: saved.requestId,
    info,
    approver: null,
    sas: null,
    confirmedCommit: null,
  };
  setJoin(s, { kind: "waiting" });
  startPolling(s);
  await pollJoin(s);
}

/** Ask the account's devices to let this browser in. Keys are kept across denials. */
export async function requestJoin(s: AccountSession, info: AccountInfo): Promise<void> {
  stopJoin(s);
  setJoin(s, { kind: "requesting" });
  // Withdraw an earlier request so stale ones don't wait on other devices.
  const stale = s.vault.pendingJoin;
  if (stale) {
    await s.client.deny(stale.requestId).catch(() => undefined);
    await clearPendingJoin(s);
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0 || !s.vault.keys) {
      const keys = await s.deps.generateKeys(s.name, s.now());
      s.vault = { ...s.vault, keys };
      await s.save();
    }
    const keys = s.vault.keys!;
    try {
      const member = deviceMember(keys);
      const proof = await makeProofWith(member, (m) => signWith(keys, m));
      const ticket = await s.client.join(member, proof);
      s.pendingJoin = {
        requestId: ticket.request_id,
        info,
        approver: null,
        sas: null,
        confirmedCommit: null,
      };
      s.vault = {
        ...s.vault,
        pendingJoin: {
          requestId: ticket.request_id,
          accountId: info.account_id,
          epoch: info.epoch,
        },
      };
      await s.save();
      setJoin(s, { kind: "waiting" });
      startPolling(s);

      return;
    } catch (err) {
      if (err instanceof AccountServiceError && err.isConflict) {
        if (err.headSeq === null) {
          // Emptied meanwhile: a browser can't be an account's first device.
          stopJoin(s);
          s.phase = "empty";
          setJoin(s, { kind: "idle" });

          return;
        }
        // These keys are already on the account: never ask again with them.
        if (attempt === 0 && (await offerApprovedJoinIfMember(s, info))) {
          return;
        }
        continue;
      }
      setJoin(s, { kind: "failed", message: describeAccountError(err) });

      return;
    }
  }
}

/** Ask again after a denial, an expiry or an error. */
export async function retryJoin(s: AccountSession): Promise<void> {
  if (s.phase !== "awaitingApproval") {
    return;
  }
  try {
    await requestJoin(s, await s.client.account());
  } catch (err) {
    setJoin(s, { kind: "failed", message: describeAccountError(err) });
  }
}

/** One look at this browser's request. */
export async function pollJoin(s: AccountSession): Promise<void> {
  const pending = s.pendingJoin;
  if (s.phase !== "awaitingApproval" || !pending) {
    return;
  }
  let status: RequestStatus | null;
  try {
    status = await s.client.joinStatus(pending.requestId);
  } catch (err) {
    if (!(err instanceof AccountServiceError && err.status === 404)) {
      return;
    }
    // Gone, or filed on another account: over.
    status = null;
  }
  if (s.pendingJoin?.requestId !== pending.requestId) {
    return;
  }
  const name = status?.status ?? "expired";
  if (name === "denied" || name === "expired") {
    // An earlier request may have been approved meanwhile.
    if (await offerApprovedJoinIfMember(s, pending.info)) {
      return;
    }
    await endJoin(s, { kind: name });

    return;
  }
  if ((name === "approving" || name === "approved") && status) {
    const approver = s.pendingJoin?.approver;
    if (
      !s.pendingJoin?.sas ||
      approver?.id !== status.approver?.id ||
      approver?.sign_pub !== status.approver?.sign_pub
    ) {
      await showCode(s, status);
    }
    if (name === "approved" && s.pendingJoin?.confirmedCommit) {
      await finishJoin(s);
    }
  }
}

/**
 * A device picked the request up. The code binds its key and the head it
 * approves on, both checked against the log, so a key or head the service
 * swapped gives a code that doesn't match the approver's.
 */
async function showCode(s: AccountSession, status: RequestStatus): Promise<void> {
  const pending = s.pendingJoin;
  const keys = s.vault.keys;
  const { approver, head } = status;
  if (!pending || !approver || !head || !keys) {
    return;
  }
  let entries: LogEntry[];
  try {
    entries = await s.client.log(pending.info.epoch, -1);
  } catch {
    return;
  }
  const atHead =
    head.seq >= 0 && head.seq < entries.length
      ? verifyLog(entries.slice(0, head.seq + 1))
      : null;
  const found = atHead?.ok ? atHead.state.members[approver.id] : undefined;
  if (
    !atHead?.ok ||
    atHead.state.head.seq !== head.seq ||
    atHead.state.head.hash !== head.hash ||
    !found?.live ||
    found.member.sign_pub !== approver.sign_pub
  ) {
    await endJoin(s, { kind: "failed", message: UNTRUSTED_LOG });

    return;
  }
  const sas = accountSas({
    account_id: atHead.state.account_id,
    epoch: atHead.state.epoch,
    head_hash: head.hash,
    approver_sign_pub: approver.sign_pub,
    subject_sign_pub: keys.signPub,
    subject_noise_pub: keys.noisePub,
    request_id: pending.requestId,
  });
  // Confirmed before a reload: the same request and code stay confirmed.
  const confirmed =
    s.vault.joinRequestId === pending.requestId && s.vault.joinCommit === sas.commit;
  s.pendingJoin = {
    ...pending,
    approver,
    sas,
    confirmedCommit: confirmed ? sas.commit : null,
  };
  setJoin(
    s,
    confirmed
      ? { kind: "confirmed", approverName: found.member.name }
      : { kind: "compare", sas: sas.sas, approverName: found.member.name },
  );
}

/** "Codes match" here. The approver still has to confirm too. */
export async function confirmJoinCode(s: AccountSession): Promise<void> {
  const pending = s.pendingJoin;
  if (!pending?.sas || s.join.kind !== "compare") {
    return;
  }
  const approverName = s.join.approverName;
  s.pendingJoin = { ...pending, confirmedCommit: pending.sas.commit };
  // Kept so a reload only adopts an approval that carries this code.
  s.vault = {
    ...s.vault,
    joinRequestId: pending.requestId,
    joinCommit: pending.sas.commit,
  };
  await s.save();
  setJoin(s, { kind: "confirmed", approverName });
  await pollJoin(s);
}

/** "Codes don't match": refuse the request. */
export async function rejectJoinCode(s: AccountSession): Promise<void> {
  const pending = s.pendingJoin;
  if (!pending) {
    return;
  }
  await s.client.deny(pending.requestId).catch(() => undefined);
  await endJoin(s, { kind: "denied" });
}

/** Approved: adopt the log only if it adds this browser with the code compared here. */
async function finishJoin(s: AccountSession): Promise<void> {
  const pending = s.pendingJoin;
  const keys = s.vault.keys;
  if (!pending?.confirmedCommit || !keys) {
    return;
  }
  let entries: LogEntry[];
  try {
    entries = await s.client.log(pending.info.epoch, -1);
  } catch {
    return;
  }
  const verified = verifyLog(entries);
  if (!verified.ok) {
    s.logError = verified.reason;
    await endJoin(s, { kind: "failed", message: UNTRUSTED_LOG });

    return;
  }
  const admitted = admitsMember(verified.state, keys.memberId, {
    request_id: pending.requestId,
    sas_commit: pending.confirmedCommit,
  });
  if (!admitted) {
    await endJoin(s, {
      kind: "failed",
      message: "The approval didn't carry the code you compared, so this browser didn't join.",
    });

    return;
  }
  await s.adopt(verified.state, entries);
}

// --- Approved while away ----------------------------------------------------

/** When this browser's keys are already live on the account, offer that approval. */
async function offerApprovedJoinIfMember(
  s: AccountSession,
  info: AccountInfo,
): Promise<boolean> {
  let entries: LogEntry[];
  try {
    entries = await s.client.log(info.epoch, -1);
  } catch {
    return false;
  }
  const verified = verifyLog(entries);
  if (!verified.ok || !s.ownMemberLive(verified.state)) {
    return false;
  }
  if (admitsConfirmedJoin(s, verified.state)) {
    await s.adopt(verified.state, entries);
  } else {
    await offerApprovedJoin(s, verified.state, entries);
  }

  return true;
}

/**
 * This browser's keys are live through an approval it didn't confirm here.
 * Show the code that approval was made with, recomputed from the log, and
 * adopt only once the user checks it against the approver's list.
 */
export async function offerApprovedJoin(
  s: AccountSession,
  state: LogState,
  entries: LogEntry[],
): Promise<void> {
  const keys = s.vault.keys;
  const found = keys ? state.members[keys.memberId] : undefined;
  const open = s.pendingJoin?.requestId ?? s.vault.pendingJoin?.requestId;
  stopJoin(s);
  await clearPendingJoin(s);
  if (open && open !== found?.request_id) {
    await s.client.deny(open).catch(() => undefined);
  }
  const approval = keys ? accountApprovals(entries)[keys.memberId] : undefined;
  const approver = approval ? state.members[approval.approver_id] : undefined;
  const otherCodeConfirmed =
    s.vault.joinRequestId === found?.request_id &&
    s.vault.joinCommit !== found?.sas_commit;
  if (
    !keys ||
    !found?.live ||
    found.member.noise_pub !== keys.noisePub ||
    otherCodeConfirmed ||
    !approval ||
    !approver
  ) {
    setJoin(s, {
      kind: "failed",
      message:
        "This browser is on your account through an approval it can't check. Remove it from your account on another device, then sign out here and in again.",
    });

    return;
  }
  s.approvedJoin = { entries, state, approval };
  setJoin(s, {
    kind: "alreadyApproved",
    sas: approval.sas.sas,
    approverName: approver.member.name,
  });
}

/** The code matches the one the approver lists for this browser: adopt. */
export async function confirmApprovedJoin(s: AccountSession): Promise<void> {
  const held = s.approvedJoin;
  const keys = s.vault.keys;
  if (
    !held ||
    !keys ||
    s.join.kind !== "alreadyApproved" ||
    !admitsMember(held.state, keys.memberId, {
      request_id: held.approval.request_id,
      sas_commit: held.approval.sas.commit,
    })
  ) {
    return;
  }
  await s.adopt(held.state, held.entries);
}

/** "Not mine": someone else's approval put these keys on the account. Drop them and sign out. */
export async function rejectApprovedJoin(s: AccountSession): Promise<void> {
  if (!s.approvedJoin) {
    return;
  }
  s.approvedJoin = null;
  await s.signOut();
  s.error =
    "This browser signed out because its approval didn't match. Remove it from your account on your other device, then sign in again.";
  s.changed();
}
