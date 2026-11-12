/**
 * Drafts a commit message for a session's changes with a one-shot Claude call,
 * from the diff, the session's chat and the configured message style.
 */

import { appState } from "../../state";
import { liveConversation } from "../agent/conversation/live";
import { runClaudePrint } from "../llm/runners/claudeCode/oneShot";
import { capture } from "../telemetry/telemetry";
import { resolveMessageStyle } from "./messageStyle";
import {
  getSessionFullDiff,
  getSessionStagedDiff,
  getSessionUntrackedDiff,
} from "./sessionOps";

const MAX_DIFF_CHARS = 60_000;
const MAX_CHAT_CHARS = 12_000;
const MAX_CHAT_MESSAGE_CHARS = 2_000;

/** Opening of the prompt, for the CLI chat importer to recognise. */
export const COMMIT_MESSAGE_PROMPT =
  "Write the git commit message for the changes below.";

const SYSTEM_PROMPT =
  "You write accurate git commit messages. Output only the message: a subject line, then optionally a blank line and a body. No code fences, quotes or commentary.";

export interface CommitDraft {
  subject: string;
  body: string;
}

/**
 * `allChanges` drafts from everything uncommitted (a phone commits it all);
 * otherwise only the staged changes count. Throws a string on failure.
 */
export async function draftCommitMessage(
  sessionId: string,
  allChanges: boolean,
): Promise<CommitDraft> {
  const ws = appState.sessions.get(sessionId);
  if (!ws) {
    throw `Session not found: ${sessionId}`;
  }

  const diff = allChanges
    ? (await getSessionFullDiff(sessionId).catch(() => "")) +
      (await getSessionUntrackedDiff(sessionId))
    : await getSessionStagedDiff(sessionId);
  if (!diff.trim()) {
    throw allChanges ? "There are no changes to commit" : "Stage changes first";
  }

  const style = await resolveMessageStyle(ws.path);
  const chat = sessionChat(sessionId);
  const truncated = diff.length > MAX_DIFF_CHARS;
  const sections = [COMMIT_MESSAGE_PROMPT, style.guidance];
  const task = ws.description?.trim();
  if (task) {
    sections.push(`---\nThe session's task:\n\n${task}`);
  }
  if (chat) {
    sections.push(
      `---\nThe session's chat, for why the change was made:\n\n${chat}`,
    );
  }
  sections.push(
    `---\nDiff${truncated ? " (truncated)" : ""}:\n\n${diff.slice(0, MAX_DIFF_CHARS)}`,
  );

  const started = Date.now();
  const result = await runClaudePrint({
    prompt: sections.join("\n\n"),
    source: "commit-message",
    cwd: ws.path,
    timeoutMs: 120_000,
    systemPrompt: SYSTEM_PROMPT,
    model: "sonnet",
    quiet: true,
  });
  const draft = result ? parseCommitMessage(result) : null;
  capture("commit_message_drafted", {
    style: style.mode,
    scope: allChanges ? "all" : "staged",
    has_chat: chat.length > 0,
    duration_bucket: durationBucket(Date.now() - started),
    success: draft !== null,
  });
  if (!draft) {
    throw "Claude couldn't draft a commit message. Check that `claude` is installed and signed in on the computer.";
  }

  return draft;
}

/** Splits the reply into subject and body, dropping a stray outer fence. */
export function parseCommitMessage(raw: string): CommitDraft | null {
  const unfenced = raw
    .trim()
    .replace(/^```[\w-]*\n([\s\S]*?)\n```$/, "$1")
    .trim();
  const [first = "", ...rest] = unfenced.split("\n");
  const subject = first.trim();
  if (!subject) {
    return null;
  }

  return { subject, body: rest.join("\n").trim() };
}

/** The user's and agents' words from the session's live chats, newest kept. */
function sessionChat(sessionId: string): string {
  const lines: string[] = [];
  for (const agent of appState.agents.values()) {
    if (agent.sessionId !== sessionId || agent.parentAgentId) {
      continue;
    }
    for (const message of liveConversation(agent.agentId)?.messages ?? []) {
      if (message.role === "system") {
        continue;
      }
      const text = message.textBlocks.join("\n").trim();
      if (text) {
        lines.push(
          `${message.role === "user" ? "User" : "Agent"}: ${text.slice(0, MAX_CHAT_MESSAGE_CHARS)}`,
        );
      }
    }
  }
  const chat = lines.join("\n\n");

  return chat.length > MAX_CHAT_CHARS ? chat.slice(-MAX_CHAT_CHARS) : chat;
}

function durationBucket(ms: number): "<10s" | "10-30s" | "30-90s" | "90s+" {
  if (ms < 10_000) {
    return "<10s";
  }
  if (ms < 30_000) {
    return "10-30s";
  }

  return ms < 90_000 ? "30-90s" : "90s+";
}
