/**
 * The code each approved member was let in with, recomputed from the log.
 * Mirrors Swift's `AccountLog.approvals`, so a device approved while it wasn't
 * watching can check the code its approver lists beside it.
 */

import type { LogEntry } from "./schema";
import { type LogState, verifyLog } from "./log";
import { type AccountSas, accountSas } from "./sas";

export interface AccountApproval {
  member_id: string;
  request_id: string;
  approver_id: string;
  sas: AccountSas;
}

/**
 * Approvals whose `sas_commit` is the code for the head they were written on,
 * the approver's key and the subject's keys, keyed by member id. Stops at the
 * first entry that doesn't verify.
 */
export function accountApprovals(
  entries: readonly LogEntry[],
): Record<string, AccountApproval> {
  const out: Record<string, AccountApproval> = {};
  let prior: LogState | null = null;
  for (const entry of entries) {
    const result = verifyLog([entry], { prior });
    if (!result.ok) {
      return out;
    }
    const next = result.state;
    if (prior) {
      for (const [id, added] of Object.entries(next.members)) {
        if (prior.members[id] || !added.request_id) {
          continue;
        }
        const approver = prior.members[added.added_by];
        if (!approver?.live) {
          continue;
        }
        const sas = accountSas({
          account_id: next.account_id,
          epoch: next.epoch,
          head_hash: prior.head.hash,
          approver_sign_pub: approver.member.sign_pub,
          subject_sign_pub: added.member.sign_pub,
          subject_noise_pub: added.member.noise_pub,
          request_id: added.request_id,
        });
        if (sas.commit === added.sas_commit) {
          out[id] = {
            member_id: id,
            request_id: added.request_id,
            approver_id: added.added_by,
            sas,
          };
        }
      }
    }
    prior = next;
  }

  return out;
}
