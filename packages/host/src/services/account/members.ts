/**
 * Removing and renaming account members from this console. The Electron
 * window's device signs, so it may act on anyone like any other device; a host
 * without one may only rename or remove itself (§4.2).
 */

import type { AccountStatus, EntrySigner } from "@argus/remote-protocol";
import { makeEntry, MemberName } from "@argus/remote-protocol";
import { capture } from "../telemetry/telemetry";
import { appendOwn } from "./lifecycle";
import { INVALID_NAME, setComputerName } from "./name";
import { logout } from "./service";
import { accountStatus } from "./status";
import { currentRecord, currentState, isLinked } from "./trust";

/** The window's device, while it is still live on the account. */
function windowSigner(): EntrySigner | null {
  const device = currentRecord()?.device;
  if (!device || !currentState()?.members[device.id]?.live) {
    return null;
  }

  return { id: device.id, priv: device.sign_priv };
}

function liveTarget(memberId: string) {
  const target = currentState()?.members[memberId];
  if (!isLinked() || !target?.live) {
    throw "That isn't on the account any more";
  }

  return target.member;
}

export async function revokeMember(memberId: string): Promise<AccountStatus> {
  const record = currentRecord();
  const target = liveTarget(memberId);
  if (memberId === record?.host_id) {
    return logout();
  }
  const signer = windowSigner();
  if (!signer) {
    throw "Remove it from your phone or another Mac — a computer can only remove itself";
  }
  await appendOwn((state) => [
    makeEntry(
      { account_id: state.account_id, epoch: state.epoch, head: state.head },
      signer,
      { type: "revoke", member_id: memberId, reason: "removed" },
    ),
  ]);
  capture("account_member_revoked", { role: target.role, source: "local" });

  return accountStatus();
}

export async function renameMember(
  memberId: string,
  name: string,
): Promise<AccountStatus> {
  const record = currentRecord();
  const target = liveTarget(memberId);
  // This computer's own name is a setting; the list only edits it.
  if (memberId === record?.host_id || memberId === record?.device?.id) {
    return setComputerName(name, "account_list");
  }
  const parsed = MemberName.safeParse(name.trim());
  if (!parsed.success) {
    throw INVALID_NAME;
  }
  const signer = windowSigner();
  if (!signer) {
    throw "Rename it from your phone or another Mac — a computer can only rename itself";
  }
  await appendOwn((state) => [
    makeEntry(
      { account_id: state.account_id, epoch: state.epoch, head: state.head },
      signer,
      { type: "rename", member_id: memberId, name: parsed.data },
    ),
  ]);
  capture("account_member_renamed", { role: target.role });

  return accountStatus();
}
