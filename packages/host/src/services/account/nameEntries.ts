/**
 * The computer-name setting against the log: which renames bring this host
 * (and its window's device) in line with it, and which rename made elsewhere
 * the setting should follow.
 */

import type { AccountRecord } from "./store";
import type { EntrySigner, LogEntry, LogState } from "@argus/remote-protocol";
import { makeEntry, verifyLog } from "@argus/remote-protocol";
import { computerName } from "./store";

/** This host first, then its window's device: each signs its own rename. */
function ownSigners(record: AccountRecord): EntrySigner[] {
  const signers = [{ id: record.host_id, priv: record.host_sign_priv }];
  if (record.device) {
    signers.push({ id: record.device.id, priv: record.device.sign_priv });
  }

  return signers;
}

/** Signed renames for every own live member whose name isn't `name` yet. */
export function renameEntries(
  record: AccountRecord,
  state: LogState,
  name: string,
): LogEntry[] {
  const entries: LogEntry[] = [];
  let prior = state;
  for (const signer of ownSigners(record)) {
    const member = prior.members[signer.id];
    if (!member?.live || member.member.name === name) {
      continue;
    }
    const entry = makeEntry(
      { account_id: prior.account_id, epoch: prior.epoch, head: prior.head },
      signer,
      { type: "rename", member_id: signer.id, name },
    );
    const next = verifyLog([entry], { prior });
    if (!next.ok) {
      break;
    }
    entries.push(entry);
    prior = next.state;
  }

  return entries;
}

/**
 * The name another member gave this computer (or its window) between `prior`
 * and `next`, when the setting should take it. Never while a local edit is
 * still on its way, so an offline rename isn't overwritten by an older one.
 */
export function reflectedName(
  record: AccountRecord,
  prior: LogState,
  next: LogState,
): string | null {
  if (record.name_pending) {
    return null;
  }
  for (const { id } of ownSigners(record)) {
    const before = prior.members[id]?.member.name;
    const after = next.members[id];
    if (
      after?.live &&
      before !== after.member.name &&
      after.member.name !== computerName(record)
    ) {
      return after.member.name;
    }
  }

  return null;
}
