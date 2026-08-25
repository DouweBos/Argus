/**
 * Fans a desktop notification out to paired phones that aren't currently
 * connected. Connected devices already get the notification in-band over the
 * gateway socket; the rest need a real APNs/FCM push to wake up.
 *
 * Both providers are spoken directly from this machine, so nothing here
 * depends on an Argus-operated server.
 */

import type { RemoteNotificationPayload } from "../../notifications/broadcast";
import type { PairedDevice, PushConfig } from "../deviceStore";
import { log, warn } from "../../../../app/lib/logger";
import {
  clearDevicePush,
  getPushConfig,
  listDevices,
  setDevicePushEnvironment,
} from "../deviceStore";
import { getConnectedDeviceIds } from "../gateway";
import {
  isApnsTokenDead,
  sendApns,
  type ApnsEnvironment,
  type PushOutcome,
} from "./apns";
import { isFcmTokenDead, sendFcm } from "./fcm";
import { isWebPushSubscriptionDead, sendWebPush } from "./webpush";

/** Give a transient failure exactly one more chance before dropping it. */
const RETRY_DELAY_MS = 2_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function payloadData(n: RemoteNotificationPayload): Record<string, string> {
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
  // FCM and Web Push carry data as strings, so the buttons ride along encoded.
  if (n.actions.length > 0) {
    data.actions = JSON.stringify(n.actions);
    data.categoryId = PERMISSION_CATEGORY;
  }

  return data;
}

/**
 * iOS renders quick actions from a category the app registered, so the wire
 * only carries its name. Keep it in sync with the phone client's `notify.ts`.
 */
const PERMISSION_CATEGORY = "argus.permission";

/** One notification per agent at a time — a newer one replaces the unread old. */
function collapseId(n: RemoteNotificationPayload): string | undefined {
  return n.agent_id ? `agent-${n.agent_id}` : undefined;
}

/**
 * A token minted by a development build only works against the APNs sandbox
 * (and vice versa), and the phone can't always tell which build it is. Rather
 * than guess, retry the other environment once and remember what worked.
 */
const OTHER_ENV: Record<ApnsEnvironment, ApnsEnvironment> = {
  production: "sandbox",
  sandbox: "production",
};

async function sendOnce(
  device: PairedDevice,
  config: PushConfig,
  n: RemoteNotificationPayload,
): Promise<PushOutcome> {
  const push = device.push;
  if (!push) {
    return { ok: false, retryable: false, reason: "no token" };
  }
  const common = {
    title: n.title,
    body: n.body,
    data: payloadData(n),
    collapseId: collapseId(n),
    actions: n.actions,
    category: n.actions.length > 0 ? PERMISSION_CATEGORY : undefined,
  };

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
      common,
      Date.now(),
    );
  }

  if (push.service === "fcm") {
    return sendFcm(config, push.token, common, Date.now());
  }

  const environment: ApnsEnvironment = push.environment ?? "production";
  const outcome = await sendApns(
    config,
    push.token,
    environment,
    common,
    Date.now(),
  );
  if (outcome.ok || !isApnsEnvironmentMismatch(outcome.reason)) {
    return outcome;
  }

  const fallback = OTHER_ENV[environment];
  const retried = await sendApns(
    config,
    push.token,
    fallback,
    common,
    Date.now(),
  );
  if (retried.ok) {
    await setDevicePushEnvironment(device.device_id, fallback);
    push.environment = fallback;
  }

  return retried;
}

function isApnsEnvironmentMismatch(reason: string): boolean {
  return reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic";
}

function isTokenDead(
  service: "apns" | "fcm" | "webpush",
  reason: string,
): boolean {
  if (service === "apns") {
    return isApnsTokenDead(reason);
  }

  return service === "fcm"
    ? isFcmTokenDead(reason)
    : isWebPushSubscriptionDead(reason);
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
  (async () => {
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
  })().catch((err: unknown) => {
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
