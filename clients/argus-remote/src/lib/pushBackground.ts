/**
 * Android's half of sealed push.
 *
 * iOS decrypts in a Notification Service Extension, which Android has no
 * equivalent of — so the relay sends Android a data-only message and this
 * background task opens it and posts the real notification itself. Data-only
 * also avoids the system rendering the ciphertext straight into the shade.
 */

import { gcm } from "@noble/ciphers/aes.js";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { fromBase64, toUtf8 } from "./base64";
import { ensureRelayKeys } from "./push";

const TASK_NAME = "argus-sealed-push";
const PERMISSION_CATEGORY = "argus.permission";

interface SealedNotification {
  title: string;
  body: string;
  kind: string;
  agentId: string | null;
  sessionId: string | null;
  toolUseId: string | null;
  actions: { id: string; title: string }[];
}

/**
 * Wire format, matching `seal.ts` on the desktop: base64 of
 * `nonce(12) ‖ ciphertext ‖ tag(16)`, AES-256-GCM. Noble wants the tag left
 * attached to the ciphertext.
 */
export function openSealed(
  pushKeyB64: string,
  sealedB64: string,
): SealedNotification | null {
  try {
    const blob = fromBase64(sealedB64);
    if (blob.length <= 28) {
      return null;
    }
    const plaintext = gcm(fromBase64(pushKeyB64), blob.subarray(0, 12)).decrypt(
      blob.subarray(12),
    );

    return JSON.parse(toUtf8(plaintext)) as SealedNotification;
  } catch {
    return null;
  }
}

async function handleSealed(sealed: string): Promise<void> {
  const keys = await ensureRelayKeys();
  const opened = openSealed(keys.pushKey, sealed);
  if (!opened) {
    return;
  }
  await Notifications.scheduleNotificationAsync({
    // Matches the desktop's collapse key, so a newer alert about the same
    // agent replaces the unread one instead of stacking.
    identifier: opened.agentId ? `agent-${opened.agentId}` : undefined,
    content: {
      title: opened.title,
      body: opened.body,
      categoryIdentifier:
        opened.actions.length > 0 ? PERMISSION_CATEGORY : undefined,
      data: {
        agentId: opened.agentId ?? undefined,
        sessionId: opened.sessionId ?? undefined,
        toolUseId: opened.toolUseId ?? undefined,
        label: opened.title,
        kind: opened.kind,
      },
    },
    trigger: null,
  });
}

TaskManager.defineTask(TASK_NAME, async ({ data, error }) => {
  if (error) {
    return;
  }
  const sealed = (data as { e?: string } | undefined)?.e;
  if (typeof sealed === "string") {
    await handleSealed(sealed);
  }
});

/** Start handling sealed data pushes. iOS uses the extension instead. */
export async function startSealedPushHandling(): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }
  try {
    await Notifications.registerTaskAsync(TASK_NAME);
  } catch {
    // Without the task Android still shows nothing rather than ciphertext.
  }
}
