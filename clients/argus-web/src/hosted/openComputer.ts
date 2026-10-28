/**
 * Opening an account computer in the shared monitor UI: dial its `wss://`
 * route with this browser's account key, then hand it any log entries it
 * hasn't seen (`account.sync`), so a removal reaches it even if the account
 * service holds it back.
 */

import type { Transport } from "@argus/remote-client";
import { accountSession } from "../account/accountStore";
import type { AccountComputer } from "../account/directory";
import type { AccountSession } from "../account/session";
import { useAppStore } from "../lib/store";

export async function syncHost(
  session: AccountSession,
  transport: Transport,
): Promise<void> {
  const status = await transport.request<{
    linked: boolean;
    account_id_hash: string | null;
    head_seq: number | null;
  }>("account.status", {});
  const payload = session.syncPayload(status);
  if (payload) {
    await transport.request("account.sync", payload);
  }
}

/** False when this browser has no keys or the computer has no route it can dial. */
export function openComputer(computer: AccountComputer): boolean {
  const session = accountSession();
  const credentials = session?.credentialsFor(computer);
  if (!session || !credentials) {
    return false;
  }
  void session.rememberHost(computer.id);
  useAppStore.getState().openAccountHost({
    deviceId: `account:${computer.id}`,
    devPrivB64: "",
    devPubB64: credentials.devPubB64,
    desktopPubB64: computer.noisePub,
    url: credentials.url,
    capabilities: [],
    name: session.name,
    account: {
      hostId: computer.id,
      hostName: computer.name,
      credentials,
      onReady: (transport) => {
        syncHost(session, transport).catch(() => undefined);
      },
      leave: () => {
        useAppStore.getState().closeHost();
        void session.rememberHost(null);
      },
    },
  });

  return true;
}
