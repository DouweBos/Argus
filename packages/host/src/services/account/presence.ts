/**
 * Publishes this host's reachable endpoints to the account directory, signed
 * with its account key, whenever they change (debounced) and as a heartbeat.
 * Clients verify the signature against the log, so the service can't steer
 * them at an address this host never named.
 */

import type { PresenceEndpoint } from "@argus/remote-protocol";
import { presenceSigningBytes, signB64 } from "@argus/remote-protocol";
import { warn } from "@argus/host/logger";
import { getEndpoints, onLanChange } from "../remote/endpoints";
import { subscribeTunnelChange } from "../remote/tunnelManager";
import { AccountClient } from "./client";
import { emitAccountStatus } from "./status";
import { serviceUrl, writeAccountRecord } from "./store";
import { currentRecord, currentState, isLinked } from "./trust";

const DEBOUNCE_MS = 2_000;
const HEARTBEAT_MS = 5 * 60_000;

let debounce: NodeJS.Timeout | null = null;
let heartbeat: NodeJS.Timeout | null = null;
let unsubscribers: (() => void)[] = [];

/** Endpoints this host agreed to publish (LAN IPs are metadata, §3). */
export function publishedEndpoints(): PresenceEndpoint[] {
  const publish = currentRecord()?.config.publish;

  return getEndpoints()
    .filter((e) => (publish ? publish[e.kind] : true))
    .map((e) => ({ kind: e.kind, url: e.url, priority: e.priority }));
}

export async function publishPresence(): Promise<void> {
  const record = currentRecord();
  const state = currentState();
  if (!record || !state || !isLinked() || !record.config.enabled) {
    return;
  }
  const body = JSON.stringify({
    v: 1,
    account_id: state.account_id,
    epoch: state.epoch,
    host_id: record.host_id,
    ts: Date.now(),
    endpoints: publishedEndpoints(),
  });
  const client = new AccountClient(serviceUrl(record), {
    sign_priv: record.host_sign_priv,
    sign_pub: record.host_sign_pub,
    member_id: record.host_id,
  });
  try {
    await client.putPresence(
      body,
      signB64(presenceSigningBytes(body), record.host_sign_priv),
    );
    record.presence_at = Date.now();
    await writeAccountRecord(record);
    emitAccountStatus();
  } catch (err) {
    warn(`[account] presence failed: ${(err as Error).message}`);
  }
}

export function publishSoon(): void {
  if (debounce) {
    clearTimeout(debounce);
  }
  debounce = setTimeout(() => {
    debounce = null;
    publishPresence().catch(() => undefined);
  }, DEBOUNCE_MS);
  debounce.unref?.();
}

export function startPresence(): void {
  stopPresence();
  unsubscribers = [
    subscribeTunnelChange(publishSoon),
    onLanChange(publishSoon),
  ];
  heartbeat = setInterval(() => {
    publishPresence().catch(() => undefined);
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  publishSoon();
}

export function stopPresence(): void {
  for (const unsubscribe of unsubscribers) {
    unsubscribe();
  }
  unsubscribers = [];
  if (debounce) {
    clearTimeout(debounce);
    debounce = null;
  }
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}
