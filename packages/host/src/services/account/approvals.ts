/**
 * Approving another computer's link from this host's console (§4.4): the
 * Electron window, the Mac app's local host, or `argus-host approve`. Never
 * reachable over the gateway — every command here is host-tier.
 */

import type { JoinRequestRow } from "./client";
import type {
  AccountApprovalState,
  AccountJoinRequest,
  LogEntry,
} from "@argus/remote-protocol";
import {
  accountSas,
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

  return requests
    .filter((r) => r.subject.host)
    .map((r) => ({
      request_id: r.request_id,
      kind: r.kind,
      subject_name: r.subject.host?.name ?? "",
      status: r.status,
      created_at: r.created_at,
      expires_at: r.expires_at,
    }));
}

/** Both proofs must check out before this host vouches for anything. */
function subjectProven(request: JoinRequestRow): boolean {
  const { host, device, proofs } = request.subject;
  if (!host || !proofs) {
    return false;
  }
  const hostOk = verifyB64(
    proofSigningBytes(host),
    proofs[host.id] ?? "",
    host.sign_pub,
  );
  const deviceOk =
    !device ||
    verifyB64(
      proofSigningBytes(device),
      proofs[device.id] ?? "",
      device.sign_pub,
    );

  return hostOk && deviceOk;
}

export async function approveJoin(
  requestId: string,
): Promise<AccountApprovalState> {
  const { record } = requireApprover();
  const client = memberClient(record);
  const { requests } = await client.listJoins();
  const request = requests.find((r) => r.request_id === requestId);
  if (!request?.subject.host) {
    throw "That request is gone or isn't a computer link";
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
    subject_sign_pub: request.subject.host.sign_pub,
    subject_noise_pub: request.subject.host.noise_pub,
    request_id: requestId,
  });
  pending = { request, sas, commit, head };
  setApprovalState({
    kind: "awaiting_sas",
    request_id: requestId,
    sas,
    subject_name: request.subject.host.name,
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
  if (!host || !proofs) {
    throw "That request is gone";
  }
  const header = { account_id: state.account_id, epoch: state.epoch };
  const signer = { id: record.host_id, priv: record.host_sign_priv };
  const entries: LogEntry[] = [
    makeEntry({ ...header, head: current.head }, signer, {
      type: "add_host",
      member: host,
      request_id: requestId,
      sas_commit: current.commit,
      proof: proofs[host.id],
    }),
  ];
  let next = verifyLog(entries, { prior: state });
  if (device && next.ok) {
    entries.push(
      makeEntry({ ...header, head: next.state.head }, signer, {
        type: "add_device",
        member: device,
        request_id: requestId,
        sas_commit: current.commit,
        proof: proofs[device.id],
      }),
    );
    next = verifyLog(entries, { prior: state });
  }
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
  capture("account_join_resolved", { action: "approved", approver: "host" });
  setApprovalState({ kind: "approved", request_id: requestId });

  return getApprovalState();
}

export async function denyJoin(requestId: string): Promise<void> {
  const { record } = requireApprover();
  if (pending?.request.request_id === requestId) {
    pending = null;
  }
  await memberClient(record).deny(requestId);
  capture("account_join_resolved", { action: "denied", approver: "host" });
  setApprovalState({ kind: "idle" });
}
