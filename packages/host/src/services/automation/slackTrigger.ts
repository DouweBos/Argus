/**
 * The Slack message trigger: which messages match, and the event a match
 * hands the automation. Event-driven like the signal and webhook triggers
 * (`fire` + `max_runs_per_hour`), so the event dispatcher queues and caps it.
 */

import type { AutomationTrigger } from "./models";
import type {
  SlackChannelRef,
  SlackTriggerMatch,
} from "@argus/remote-protocol";

export type SlackTrigger = Extract<AutomationTrigger, { kind: "slack" }>;

export const DEFAULT_SLACK_RUNS_PER_HOUR = 4;
export const MAX_SLACK_RUNS_PER_HOUR = 60;

export function slackTrigger(input: {
  channel: SlackChannelRef;
  match: SlackTriggerMatch;
  text: string;
  fire?: "batch" | "each";
  max_runs_per_hour?: number;
}): SlackTrigger {
  const trigger: SlackTrigger = {
    kind: "slack",
    channel: input.channel,
    match: input.match,
    text: input.match === "any" ? "" : input.text.trim(),
    fire: input.fire ?? "each",
    max_runs_per_hour: input.max_runs_per_hour ?? DEFAULT_SLACK_RUNS_PER_HOUR,
  };
  assertValidSlackTrigger(trigger);

  return trigger;
}

export function assertValidSlackTrigger(trigger: SlackTrigger): void {
  if (!trigger.channel.id) {
    throw "A Slack trigger needs a channel.";
  }
  if (trigger.match !== "any" && !trigger.text.trim()) {
    throw "Give the Slack trigger a keyword or prefix, or let any message fire it.";
  }
  const cap = trigger.max_runs_per_hour;
  if (!Number.isInteger(cap) || cap < 1 || cap > MAX_SLACK_RUNS_PER_HOUR) {
    throw `Runs per hour must be a whole number from 1 to ${MAX_SLACK_RUNS_PER_HOUR}.`;
  }
}

export function slackTriggerMatches(
  trigger: SlackTrigger,
  message: { channel: string; text: string; teamId?: string },
): boolean {
  if (message.channel !== trigger.channel.id) {
    return false;
  }
  // Older triggers name no workspace: any workspace's channel with that ID.
  const team = trigger.channel.team_id;
  if (team && message.teamId && team !== message.teamId) {
    return false;
  }
  const text = message.text.trim().toLowerCase();
  const wanted = trigger.text.trim().toLowerCase();
  switch (trigger.match) {
    case "any":
      return text.length > 0;
    case "prefix":
      return text.startsWith(wanted);
    case "keyword":
      return new RegExp(`(^|\\W)${escapeRegExp(wanted)}(\\W|$)`).test(text);
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Mirrors the event dispatcher's `AutomationEvent`. */
export interface SlackAutomationEvent {
  origin: "slack";
  kind: "slack_message";
  summary: string;
  items: [];
  payload: {
    channel: string;
    text: string;
    ts: string;
    thread_ts: string | null;
  };
  received_at: number;
}

export function slackAutomationEvent(
  trigger: SlackTrigger,
  message: { text: string; ts: string; threadTs: string | null },
  now: number,
): SlackAutomationEvent {
  return {
    origin: "slack",
    kind: "slack_message",
    summary: `slack #${trigger.channel.name}`,
    items: [],
    payload: {
      channel: trigger.channel.name,
      text: message.text,
      ts: message.ts,
      thread_ts: message.threadTs,
    },
    received_at: now,
  };
}
