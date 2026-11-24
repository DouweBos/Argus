/**
 * Socket Mode envelopes, narrowed to what the bot acts on. Messages from bots
 * (Argus's own included) and edits, joins and other subtypes are dropped here.
 */

import type { SlackFileRef } from "./threads";

export interface SlackEnvelope {
  type: string;
  payload?: unknown;
}

export interface SlackMessage {
  channel: string;
  user: string;
  text: string;
  ts: string;
  threadTs: string | null;
  isDm: boolean;
  files: SlackFileRef[];
}

export interface SlackAction {
  user: string;
  channel: string;
  messageTs: string;
  threadTs: string | null;
  actionId: string;
  value: string;
}

/** `channel_message`: a plain channel message, a thread reply or food for automations. */
export type ParsedEnvelope =
  | { type: "action"; action: SlackAction }
  | { type: "channel_message"; message: SlackMessage }
  | { type: "message"; kind: "dm" | "mention"; message: SlackMessage };

interface RawFile {
  url_private_download?: string;
  url_private?: string;
  mimetype?: string;
  name?: string;
}

interface RawEvent {
  type?: string;
  subtype?: string;
  bot_id?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  channel?: string;
  channel_type?: string;
  files?: RawFile[];
}

function files(raw: RawFile[] | undefined): SlackFileRef[] {
  return (raw ?? []).flatMap((f) => {
    const url = f.url_private_download ?? f.url_private;

    return url
      ? [{ url, mimetype: f.mimetype ?? "", name: f.name ?? "file" }]
      : [];
  });
}

function message(event: RawEvent, isDm: boolean): SlackMessage | null {
  if (!event.channel || !event.user || !event.ts) {
    return null;
  }

  return {
    channel: event.channel,
    user: event.user,
    text: event.text ?? "",
    ts: event.ts,
    threadTs: event.thread_ts ?? null,
    isDm,
    files: files(event.files),
  };
}

export function parseEnvelope(
  envelope: SlackEnvelope,
  botUserId: string,
): ParsedEnvelope | null {
  if (envelope.type === "events_api") {
    const event = (envelope.payload as { event?: RawEvent } | undefined)?.event;
    if (!event || event.bot_id || (botUserId && event.user === botUserId)) {
      return null;
    }
    if (event.subtype && event.subtype !== "file_share") {
      return null;
    }
    if (event.type === "app_mention") {
      const m = message(event, false);

      return m ? { type: "message", kind: "mention", message: m } : null;
    }
    if (event.type !== "message") {
      return null;
    }
    if (event.channel_type === "im") {
      const m = message(event, true);

      return m ? { type: "message", kind: "dm", message: m } : null;
    }
    // A mention also arrives as `app_mention`, which handles it.
    if (botUserId && event.text?.includes(`<@${botUserId}`)) {
      return null;
    }
    const m = message(event, false);

    return m ? { type: "channel_message", message: m } : null;
  }
  if (envelope.type === "interactive") {
    const p = envelope.payload as
      | {
          type?: string;
          user?: { id?: string };
          channel?: { id?: string };
          container?: { message_ts?: string; thread_ts?: string };
          message?: { ts?: string; thread_ts?: string };
          actions?: {
            action_id?: string;
            value?: string;
            selected_option?: { value?: string };
          }[];
        }
      | undefined;
    const action = p?.actions?.[0];
    const messageTs = p?.message?.ts ?? p?.container?.message_ts;
    if (
      p?.type !== "block_actions" ||
      !action?.action_id ||
      !p.user?.id ||
      !p.channel?.id ||
      !messageTs
    ) {
      return null;
    }

    return {
      type: "action",
      action: {
        user: p.user.id,
        channel: p.channel.id,
        messageTs,
        threadTs: p.message?.thread_ts ?? p.container?.thread_ts ?? null,
        actionId: action.action_id,
        value: action.value ?? action.selected_option?.value ?? "",
      },
    };
  }

  return null;
}
