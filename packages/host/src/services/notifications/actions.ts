/**
 * Which quick actions a notification offers. Kept dependency-free so the rule
 * lives in exactly one place — the desktop banner, the phone, and the browser
 * all render whatever this returns.
 */

import { isSecretRequestTool } from "../secretRequest/toolName";

export type NotificationActionId = "approve" | "deny";

export interface RemoteNotificationAction {
  id: NotificationActionId;
  title: string;
}

/**
 * Quick actions for a permission prompt. `AskUserQuestion` is deliberately
 * excluded — picking an option is not a yes/no, so it has to be answered in
 * the app rather than from a notification button. A secret needs typing.
 */
export function permissionActions(
  toolName: string,
): RemoteNotificationAction[] {
  if (toolName === "AskUserQuestion" || isSecretRequestTool(toolName)) {
    return [];
  }

  return [
    { id: "approve", title: "Approve" },
    { id: "deny", title: "Deny" },
  ];
}
