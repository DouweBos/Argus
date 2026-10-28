/**
 * This computer's name: a setting that defaults to the system name, is what
 * it links as, and — while linked — owns its name on the account.
 */

import type { AccountStatus } from "@argus/remote-protocol";
import { normalizeMemberName } from "@argus/remote-protocol";
import { capture } from "../telemetry/telemetry";
import { flushComputerName } from "./lifecycle";
import { accountStatus, emitAccountStatus } from "./status";
import { ensureAccountRecord, writeAccountRecord } from "./store";
import { currentRecord, currentState, isLinked, setTrust } from "./trust";

export type NameSource =
  | "account_list"
  | "server_tray"
  | "settings"
  | "terminal";

export const INVALID_NAME = "Names are 1–64 characters on one line";

/** `null` goes back to the system name. */
export async function setComputerName(
  raw: string | null,
  source: NameSource,
): Promise<AccountStatus> {
  const name = raw === null ? null : normalizeMemberName(raw);
  if (raw !== null && name === null) {
    throw INVALID_NAME;
  }
  const record = currentRecord() ?? (await ensureAccountRecord());
  if ((record.name ?? null) === name) {
    return accountStatus();
  }
  record.name = name;
  record.name_pending = isLinked();
  await writeAccountRecord(record);
  if (currentRecord() !== record) {
    setTrust(record, currentState());
  }
  capture("device_name_changed", { source, linked: isLinked() });
  await flushComputerName();
  emitAccountStatus();

  return accountStatus();
}
