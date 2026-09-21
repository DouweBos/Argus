/**
 * The single place a user-facing agent notification is shown and fanned out.
 *
 * Everything routes through here so the desktop banner, the phone, and the
 * browser carry the same title, body, and quick actions — including the
 * Approve/Deny buttons on a permission prompt, which Electron can only render
 * from the main process.
 */

import type { RemoteNotificationPayload } from "./broadcast";
import { emitHostEvent } from "@argus/host/bus";
import { warn } from "@argus/host/logger";
import { hostPlatform } from "@argus/host/platform";
import { respondToPermission } from "../agent/agentService";
import { loadAppSettings } from "../appSettings/store";
import { broadcastRemoteNotification, permissionActions } from "./broadcast";

/** What a caller describes; the quick actions are derived from it here. */
export interface AgentNotificationInput {
  agent_id: string | null;
  session_id: string | null;
  /** The prompt to answer. Only meaningful for `kind: "permission"`. */
  tool_use_id: string | null;
  /** The tool being requested — decides which quick actions make sense. */
  tool_name: string | null;
  kind: RemoteNotificationPayload["kind"];
  title: string;
  body: string;
}

export type NotificationUrgency = "critical" | "normal";

export interface ShowNotificationOptions {
  /**
   * Whether to raise a banner on this Mac. The renderer passes false when the
   * window is focused (you're already looking at it).
   */
  showLocal: boolean;
  urgency?: NotificationUrgency;
}

/**
 * Whether the phone and browsers should hear about this. While you're sitting
 * in a focused Argus window they're unattended surfaces buzzing for something
 * already on screen, so they stay quiet unless you opt back in.
 */
function shouldNotifyRemote(): boolean {
  if (loadAppSettings().remote_notify_when_focused) {
    return true;
  }

  return !hostPlatform().isForeground();
}

function focusWindow(): void {
  hostPlatform().focusUi();
}

/** Navigate the renderer to the agent a notification came from. */
function routeToAgent(payload: RemoteNotificationPayload): void {
  if (!payload.agent_id || !payload.session_id) {
    return;
  }
  emitHostEvent("agent_notification_clicked", {
    agent_id: payload.agent_id,
    session_id: payload.session_id,
  });
}

/**
 * Answer a permission prompt straight from the notification. Safe to lose —
 * the prompt may already be gone (answered elsewhere, or the agent moved on),
 * in which case there is nothing to do.
 */
function runAction(
  payload: RemoteNotificationPayload,
  actionId: "approve" | "deny",
): void {
  if (!payload.agent_id || !payload.tool_use_id) {
    return;
  }
  try {
    respondToPermission(
      payload.agent_id,
      payload.tool_use_id,
      actionId === "approve" ? "allow" : "deny",
    );
  } catch (err) {
    warn(`[notify] could not ${actionId} from notification: ${String(err)}`);
  }
}

/**
 * Show the notification locally (when asked) and mirror it to paired devices
 * when they aren't redundant. Returns whether a local banner was raised.
 */
export function showAgentNotification(
  input: AgentNotificationInput,
  options: ShowNotificationOptions,
): boolean {
  const payload: RemoteNotificationPayload = {
    ...input,
    // Derived here, once, so every surface offers the same buttons.
    actions:
      input.kind === "permission"
        ? permissionActions(input.tool_name ?? "")
        : [],
  };
  if (shouldNotifyRemote()) {
    broadcastRemoteNotification(payload);
  }

  if (!options.showLocal || !hostPlatform().notificationsSupported()) {
    return false;
  }

  hostPlatform().notify({
    title: payload.title,
    body: payload.body,
    urgency: options.urgency === "critical" ? "critical" : "normal",
    actions: payload.actions.map((a) => a.title),
    onAction: (index) => {
      const action = payload.actions[index];
      if (action) {
        runAction(payload, action.id);
      }
    },
    onClick: () => {
      focusWindow();
      routeToAgent(payload);
    },
  });

  return true;
}
