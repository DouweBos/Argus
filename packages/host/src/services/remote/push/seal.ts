/**
 * Sealed notification payloads.
 *
 * The push relay must never learn what an agent is doing, so the whole
 * notification — title, body, which agent, which project — is encrypted for
 * one device before it leaves this machine. The key is minted by that device
 * and handed over the paired, Noise-encrypted gateway; the relay only ever
 * sees the ciphertext.
 *
 * Format: `nonce(12) ‖ ciphertext ‖ tag(16)`, base64. Kept deliberately plain
 * so an iOS Notification Service Extension can open it with CryptoKit and an
 * Android handler with javax.crypto, neither of which can run Noise.
 */

import type { RemoteNotificationPayload } from "../../notifications/broadcast";
import { createCipheriv, createHmac, randomBytes } from "node:crypto";

/** What the device's extension decrypts and renders. */
export interface SealedNotification {
  title: string;
  body: string;
  kind: RemoteNotificationPayload["kind"];
  agentId: string | null;
  sessionId: string | null;
  toolUseId: string | null;
  actions: RemoteNotificationPayload["actions"];
}

export function toSealedNotification(
  n: RemoteNotificationPayload,
): SealedNotification {
  return {
    title: n.title,
    body: n.body,
    kind: n.kind,
    agentId: n.agent_id,
    sessionId: n.session_id,
    toolUseId: n.tool_use_id,
    actions: n.actions,
  };
}

/** Encrypt a notification for one device. `pushKey` is 32 bytes, base64. */
export function seal(
  pushKey: string,
  notification: SealedNotification,
  nonce: Buffer = randomBytes(12),
): string {
  return sealJson(pushKey, notification, nonce);
}

/** Encrypt any JSON value for one device, in the notification format. */
export function sealJson(
  pushKey: string,
  value: unknown,
  nonce: Buffer = randomBytes(12),
): string {
  const key = Buffer.from(pushKey, "base64");
  if (key.length !== 32) {
    throw new Error("push key must be 32 bytes");
  }
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(value), "utf-8")),
    cipher.final(),
  ]);

  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString(
    "base64",
  );
}

/**
 * What a notification is allowed to replace on the lock screen, or null to let
 * it stack.
 *
 * A turn result supersedes the previous one for that agent. Two pending
 * approvals are separate decisions, so they collapse per prompt rather than
 * per agent — collapsing those would hide one. Anything an agent pushes
 * through the MCP tool is its own event and never replaces anything.
 */
export function collapseSubject(n: RemoteNotificationPayload): string | null {
  switch (n.kind) {
    case "failed":
    case "finished":
      return n.agent_id ? `agent-${n.agent_id}` : null;
    case "permission":
      return n.tool_use_id ? `prompt-${n.tool_use_id}` : null;
    default:
      return null;
  }
}

/**
 * An opaque, per-device collapse id. Apple and Google both see this header, so
 * it must not name the agent — a keyed digest gives the same "replace the
 * unread one" behaviour while telling the relay nothing.
 */
export function collapseId(pushKey: string, subject: string): string {
  return createHmac("sha256", Buffer.from(pushKey, "base64"))
    .update(subject)
    .digest("base64url")
    .slice(0, 22);
}
