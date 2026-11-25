/**
 * Slack and automations: a channel message fires the automations whose Slack
 * trigger it matches, and a finished run's report goes to the channel the
 * automation names. Only members allowed to drive agents can fire one.
 */

import type { SlackApi } from "./api";
import type { SlackConfig } from "./store";
import type { Automation, AutomationRun } from "../automation/models";
import { warn } from "@argus/host/logger";
import {
  type SlackAutomationEvent,
  slackAutomationEvent,
  slackTriggerMatches,
} from "../automation/slackTrigger";
import { isAllowed } from "./access";
import { markdownToMrkdwn, truncateMrkdwn } from "./mrkdwn";

export interface ChannelMessage {
  teamId: string;
  channel: string;
  user: string;
  text: string;
  ts: string;
  threadTs: string | null;
}

/** Fire every enabled automation this message matches; returns their ids. */
export function fireSlackTriggers(opts: {
  message: ChannelMessage;
  config: SlackConfig;
  automations: Automation[];
  fire: (automationId: string, event: SlackAutomationEvent) => void;
  now: number;
}): string[] {
  const { message, config } = opts;
  if (!isAllowed(config, message.user)) {
    return [];
  }
  const fired: string[] = [];
  for (const automation of opts.automations) {
    const { trigger } = automation;
    if (
      !automation.enabled ||
      trigger.kind !== "slack" ||
      !slackTriggerMatches(trigger, message)
    ) {
      continue;
    }
    try {
      opts.fire(
        automation.id,
        slackAutomationEvent(trigger, message, opts.now),
      );
      fired.push(automation.id);
    } catch (e) {
      warn(`[slack] automation ${automation.id} didn't fire: ${String(e)}`);
    }
  }

  return fired;
}

export const REPORT_LIMIT = 3000;
/** A run that finished longer ago is old news, e.g. one marked read after a restart. */
const REPORT_FRESH_MS = 10 * 60_000;

/** The Slack message for a finished run, or null when it has nothing to say. */
export function reportMessage(
  automation: Pick<Automation, "id" | "name">,
  run: Pick<AutomationRun, "error" | "id" | "report_markdown" | "status">,
): string | null {
  const link = `argus://automations/${encodeURIComponent(automation.id)}/runs/${encodeURIComponent(run.id)}`;
  const title = `*${markdownToMrkdwn(automation.name)}*`;
  if (run.status === "failed") {
    return `${title} failed: ${markdownToMrkdwn(run.error ?? "no reason given")}\n<${link}|Open the run in Argus>`;
  }
  if (run.status !== "succeeded") {
    return null;
  }
  const body = run.report_markdown?.trim()
    ? truncateMrkdwn(markdownToMrkdwn(run.report_markdown), REPORT_LIMIT, link)
    : `Finished with nothing to report. <${link}|Open the run in Argus>`;

  return `${title}\n${body}`;
}

/** Posts each finished run once, to its automation's report channel. */
export class ReportPoster {
  private posted = new Set<string>();

  constructor(
    private readonly deps: {
      /** The workspace's bot; a null team (an older automation) means the first one connected. */
      api: (teamId: string | null) => Pick<SlackApi, "postMessage"> | null;
      automation: (id: string) => Automation | null;
      onPosted: (success: boolean) => void;
      now: () => number;
    },
  ) {}

  async runChanged(run: AutomationRun | null): Promise<void> {
    if (
      !run?.finished_at ||
      this.posted.has(run.id) ||
      this.deps.now() - run.finished_at > REPORT_FRESH_MS
    ) {
      return;
    }
    const automation = this.deps.automation(run.automation_id);
    const channel = automation?.report_slack_channel;
    const api = channel ? this.deps.api(channel.team_id ?? null) : null;
    if (!automation || !channel || !api) {
      return;
    }
    const text = reportMessage(automation, run);
    if (!text) {
      return;
    }
    this.posted.add(run.id);
    try {
      await api.postMessage({ channel: channel.id, text });
      this.deps.onPosted(true);
    } catch (e) {
      warn(`[slack] couldn't post an automation report: ${String(e)}`);
      this.deps.onPosted(false);
    }
  }
}
