/**
 * What a browser may do to the account's members: rename and remove them,
 * and delete the whole account. All of it only takes trust away — a web
 * member's approval is refused by every verifier (`web_approver`), so
 * nothing here adds a device or computer.
 */

import type { AccountMember } from "@argus/remote-protocol/account";
import { normalizeMemberName } from "@argus/remote-protocol/account";
import { AccountServiceError } from "./client";
import type { AccountSession } from "./session";

function liveMember(session: AccountSession, id: string): AccountMember {
  const found = session.state?.members[id];
  if (!found?.live) {
    throw new Error("That device or computer is no longer on your account.");
  }

  return found.member;
}

/** Renames `id` on the account; this browser goes through its name setting. */
export async function renameMember(
  session: AccountSession,
  id: string,
  raw: string,
): Promise<void> {
  if (id === session.vault.keys?.memberId) {
    if (!(await session.setName(raw))) {
      throw new Error(session.error ?? "Names are 1–64 characters on one line.");
    }

    return;
  }
  const name = normalizeMemberName(raw);
  if (!name) {
    throw new Error("Names are 1–64 characters on one line.");
  }
  if (liveMember(session, id).name === name) {
    return;
  }
  await session.appendWithRetry(async (head) => [
    await session.entry(head, { type: "rename", member_id: id, name }),
  ]);
}

/**
 * Takes another device or computer off the account. The caller then hands
 * the entry to the computers it can reach (`handOver.ts`); the rest pick it
 * up from the service.
 */
export async function removeMember(session: AccountSession, id: string): Promise<void> {
  if (id === session.vault.keys?.memberId) {
    throw new Error("Use Sign out to take this browser off the account.");
  }
  liveMember(session, id);
  await session.appendWithRetry(async (head) => [
    await session.entry(head, { type: "revoke", member_id: id, reason: "removed" }),
  ]);
}

export type DeleteOutcome = "deleted" | "cancelled";

/**
 * Deletes the account on the service: every device and computer loses it.
 * The service wants a sign-in verified in the last 10 minutes, so a 403
 * asks the user to verify and tries once more.
 */
export async function deleteAccount(
  session: AccountSession,
): Promise<{ outcome: DeleteOutcome; reverified: boolean }> {
  let reverified = false;
  try {
    await session.client.deleteAccount();
  } catch (err) {
    if (!(err instanceof AccountServiceError) || err.status !== 403) {
      throw err;
    }
    if (!(await session.deps.auth.reverify())) {
      return { outcome: "cancelled", reverified };
    }
    reverified = true;
    await session.client.deleteAccount();
  }
  await session.forget();
  // Signed in to an empty account now: the page says how to start over.
  await session.bootstrap();

  return { outcome: "deleted", reverified };
}
