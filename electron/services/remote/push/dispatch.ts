/**
 * Fans a desktop notification out to paired devices that aren't currently
 * connected. Connected devices already get it in-band over the gateway socket;
 * the rest need a real push to wake up.
 *
 * Browsers are reached directly — Web Push keys are self-asserted, so no third
 * party is involved. Phones can't be: only the team that owns the app's bundle
 * id may push to it, so APNs/FCM go through the relay, which holds that
 * credential and receives nothing but a blob sealed for the target device.
 */

import type { RemoteNotificationPayload } from "../../notifications/broadcast";
import type { PairedDevice, PushConfig } from "../deviceStore";
import type { PushOutcome } from "./types";
import { log, warn } from "../../../../app/lib/logger";
import {
  clearDevicePush,
  getPushConfig,
  listDevices,
  setDevicePushEnvironment,
} from "../deviceStore";
import { getConnectedDeviceIds } from "../gateway";
import { relayUrlFor } from "./config";
import { isRelayRegistrationDead, sendViaRelay } from "./relay";
import { collapseId, seal, toSealedNotification } from "./seal";
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
        collapseId: n.agent_id ? `agent-${n.agent_id}` : undefined,
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
    n.agent_id ? collapseId(push.push_key, n.agent_id) : undefined,
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
    const targets = (await listDevices()).filter(
      (d) => d.push && !connected.has(d.device_id),
    );
    if (targets.length === 0) {
      return;
    }
    await Promise.all(targets.map((d) => pushToDevice(d, config, n)));
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
  if (!device) {
    return { delivered: false, reason: "device not found" };
  }
  if (!device.push) {
    return {
      delivered: false,
      reason: "this device has not registered for push yet",
    };
  }
  const outcome = await sendOnce(device, config, {
    agent_id: null,
    session_id: null,
    tool_use_id: null,
    kind: "push",
    title: "Argus",
    body: "Push notifications are working.",
    actions: [],
  });

  return outcome.ok
    ? { delivered: true }
    : { delivered: false, reason: outcome.reason };
}
