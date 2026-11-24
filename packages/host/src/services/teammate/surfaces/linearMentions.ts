/**
 * Teammates you @-mention in your own Linear comments. Polled, since Argus
 * runs no public endpoint: every couple of minutes the host reads the
 * comments you wrote since the last look, and a comment naming `@handle`
 * goes to that teammate — one conversation per comment thread — whose
 * answer is posted back as a reply.
 *
 * Only your own comments count: anyone else's text never instructs a
 * teammate.
 */

import type { LinearComment } from "../../integrations/linear/client";
import fs from "node:fs";
import path from "node:path";
import { info, warn } from "@argus/host/logger";
import { argusHomeDir } from "../../../lib/argusHome";
import { writeJson } from "../../automation/jsonFile";
import { capture as telemetryCapture } from "../../telemetry/telemetry";
import { teammateCache } from "../registry";
import { teammatesActive } from "../settings";

export const POLL_MS = 2 * 60_000;
/** On first look, only this far back — never the whole history. */
const FIRST_LOOK_MS = 10 * 60_000;
/** Ends every reply, so a reply never triggers another. */
export const REPLY_SIGNATURE = "via Argus";

interface State {
  since: number;
  /** `issueId:rootCommentId` → the teammate thread answering it. */
  threads: Record<string, { teammateId: string; threadId: string }>;
}

export interface LinearMentionDeps {
  comments: (sinceIso: string) => Promise<LinearComment[] | null>;
  reply: (issueId: string, parentId: string, body: string) => Promise<void>;
  /** Open (or create) the thread and ask; resolves with the final answer. */
  ask: (
    teammateId: string,
    threadId: string | null,
    prompt: string,
  ) => Promise<{ threadId: string; answer: string | null }>;
  now: () => number;
}

function statePath(): string {
  return path.join(argusHomeDir(), "teammate-linear-mentions.json");
}

function loadState(now: number): State {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), "utf8")) as State;
    if (typeof parsed.since === "number" && parsed.threads) {
      return parsed;
    }
  } catch {
    // First look.
  }

  return { since: now - FIRST_LOOK_MS, threads: {} };
}

/** `@handle` anywhere in the comment, for a teammate that exists. */
export function mentionedTeammate(
  body: string,
): { id: string; name: string } | null {
  for (const match of body.matchAll(/(?:^|\s)@([a-z0-9][a-z0-9-]{0,31})\b/g)) {
    const teammate = teammateCache().find((t) => t.handle === match[1]);
    if (teammate) {
      return { id: teammate.id, name: teammate.name };
    }
  }

  return null;
}

export function buildMentionPrompt(comment: LinearComment): string {
  return [
    `You were mentioned in a Linear comment on ${comment.issue.identifier} "${comment.issue.title}" (${comment.issue.url}).`,
    "",
    comment.body.trim(),
    "",
    "Answer it. Your final message is posted back as a reply on that comment, so write it for the people reading the issue: short, in Markdown, no preamble.",
  ].join("\n");
}

let running = false;

/** One look. Exported for tests; the interval calls it. */
export async function pollLinearMentions(
  deps: LinearMentionDeps,
): Promise<void> {
  if (running || !teammatesActive() || teammateCache().length === 0) {
    return;
  }
  running = true;
  try {
    const state = loadState(deps.now());
    const comments = await deps.comments(new Date(state.since).toISOString());
    if (!comments) {
      return;
    }
    for (const comment of comments) {
      state.since = Math.max(state.since, comment.createdAt);
      if (comment.body.trim().endsWith(REPLY_SIGNATURE)) {
        continue;
      }
      const teammate = mentionedTeammate(comment.body);
      if (!teammate) {
        continue;
      }
      const root = comment.parentId ?? comment.id;
      const key = `${comment.issue.id}:${root}`;
      const known = state.threads[key];
      try {
        const { threadId, answer } = await deps.ask(
          teammate.id,
          known?.teammateId === teammate.id ? known.threadId : null,
          buildMentionPrompt(comment),
        );
        state.threads[key] = { teammateId: teammate.id, threadId };
        if (answer?.trim()) {
          await deps.reply(
            comment.issue.id,
            root,
            `**${teammate.name}:** ${answer.trim()}\n\n— ${teammate.name}, ${REPLY_SIGNATURE}`,
          );
        }
        telemetryCapture("teammate_mention_answered", {
          surface: "linear",
          answered: Boolean(answer?.trim()),
        });
      } catch (e) {
        warn(`teammate ${teammate.id}: Linear mention failed: ${String(e)}`);
      }
    }
    writeJson(statePath(), state);
  } catch (e) {
    warn(`teammates: Linear mentions: ${String(e)}`);
  } finally {
    running = false;
  }
}

/** Real wiring: the connected Linear account and a teammate's thread. */
export function hostLinearMentionDeps(): LinearMentionDeps {
  return {
    comments: async (since) => {
      const { freshLinearApi } = await import("../../integrations/service");
      const api = await freshLinearApi();

      return api ? await api.myRecentComments(since) : null;
    },
    reply: async (issueId, parentId, body) => {
      const { commentOnLinearIssueById } =
        await import("../../integrations/service");
      await commentOnLinearIssueById(issueId, body, parentId);
    },
    ask: async (teammateId, threadId, prompt) => {
      const { askTeammate } = await import("../threads");
      const asked = await askTeammate(teammateId, {
        threadId,
        surface: "linear",
        text: prompt,
        author: "Linear",
      });

      return { threadId: asked.threadId, answer: asked.answer };
    },
    now: () => Date.now(),
  };
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startLinearMentions(): void {
  if (timer) {
    return;
  }
  timer = setInterval(() => {
    pollLinearMentions(hostLinearMentionDeps()).catch(() => undefined);
  }, POLL_MS);
  timer.unref?.();
  info("teammates: watching Linear for mentions");
}

export function stopLinearMentions(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
