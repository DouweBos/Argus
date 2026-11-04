/**
 * The account status every surface renders, plus the console states (code
 * link, approval) that live here so the status can carry them without the
 * state machines importing each other.
 */

import type {
  AccountApprovalState,
  AccountLinkState,
  AccountStatus,
} from "@argus/remote-protocol";
import { safetyCode } from "@argus/remote-protocol";
import { emitHostEvent } from "@argus/host/bus";
import { computerName, DEFAULT_ACCOUNT_CONFIG, machineName } from "./store";
import {
  currentLogError,
  currentRecord,
  currentState,
  isLinked,
} from "./trust";

let linkState: AccountLinkState = { kind: "idle" };
let approvalState: AccountApprovalState = { kind: "idle" };

export function getLinkState(): AccountLinkState {
  return linkState;
}

export function setLinkState(next: AccountLinkState): void {
  linkState = next;
  emitHostEvent("account:link-state", next);
  emitAccountStatus();
}

export function getApprovalState(): AccountApprovalState {
  return approvalState;
}

export function setApprovalState(next: AccountApprovalState): void {
  approvalState = next;
  emitHostEvent("account:approval-state", next);
}

export function accountStatus(): AccountStatus {
  const record = currentRecord();
  const state = currentState();
  const linked = isLinked();

  return {
    linked,
    account_id: linked ? (state?.account_id ?? null) : null,
    epoch: linked ? (state?.epoch ?? null) : null,
    host_id: linked ? (record?.host_id ?? null) : null,
    device_id:
      linked && record?.device && state?.members[record.device.id]?.live
        ? record.device.id
        : null,
    safety_code: linked && state ? safetyCode(state.genesis_hash) : null,
    head_seq: linked ? (state?.head.seq ?? null) : null,
    log_error: currentLogError(),
    presence_at: linked ? (record?.presence_at ?? null) : null,
    config: record?.config ?? DEFAULT_ACCOUNT_CONFIG,
    link: linkState,
    name: computerName(record),
    system_name: machineName(),
    reset: linked ? null : (record?.reset_notice ?? null),
  };
}

export function emitAccountStatus(): void {
  emitHostEvent("account:status", accountStatus());
}
