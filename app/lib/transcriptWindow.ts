/**
 * A viewer's slice of an agent's conversation: the messages loaded so far
 * (the newest, plus whatever older pages were scrolled into), kept current by
 * the host's deltas. Pure — the conversation store calls these.
 */

import type {
  AgentConversation,
  ConversationMessage,
} from "@argus/host/services/agent/conversation/types";
import type {
  AgentConversationMeta,
  AgentTranscriptDelta,
  AgentTranscriptPage,
} from "@argus/remote-protocol";
import { applyMetaPatch } from "@argus/host/services/agent/conversation/delta";

/** What the host knows that a slice of the history can't say on its own. */
export type ViewedConversation = AgentConversation &
  Pick<AgentConversationMeta, "firstUserText" | "runningSubagents">;

/** Where the loaded messages sit in the host's history. */
export interface TranscriptWindow {
  epoch: string;
  revision: number;
  /** Raw index of `messages[0]`. */
  start: number;
  /** Messages in the whole history. */
  total: number;
}

export interface Viewed {
  conversation: ViewedConversation;
  window: TranscriptWindow;
}

export type DeltaOutcome =
  | { appended: ConversationMessage[]; kind: "applied"; viewed: Viewed }
  | { kind: "gap" }
  | { kind: "stale" };

export function fromPage(page: AgentTranscriptPage): Viewed {
  return {
    conversation: { ...page.meta, messages: page.messages },
    window: {
      epoch: page.epoch,
      revision: page.revision,
      start: page.start,
      total: page.total,
    },
  };
}

/**
 * Put an older page in front of what is loaded. Null when it doesn't line up
 * (a delta moved things meanwhile) — the caller refetches.
 */
export function prependPage(
  viewed: Viewed,
  page: AgentTranscriptPage,
): Viewed | null {
  const { window } = viewed;
  if (
    page.epoch !== window.epoch ||
    page.start + page.messages.length !== window.start
  ) {
    return null;
  }

  return {
    conversation: {
      ...viewed.conversation,
      messages: [...page.messages, ...viewed.conversation.messages],
    },
    window: { ...window, start: page.start },
  };
}

/** Drop all but the newest `keep` loaded messages. */
export function trimWindow(viewed: Viewed, keep: number): Viewed {
  const { messages } = viewed.conversation;
  if (messages.length <= keep) {
    return viewed;
  }
  const dropped = messages.length - keep;

  return {
    conversation: { ...viewed.conversation, messages: messages.slice(dropped) },
    window: { ...viewed.window, start: viewed.window.start + dropped },
  };
}

export function applyDelta(
  viewed: Viewed,
  delta: AgentTranscriptDelta,
): DeltaOutcome {
  const { window } = viewed;
  if (delta.epoch !== window.epoch) {
    return { kind: "gap" };
  }
  if (delta.revision <= window.revision) {
    return { kind: "stale" };
  }
  if (delta.revision !== window.revision + 1) {
    return { kind: "gap" };
  }
  let start = window.start;
  let messages = viewed.conversation.messages;
  let copied = false;
  const writable = (): ConversationMessage[] => {
    if (!copied) {
      messages = messages.slice();
      copied = true;
    }

    return messages;
  };
  const appended: ConversationMessage[] = [];
  for (const op of delta.ops) {
    const local = op.index - start;
    if (op.op === "remove") {
      if (local < 0) {
        // Everything loaded is gone; the window starts at the cut.
        messages = [];
        copied = true;
        start = op.index;
      } else if (local < messages.length) {
        writable().length = local;
      }
      continue;
    }
    if (op.op === "update") {
      if (local >= messages.length) {
        return { kind: "gap" };
      }
      if (local >= 0) {
        writable()[local] = op.message;
      }
      continue;
    }
    if (local !== messages.length) {
      return { kind: "gap" };
    }
    writable().push(op.message);
    appended.push(op.message);
  }
  const meta = delta.meta
    ? applyMetaPatch<ViewedConversation>(viewed.conversation, delta.meta)
    : viewed.conversation;

  return {
    kind: "applied",
    appended,
    viewed: {
      conversation: { ...meta, messages },
      window: {
        epoch: window.epoch,
        revision: delta.revision,
        start: Math.min(start, delta.total),
        total: delta.total,
      },
    },
  };
}
