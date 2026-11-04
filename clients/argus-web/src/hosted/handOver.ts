/**
 * Handing a removal straight to the account's computers (`account.sync`), as
 * the apps do, so the account service can't hold it back. The browser keeps
 * at most one computer open, so the others get a short-lived connection of
 * their own.
 */

import { Transport } from "@argus/remote-client";
import type { AccountComputer } from "../account/directory";
import type { AccountSession } from "../account/session";
import { readyTransport, useConnectionStore } from "../stores/connection";
import { syncHost } from "./openComputer";

/** How long one computer gets to finish the handshake and take the entries. */
const HAND_OVER_TIMEOUT_MS = 10_000;

function syncOnce(session: AccountSession, computer: AccountComputer): Promise<boolean> {
  const credentials = session.credentialsFor(computer);
  if (!credentials) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        transport.disconnect();
        resolve(ok);
      }
    };
    const transport = new Transport(credentials, {
      onState: (state) => {
        if (state === "ready") {
          syncHost(session, transport).then(
            () => finish(true),
            () => finish(false),
          );
        }
      },
      onEvent: () => {},
    });
    const timer = setTimeout(() => finish(false), HAND_OVER_TIMEOUT_MS);
    transport.connect();
  });
}

/**
 * Sync every online computer in `computers` (read before the removal, so a
 * removed computer still hears of its own removal). Resolves to how many
 * took the entries.
 */
export async function handOverToComputers(
  session: AccountSession,
  computers: AccountComputer[],
): Promise<number> {
  const openId = useConnectionStore.getState().identity?.account?.hostId;
  const open = readyTransport();
  const results = await Promise.all(
    computers
      .filter((c) => c.online && c.routes.length > 0)
      .map((c) =>
        c.id === openId && open
          ? syncHost(session, open).then(
              () => true,
              () => false,
            )
          : syncOnce(session, c),
      ),
  );

  return results.filter(Boolean).length;
}
