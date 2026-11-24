/**
 * Where a Slack message goes. A thread already tied to an agent keeps going
 * there; otherwise the channel's project, then the default project, and when
 * neither applies (or the project is gone) the thread is asked to pick one.
 */

import type { SlackConfig } from "./store";
import type { SlackThread } from "./threads";

export type Route =
  | { kind: "ask"; projects: string[] }
  | { kind: "awaiting_pick"; thread: SlackThread }
  | { kind: "continue"; thread: SlackThread }
  | { kind: "start"; repoRoot: string };

export function routeMessage(opts: {
  config: SlackConfig;
  channel: string;
  isDm: boolean;
  thread: SlackThread | null;
  /** Every project the host knows, by repo root. */
  projects: string[];
}): Route {
  const { config, channel, isDm, thread, projects } = opts;
  if (thread?.sessionId) {
    return { kind: "continue", thread };
  }
  if (thread?.pending) {
    return { kind: "awaiting_pick", thread };
  }
  const known = new Set(projects);
  const mapped = isDm
    ? undefined
    : config.mappings.find((m) => m.channel_id === channel);
  if (mapped && known.has(mapped.repo_root)) {
    return { kind: "start", repoRoot: mapped.repo_root };
  }
  if (config.defaultProject && known.has(config.defaultProject)) {
    return { kind: "start", repoRoot: config.defaultProject };
  }
  if (projects.length === 1) {
    return { kind: "start", repoRoot: projects[0]! };
  }

  return { kind: "ask", projects };
}

/** Slack's `<@U123>` mention of the bot, and the blank around it, removed. */
export function stripBotMention(text: string, botUserId: string): string {
  return text
    .replace(new RegExp(`<@${botUserId}(\\|[^>]*)?>`, "g"), "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Slack's own escapes and link syntax, back to what the person typed. */
export function slackTextToPlain(text: string): string {
  return text
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .replace(/<@([A-Z0-9]+)(\|[^>]*)?>/g, "@$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
