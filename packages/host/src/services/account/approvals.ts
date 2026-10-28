/**
 * Approving another computer's link or a new device's join from this host's
 * console (§4.4, §5.8): the Electron window, the Mac app's local host, or
 * `argus-host approve`. Never reachable over the gateway — every command here
 * is host-tier.
 */

import type { JoinRequestRow } from "./client";
import type {
  AccountApprovalState,
  AccountJoinRequest,
  AccountMember,
  AccountMemberRole,
  LogEntry,
} from "@argus/remote-protocol";
import {
  accountSas,
  entryHash,
  makeEntry,
  proofSigningBytes,
  verifyB64,
  verifyLog,
} from "@argus/remote-protocol";
import { capture } from "../telemetry/telemetry";
import { AccountServiceError } from "./client";
import { memberClient, syncLog } from "./lifecycle";
import {
  emitAccountStatus,
  getApprovalState,
  setApprovalState,
} from "./status";
import { writeAccountRecord } from "./store";
import { currentRecord, currentState, isLinked, setTrust } from "./trust";

interface Pending {
  request: JoinRequestRow;
  sas: string;
  commit: string;
  head: { seq: number; hash: string };
}

let pending: Pending | null = null;
/** What each listed request is for, so a deny from the list can report it. */
const listedRoles = new Map<string, AccountMemberRole>();

/** Who the code is about: the computer of a link, else the joining device. */
function subjectOf(request: JoinRequestRow): AccountMember | null {
  return request.subject.host ?? request.subject.device ?? null;
}

function requireApprover() {
  const record = currentRecord();
  const state = currentState();
  if (!record || !state || !isLinked()) {
    throw "This computer isn't linked to an account";
  }
  if (!record.config.hosts_can_approve) {
    throw "Approving from this computer is turned off in its account settings";
  }

  return { record, state };
}

export async function listRequests(): Promise<AccountJoinRequest[]> {
  const record = currentRecord();
  if (!record || !isLinked()) {
    return [];
  }
  const { requests } = await memberClient(record).listJoins();
  const out: AccountJoinRequest[] = [];
  for (const r of requests) {
    const subject = subjectOf(r);
    // This window's own device never asks; anything else unproven isn't shown.
    if (!subject || subject.id === record.device?.id || !subjectProven(r)) {
      continue;
    }
    listedRoles.set(r.request_id, subject.role);
    out.push({
      request_id: r.request_id,
      kind: r.kind,
      subject_name: subject.name,
      subject_role: subject.role,
      subject_kind: subject.role === "device" ? subject.kind : subject.platform,
      status: r.status,
      created_at: r.created_at,
      expires_at: r.expires_at,
    });
  }

  return out;
}

/** Every member's proof must check out before this host vouches for it. */
function subjectProven(request: JoinRequestRow): boolean {
  const { host, device, proofs } = request.subject;
  if ((!host && !device) || !proofs) {
    return false;
  }

  return [host, device].every(
    (m) =>
      !m || verifyB64(proofSigningBytes(m), proofs[m.id] ?? "", m.sign_pub),
  );
}

export async function approveJoin(
  requestId: string,
): Promise<AccountApprovalState> {
  const { record } = requireApprover();
  const client = memberClient(record);
  const { requests } = await client.listJoins();
  const request = requests.find((r) => r.request_id === requestId);
  const subject = request ? subjectOf(request) : null;
  if (!request || !subject) {
    throw "That request is gone";
  }
  if (!subjectProven(request)) {
    throw "That request's keys don't check out";
  }
  await syncLog();
  const state = currentState();
  if (!state) {
    throw "This computer isn't linked to an account";
  }
  const { head } = await client.setApprover(requestId, record.host_id);
  if (head.seq !== state.head.seq || head.hash !== state.head.hash) {
    throw "The account changed while approving — try again";
  }
  const { sas, commit } = accountSas({
    account_id: state.account_id,
    epoch: state.epoch,
    head_hash: head.hash,
    approver_sign_pub: record.host_sign_pub,
    subject_sign_pub: subject.sign_pub,
    subject_noise_pub: subject.noise_pub,
    request_id: requestId,
  });
  pending = { request, sas, commit, head };
  setApprovalState({
    kind: "awaiting_sas",
    request_id: requestId,
    sas,
    subject_name: subject.name,
    subject_role: subject.role,
  });

  return getApprovalState();
}

export async function confirmJoin(
  match: boolean,
): Promise<AccountApprovalState> {
  const current = pending;
  if (!current) {
    return getApprovalState();
  }
  pending = null;
  const requestId = current.request.request_id;
  if (!match) {
    await denyJoin(requestId);

    return getApprovalState();
  }
  const { record, state } = requireApprover();
  const { host, device, proofs } = current.request.subject;
  const subject = subjectOf(current.request);
  if (!subject || !proofs) {
    throw "That request is gone";
  }
  const header = { account_id: state.account_id, epoch: state.epoch };
  const signer = { id: record.host_id, priv: record.host_sign_priv };
  // A link writes its computer first, then the window riding along with it.
  const members = [host, device].filter((m): m is AccountMember => !!m);
  const entries: LogEntry[] = [];
  let head = current.head;
  for (const member of members) {
    const entry = makeEntry({ ...header, head }, signer, {
      type: member.role === "host" ? "add_host" : "add_device",
      member,
      request_id: requestId,
      sas_commit: current.commit,
      proof: proofs[member.id],
    });
    entries.push(entry);
    head = { seq: head.seq + 1, hash: entryHash(entry.body) };
  }
  const next = verifyLog(entries, { prior: state });
  if (!next.ok) {
    setApprovalState({ kind: "error", message: "Couldn't build the entry" });

    return getApprovalState();
  }
  try {
    await memberClient(record).append(state.epoch, entries);
  } catch (err) {
    const conflict = err instanceof AccountServiceError && err.status === 409;
    setApprovalState({
      kind: "error",
      message: conflict
        ? "The account changed while approving — try again"
        : "Couldn't reach the account service",
    });

    return getApprovalState();
  }
  record.entries = [...record.entries, ...entries];
  await writeAccountRecord(record);
  setTrust(record, next.state);
  emitAccountStatus();
  capture("account_join_resolved", {
    action: "approved",
    approver: "host",
    subject: subject.role,
  });
  setApprovalState({
    kind: "approved",
    request_id: requestId,
    subject_role: subject.role,
  });

  return getApprovalState();
}

export async function denyJoin(requestId: string): Promise<void> {
  const { record } = requireApprover();
  if (pending?.request.request_id === requestId) {
    pending = null;
  }
  await memberClient(record).deny(requestId);
  capture("account_join_resolved", {
    action: "denied",
    approver: "host",
    subject: listedRoles.get(requestId) ?? "host",
  });
  listedRoles.delete(requestId);
  setApprovalState({ kind: "idle" });
}
