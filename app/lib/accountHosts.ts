/**
 * Computers on this desktop's account, merged into the paired-hosts list so
 * the Hosts screen and the transport treat them like any other host. The
 * account wins on the address (it tracks tunnel changes); a QR pairing to the
 * same computer keeps its own keys and grant.
 */

import type { AccountDeviceKey, AccountHost } from "./types";
import {
  addRemoteHost,
  getRemoteHosts,
  type RemoteHost,
} from "../stores/settingsStore";
import { accountDeviceKey, accountListHosts } from "./ipc";

/** The address to dial first: the LAN when published, else the best tunnel. */
export function preferredUrl(host: AccountHost): string | null {
  const sorted = [...host.endpoints].sort((a, b) => a.priority - b.priority);

  return sorted[0]?.url ?? null;
}

/** What the store should hold, given the account's verified computers. */
export function mergeAccountHosts(
  existing: RemoteHost[],
  hosts: AccountHost[],
  key: AccountDeviceKey | null,
): { forget: string[]; upsert: RemoteHost[] } {
  const upsert: RemoteHost[] = [];
  const listed = new Set<string>();
  for (const host of hosts) {
    if (host.is_self) {
      continue;
    }
    const url = preferredUrl(host);
    const paired = existing.find(
      (h) => h.source !== "account" && h.hostPubB64 === host.noise_pub,
    );
    if (paired) {
      if (url && paired.url !== url) {
        upsert.push({ ...paired, url });
      }
      continue;
    }
    if (!key) {
      continue;
    }
    listed.add(host.host_id);
    const current = existing.find((h) => h.id === host.host_id);
    const next: RemoteHost = {
      id: host.host_id,
      label: current?.label ?? host.name,
      url: url ?? current?.url ?? "",
      devPrivB64: key.noise_priv,
      devPubB64: key.noise_pub,
      hostPubB64: host.noise_pub,
      // The host decides; this mirrors the account default for desktops.
      capabilities: ["monitor", "control", "admin"],
      pairedAt: current?.pairedAt ?? Date.now(),
      source: "account",
    };
    if (
      !current ||
      current.url !== next.url ||
      current.hostPubB64 !== next.hostPubB64 ||
      current.devPubB64 !== next.devPubB64
    ) {
      upsert.push(next);
    }
  }
  const forget = existing
    .filter((h) => h.source === "account" && !listed.has(h.id))
    .map((h) => h.id);

  return { upsert, forget };
}

/** Pull the account's computers into the host list. Best effort. */
export async function refreshAccountHosts(): Promise<AccountHost[]> {
  const [hosts, key] = await Promise.all([
    accountListHosts(),
    accountDeviceKey(),
  ]);
  const { upsert, forget } = mergeAccountHosts(getRemoteHosts(), hosts, key);
  for (const host of upsert) {
    addRemoteHost(host);
  }
  if (forget.length > 0) {
    const { forgetHost } = await import("./transport");
    await Promise.allSettled(forget.map((id) => forgetHost(id)));
  }

  return hosts;
}
