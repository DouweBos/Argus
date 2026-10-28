/**
 * Fans a desktop notification out to paired devices that aren't currently
 * connected. Connected devices already get it in-band over the gateway socket;
 * the rest need a real push to wake up.
 *
 * Browsers are reached directly — Web Push keys are self-asserted, so no third
 * party is involved. Phones can't be: only the team that owns the app's bundle
 * id may push to it, so APNs/FCM go through the relay, which holds that
 * credential and receives nothing but a blob sealed for the target device.
 *
 * Account devices that never opened this host are reached through the account
 * instead (`account/push.ts`). A phone has one push key per install, so a
 * registration this host already holds with that key covers it: no doubles.
 */

import type { RemoteNotificationPayload } from "../../notifications/broadcast";
import type { PairedDevice, PushConfig } from "../deviceStore";
import type { PushOutcome } from "./types";
import type { AccountPushTarget } from "../../account/push";
import { log, warn } from "@argus/host/logger";
import { accountPushTargets, sendAccountPush } from "../../account/push";
import {
  clearDevicePush,
  getPushConfig,
  listDevices,
  setDevicePushEnvironment,
} from "../deviceStore";
import { getConnectedDeviceIds } from "../gateway";
import { relayUrlFor } from "./config";
import { isRelayRegistrationDead, sendViaRelay } from "./relay";
import {
  collapseId,
  collapseSubject,
  seal,
  toSealedNotification,
} from "./seal";
import { isWebPushSubscriptionDead, sendWebPush } from "./webpush";

/** Give a transient failure exactly one more chance before dropping it. */
const RETRY_DELAY_MS = 2_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Browsers render the notification themselves, so they get it in the clear. */
function webPushData(n: RemoteNotificationPayload): Record<string, string> {
  const data: Record<string, string> = { kind: n.kind, label: n.title };
  if (n.agent_id) {
    data.agentId = n.agent_id;
  }
  if (n.session_id) {
    data.sessionId = n.session_id;
  }
  if (n.tool_use_id) {
    data.toolUseId = n.tool_use_id;
  }

  return data;
}

async function sendOnce(
  device: PairedDevice,
  config: PushConfig,
  n: RemoteNotificationPayload,
): Promise<PushOutcome> {
  const push = device.push;
  if (!push) {
    return { ok: false, retryable: false, reason: "no token" };
  }

  if (push.service === "webpush") {
    if (!push.keys) {
      return {
        ok: false,
        retryable: false,
        reason: "subscription is missing its encryption keys",
      };
    }

    return sendWebPush(
      config,
      { endpoint: push.token, ...push.keys },
      {
        title: n.title,
        body: n.body,
        data: webPushData(n),
        collapseId: collapseSubject(n) ?? undefined,
        actions: n.actions,
      },
      Date.now(),
    );
  }

  if (!push.push_key || !push.auth_key) {
    return {
      ok: false,
      retryable: false,
      reason: "device has not registered relay keys",
    };
  }

  const subject = collapseSubject(n);
  let sealed: string;
  try {
    sealed = seal(push.push_key, toSealedNotification(n));
  } catch (err) {
    return { ok: false, retryable: false, reason: (err as Error).message };
  }

  const result = await sendViaRelay(
    relayUrlFor(config),
    {
      service: push.service,
      token: push.token,
      authKey: push.auth_key,
      environment: push.environment,
    },
    sealed,
    subject ? collapseId(push.push_key, subject) : undefined,
    Date.now(),
  );

  // The relay resolves sandbox-vs-production itself; remember what worked.
  if (
    result.ok &&
    result.environment &&
    result.environment !== push.environment
  ) {
    await setDevicePushEnvironment(device.device_id, result.environment);
    push.environment = result.environment;
  }

  return result;
}

function isTokenDead(
  service: "apns" | "fcm" | "webpush",
  reason: string,
): boolean {
  return service === "webpush"
    ? isWebPushSubscriptionDead(reason)
    : isRelayRegistrationDead(reason);
}

async function sendAccountOnce(
  target: AccountPushTarget,
  n: RemoteNotificationPayload,
): Promise<PushOutcome> {
  const subject = collapseSubject(n);
  let sealed: string;
  try {
    sealed = seal(target.push_key, toSealedNotification(n));
  } catch (err) {
    return { ok: false, retryable: false, reason: (err as Error).message };
  }

  return sendAccountPush(
    target,
    sealed,
    subject ? collapseId(target.push_key, subject) : undefined,
  );
}

async function pushToAccountDevice(
  target: AccountPushTarget,
  n: RemoteNotificationPayload,
): Promise<void> {
  let outcome = await sendAccountOnce(target, n);
  if (!outcome.ok && outcome.retryable) {
    await delay(RETRY_DELAY_MS);
    outcome = await sendAccountOnce(target, n);
  }
  if (outcome.ok) {
    log(`[push] delivered "${n.kind}" to ${target.label} via the account`);
  } else {
    warn(`[push] ${target.label} (account): ${outcome.reason}`);
  }
}

/**
 * Account devices to push to: not connected, and not already reached through
 * a registration on this host carrying the same push key.
 */
export function accountTargetsToPush(
  targets: AccountPushTarget[],
  devices: PairedDevice[],
  connected: Set<string>,
): AccountPushTarget[] {
  const covered = new Set(
    devices.flatMap((d) => (d.push?.push_key ? [d.push.push_key] : [])),
  );

  return targets.filter(
    (t) => !connected.has(t.device_id) && !covered.has(t.push_key),
  );
}

async function pushToDevice(
  device: PairedDevice,
  config: PushConfig,
  n: RemoteNotificationPayload,
): Promise<void> {
  let outcome = await sendOnce(device, config, n);
  if (!outcome.ok && outcome.retryable) {
    await delay(RETRY_DELAY_MS);
    outcome = await sendOnce(device, config, n);
  }
  if (outcome.ok) {
    log(`[push] delivered "${n.kind}" to ${device.label}`);

    return;
  }
  warn(`[push] ${device.label}: ${outcome.reason}`);
  if (device.push && isTokenDead(device.push.service, outcome.reason)) {
    await clearDevicePush(device.device_id);
  }
}

/**
 * Deliver a notification to every registered-but-offline device. Fire and
 * forget — notification delivery must never block or fail the caller.
 */
export function dispatchRemotePush(n: RemoteNotificationPayload): void {
  const run = async (): Promise<void> => {
    const config = await getPushConfig();
    if (!config.enabled) {
      return;
    }
    const connected = new Set(getConnectedDeviceIds());
    const devices = await listDevices();
    const targets = devices.filter(
      (d) => d.push && !connected.has(d.device_id),
    );
    const viaAccount = accountTargetsToPush(
      await accountPushTargets().catch(() => []),
      devices,
      connected,
    );
    await Promise.all([
      ...targets.map((d) => pushToDevice(d, config, n)),
      ...viaAccount.map((t) => pushToAccountDevice(t, n)),
    ]);
  };
  run().catch((err: unknown) => {
    warn(`[push] dispatch failed: ${(err as Error).message}`);
  });
}

/** Send a test notification to one device, surfacing the failure reason. */
export async function sendTestPush(
  deviceId: string,
): Promise<{ delivered: boolean; reason?: string }> {
  const config = await getPushConfig();
  const device = (await listDevices()).find((d) => d.device_id === deviceId);
  const test: RemoteNotificationPayload = {
    agent_id: null,
    session_id: null,
    tool_use_id: null,
    kind: "push",
    title: "Argus",
    body: "Push notifications are working.",
    actions: [],
  };
  // An account device that registered through the account, not with us.
  const viaAccount = device?.push
    ? undefined
    : (await accountPushTargets().catch(() => [])).find(
        (t) => t.device_id === deviceId,
      );
  if (viaAccount) {
    const sent = await sendAccountOnce(viaAccount, test);

    return sent.ok
      ? { delivered: true }
      : { delivered: false, reason: sent.reason };
  }
  if (!device) {
    return { delivered: false, reason: "device not found" };
  }
  if (!device.push) {
    return {
      delivered: false,
      reason: "this device has not registered for push yet",
    };
  }
  const outcome = await sendOnce(device, config, test);

  return outcome.ok
    ? { delivered: true }
    : { delivered: false, reason: outcome.reason };
}
