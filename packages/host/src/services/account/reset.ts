/**
 * Following an account reset (§5.8): the account moved to a newer epoch that
 * this host isn't in. It can't verify a reset — the service could forge one —
 * so it never follows it. It goes unlinked instead, drops its account devices
 * and asks to be linked again from its own console.
 */

import type { AccountResetNotice, AccountStatus } from "@argus/remote-protocol";
import { verifyLog } from "@argus/remote-protocol";
import { info, warn } from "@argus/host/logger";
import { capture } from "../telemetry/telemetry";
import { type AccountResetSignal, setAccountResetHandler } from "./client";
import { forgetAccount, syncLog } from "./lifecycle";
import { accountStatus, emitAccountStatus } from "./status";
import { writeAccountRecord } from "./store";
import { currentRecord, currentState, isLinked } from "./trust";

let following: Promise<void> | null = null;

export function watchAccountReset(): void {
  setAccountResetHandler((signal) => {
    following ??= followReset(signal)
      .catch((err: unknown) => {
        warn(`[account] reset not followed: ${String(err)}`);
      })
      .finally(() => {
        following = null;
      });
  });
}

/** The notice to keep, or null when the signal doesn't concern this host's account. */
export function resetNotice(
  signal: AccountResetSignal,
  pinned: { account_id: string; epoch: number },
  now = Date.now(),
): AccountResetNotice | null {
  if (signal.epoch <= pinned.epoch) {
    return null;
  }
  if (!signal.genesis) {
    return { epoch: signal.epoch, at: now, by_name: null };
  }
  // A bug guard, not a proof: a genesis for this account at that epoch.
  const result = verifyLog([signal.genesis]);
  if (
    !result.ok ||
    result.state.account_id !== pinned.account_id ||
    result.state.epoch !== signal.epoch
  ) {
    return null;
  }
  const founder = Object.values(result.state.members)[0]?.member;
  const ts = (JSON.parse(signal.genesis.body) as { ts?: unknown }).ts;

  return {
    epoch: signal.epoch,
    at: typeof ts === "number" ? ts : now,
    by_name: founder?.name ?? null,
  };
}

async function followReset(signal: AccountResetSignal): Promise<void> {
  const state = currentState();
  if (!state || !isLinked()) {
    return;
  }
  const notice = resetNotice(signal, state);
  if (!notice) {
    warn("[account] ignored a reset that doesn't match this account");

    return;
  }
  info(
    "[account] This account was reset from another device — link this computer again.",
  );
  capture("account_reset_seen", { action: "unlinked" });
  await forgetAccount(notice);
}

/** Resolves once a reset noticed by an in-flight request has been followed. */
export async function settleReset(): Promise<void> {
  await following;
}

/** Before linking: a host that hasn't noticed the reset yet unlinks first. */
export async function refreshBeforeLink(): Promise<void> {
  if (!isLinked()) {
    return;
  }
  await syncLog();
  await settleReset();
}

export async function dismissReset(): Promise<AccountStatus> {
  const record = currentRecord();
  if (record?.reset_notice) {
    record.reset_notice = null;
    await writeAccountRecord(record);
    capture("account_reset_seen", { action: "dismissed" });
    emitAccountStatus();
  }

  return accountStatus();
}
