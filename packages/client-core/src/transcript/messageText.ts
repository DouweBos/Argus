/**
 * What a message shows, copies, edits from and resends. The TS twin of
 * ArgusCore's `MessageText.swift`.
 */

import type { RemoteMessage } from "@argus/remote-protocol";
import { parseLinkedProjectsPreamble } from "../linkedProjects";

/** A message the client added before the host confirmed it. */
export function isOptimisticMessage(id: string): boolean {
  return id.startsWith("optimistic-");
}

/** The bubble's blocks: the user's own words without the linked-projects preamble, no blank blocks. */
export function displayBlocks(message: RemoteMessage): string[] {
  if (message.role === "user") {
    const linked = parseLinkedProjectsPreamble(message.text_blocks.join("\n"));
    if (linked) {
      return linked.rest.length === 0 ? [] : [linked.rest];
    }
  }

  return message.text_blocks.filter((t) => t.trim().length > 0);
}

/** What Copy puts on the clipboard: the shown blocks a blank line apart; null when there's no text. */
export function copyText(message: RemoteMessage): string | null {
  const text = displayBlocks(message)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .join("\n\n");

  return text.length > 0 ? text : null;
}

/** What an edit starts from: the shown text, preamble off. */
export function editableText(message: RemoteMessage): string {
  return displayBlocks(message).join("\n\n");
}

/** An edit as it is sent: the linked-projects preamble goes back on as it came off. */
export function resendText(message: RemoteMessage, edited: string): string {
  const joined = message.text_blocks.join("\n");
  const linked =
    message.role === "user" ? parseLinkedProjectsPreamble(joined) : null;
  if (!linked) {
    return edited;
  }

  return joined.slice(0, joined.length - linked.rest.length) + edited;
}

/** Which actions a message's menu offers: copy with text; edit (yours) and fork while the chat is live. */
export interface MessageMenuOptions {
  copy: boolean;
  edit: boolean;
  fork: boolean;
}

export function messageMenuOptions(
  message: RemoteMessage,
  canChange: boolean,
): MessageMenuOptions {
  if (isOptimisticMessage(message.id)) {
    return { copy: false, edit: false, fork: false };
  }

  return {
    copy: copyText(message) !== null,
    edit: canChange && message.role === "user",
    fork: canChange,
  };
}
