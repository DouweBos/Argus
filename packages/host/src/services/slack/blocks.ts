/**
 * The Block Kit messages Argus posts in a thread. Kept pure so the wording and
 * the action ids live in one place the tests can read.
 */

import type { SlackBlock } from "./api";
import type { TeammateThreadFailure } from "../teammate/failure";
import { createHash } from "node:crypto";
import path from "node:path";
import { escapeText } from "./mrkdwn";
import { ACTIVITY_LABEL, type Activity } from "./progress";

export const ACTION_PICK_PROJECT = "argus_pick_project";
export const ACTION_ALLOW = "argus_permission_allow";
export const ACTION_DENY = "argus_permission_deny";
export const ACTION_RESUME = "argus_resume_thread";

export interface SessionLinks {
  app: string;
  web: string | null;
}

function linkLine(links: SessionLinks): string {
  const parts = [`<${links.app}|Open in Argus>`];
  if (links.web) {
    parts.push(`<${links.web}|Open in the browser>`);
  }

  return parts.join("  ·  ");
}

export function projectName(repoRoot: string): string {
  return path.basename(repoRoot) || repoRoot;
}

/** A project's button value: a short hash, so no path goes back to Slack. */
export function projectToken(repoRoot: string): string {
  return createHash("sha256").update(repoRoot).digest("hex").slice(0, 16);
}

export function statusMessage(opts: {
  activity: Activity;
  project: string;
  links: SessionLinks | null;
}): { text: string; blocks: SlackBlock[] } {
  const label = ACTIVITY_LABEL[opts.activity];
  const finished = ["done", "failed", "stopped"].includes(opts.activity);
  const headline = finished ? label : `Working on it: ${label.toLowerCase()}`;
  const context = [`*${escapeText(opts.project)}*`];
  if (opts.links) {
    context.push(linkLine(opts.links));
  }

  return {
    text: headline,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*${headline}*` } },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: context.join("  ·  ") }],
      },
    ],
  };
}

export function projectPicker(projects: string[]): {
  text: string;
  blocks: SlackBlock[];
} {
  const text = "Which project should I work in?";
  const sorted = [...projects].sort((a, b) =>
    projectName(a).localeCompare(projectName(b)),
  );
  const element =
    sorted.length <= 5
      ? sorted.map((root) => ({
          type: "button",
          action_id: `${ACTION_PICK_PROJECT}:${projectToken(root)}`,
          text: { type: "plain_text", text: projectName(root).slice(0, 75) },
          value: projectToken(root),
        }))
      : [
          {
            type: "static_select",
            action_id: ACTION_PICK_PROJECT,
            placeholder: { type: "plain_text", text: "Pick a project" },
            options: sorted.slice(0, 100).map((root) => ({
              text: {
                type: "plain_text",
                text: projectName(root).slice(0, 75),
              },
              value: projectToken(root),
            })),
          },
        ];

  return {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text } },
      { type: "actions", elements: element },
    ],
  };
}

export function pickedProject(repoRoot: string): {
  text: string;
  blocks: SlackBlock[];
} {
  const text = `Working in *${escapeText(projectName(repoRoot))}*.`;

  return {
    text,
    blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
  };
}

/** What a tool call wants to do, in one short line or code block. */
export function describeToolInput(
  toolName: string,
  input: Record<string, unknown>,
): string {
  const str = (key: string): string | null =>
    typeof input[key] === "string" ? (input[key] as string) : null;
  const code = (value: string): string =>
    `\`\`\`${escapeText(value.length > 1200 ? `${value.slice(0, 1200)}…` : value)}\`\`\``;
  const command = str("command");
  if (command) {
    return code(command);
  }
  const file = str("file_path") ?? str("notebook_path") ?? str("path");
  if (file) {
    return `\`${escapeText(path.basename(file))}\``;
  }
  const url = str("url") ?? str("query");
  if (url) {
    return escapeText(url.slice(0, 300));
  }
  const plan = toolName === "ExitPlanMode" ? str("plan") : null;
  if (plan) {
    return escapeText(plan.slice(0, 1500));
  }

  return "";
}

export interface PermissionRef {
  agentId: string;
  toolUseId: string;
}

export function permissionPrompt(opts: {
  ref: PermissionRef;
  toolName: string;
  toolInput: Record<string, unknown>;
  /** False for prompts a yes/no can't answer (a question, a secret). */
  answerable: boolean;
  links: SessionLinks | null;
}): { text: string; blocks: SlackBlock[] } {
  const text = opts.answerable
    ? `The agent wants to use ${opts.toolName}.`
    : "The agent needs you in Argus.";
  const detail = describeToolInput(opts.toolName, opts.toolInput);
  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${opts.answerable ? "Approval needed" : "The agent needs you"}*: \`${escapeText(opts.toolName)}\`${detail ? `\n${detail}` : ""}`,
      },
    },
  ];
  if (opts.answerable) {
    const value = JSON.stringify({
      a: opts.ref.agentId,
      t: opts.ref.toolUseId,
    });
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: ACTION_ALLOW,
          style: "primary",
          text: { type: "plain_text", text: "Approve" },
          value,
        },
        {
          type: "button",
          action_id: ACTION_DENY,
          style: "danger",
          text: { type: "plain_text", text: "Deny" },
          value,
        },
      ],
    });
  } else if (opts.links) {
    blocks.push({
      type: "context",
      elements: [
        { type: "mrkdwn", text: `Answer it in Argus. ${linkLine(opts.links)}` },
      ],
    });
  }

  return { text, blocks };
}

export function permissionAnswered(opts: {
  toolName: string;
  decision: "allow" | "deny";
  /** The Slack member who answered; null when it was answered elsewhere. */
  by: string | null;
}): { text: string; blocks: SlackBlock[] } {
  const verb = opts.decision === "allow" ? "Approved" : "Denied";
  const who = opts.by ? ` by <@${opts.by}>` : " in Argus";
  const text = `${verb}${who}: \`${escapeText(opts.toolName)}\``;

  return {
    text,
    blocks: [{ type: "context", elements: [{ type: "mrkdwn", text }] }],
  };
}

/** A turn that stopped short: why, and a Resume button when it can resume. */
export function failureMessage(opts: {
  failure: Pick<TeammateThreadFailure, "reason" | "resets_at">;
  /** The teammate speaking, when it is one. */
  speaker: string | null;
  resumable: boolean;
  links: SessionLinks | null;
}): { text: string; blocks: SlackBlock[] } {
  const line = failureLine(opts.failure);
  const text = opts.speaker ? `*${escapeText(opts.speaker)}:* ${line}` : line;
  const blocks: SlackBlock[] = [
    { type: "section", text: { type: "mrkdwn", text } },
  ];
  if (opts.resumable) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: ACTION_RESUME,
          style: "primary",
          text: { type: "plain_text", text: "Resume" },
          value: JSON.stringify({ r: line.slice(0, 1500) }),
        },
      ],
    });
  }
  if (opts.links) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: linkLine(opts.links) }],
    });
  }

  return { text, blocks };
}

function failureLine(
  failure: Pick<TeammateThreadFailure, "reason" | "resets_at">,
): string {
  const reason = `Stopped: ${escapeText(failure.reason)}`;
  if (failure.resets_at === null) {
    return reason;
  }
  const seconds = Math.floor(failure.resets_at / 1000);
  const fallback = new Date(failure.resets_at).toISOString();

  return `${reason} It resets <!date^${seconds}^{date_short_pretty} at {time}|${fallback}>.`;
}

/** The failure message once someone pressed Resume on it. */
export function resumedMessage(opts: { line: string; by: string }): {
  text: string;
  blocks: SlackBlock[];
} {
  return {
    text: opts.line,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: opts.line } },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `Resumed by <@${opts.by}>` }],
      },
    ],
  };
}

export function parseResumeValue(value: string): string {
  try {
    const parsed = JSON.parse(value) as { r?: unknown };
    if (typeof parsed.r === "string") {
      return parsed.r;
    }
  } catch {
    // Not ours.
  }

  return "Stopped.";
}

export function parsePermissionValue(value: string): PermissionRef | null {
  try {
    const parsed = JSON.parse(value) as { a?: unknown; t?: unknown };
    if (typeof parsed.a === "string" && typeof parsed.t === "string") {
      return { agentId: parsed.a, toolUseId: parsed.t };
    }
  } catch {
    // Not ours.
  }

  return null;
}
