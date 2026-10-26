/**
 * Read one Claude Code session transcript (`~/.claude/projects/<slug>/<id>.jsonl`)
 * into the text of its conversation: no tool calls, no sidechains.
 */

import fs from "node:fs";
import readline from "node:readline";

export interface CliSessionMessage {
  role: "assistant" | "user";
  text: string;
  at: number;
}

export interface CliSession {
  sessionId: string;
  cwd: string | null;
  title: string;
  gitBranch: string;
  model: string | null;
  /** Another Argus wrote it: its agents carry Argus's own MCP tools. */
  ranInArgus: boolean;
  /** One SDK/print-mode prompt, one reply, no tools: a scripted `claude -p` call, not a chat. */
  oneShotPrint: boolean;
  messages: CliSessionMessage[];
  firstAt: number | null;
  lastAt: number | null;
}

/** Messages kept per chat; the first user message always stays. */
export const MAX_IMPORTED_MESSAGES = 200;
const TITLE_MAX = 100;
const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** CLI bookkeeping that reaches the transcript as user text. */
const NOISE =
  /^\s*<(?:command-name|command-message|command-args|local-command-stdout|local-command-caveat|system-reminder|bash-input|bash-stdout|bash-stderr)>/;

export function isCliSessionId(id: string): boolean {
  return SESSION_ID.test(id);
}

function textOf(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter(
      (b): b is { type: string; text: string } =>
        typeof b === "object" &&
        b !== null &&
        (b as { type?: unknown }).type === "text" &&
        typeof (b as { text?: unknown }).text === "string",
    )
    .map((b) => b.text)
    .join("\n\n");
}

function hasToolUse(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some(
      (b) =>
        typeof b === "object" &&
        b !== null &&
        (b as { type?: unknown }).type === "tool_use",
    )
  );
}

/** Sent by a program (`claude -p`, the SDK) rather than typed in the CLI. */
function isSdkPrompt(rec: Record<string, unknown>): boolean {
  return (
    rec.promptSource === "sdk" ||
    (typeof rec.entrypoint === "string" && rec.entrypoint.startsWith("sdk"))
  );
}

function titleFrom(text: string): string {
  const first = text.trim().split("\n")[0]?.trim() ?? "";

  return first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX - 1)}…` : first;
}

/** Keep the last `max` messages, plus the opening user message. */
export function trimMessages(
  messages: CliSessionMessage[],
  max = MAX_IMPORTED_MESSAGES,
): CliSessionMessage[] {
  if (messages.length <= max) {
    return messages;
  }
  const firstUser = messages.find((m) => m.role === "user");
  const tail = messages.slice(-max + (firstUser ? 1 : 0));

  return firstUser && !tail.includes(firstUser) ? [firstUser, ...tail] : tail;
}

export async function readCliSession(
  file: string,
  fallbackId: string,
): Promise<CliSession> {
  const session: CliSession = {
    sessionId: fallbackId,
    cwd: null,
    title: "",
    gitBranch: "",
    model: null,
    ranInArgus: false,
    oneShotPrint: false,
    messages: [],
    firstAt: null,
    lastAt: null,
  };
  let customTitle: string | null = null;
  let aiTitle: string | null = null;
  let userTurns = 0;
  let allSdkPrompts = true;
  let usedTools = false;
  const lines = readline.createInterface({
    input: fs.createReadStream(file, "utf8"),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!session.ranInArgus && line.includes('"mcp__argus__')) {
      session.ranInArgus = true;
    }
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof rec.customTitle === "string") {
      customTitle = rec.customTitle || null;
    }
    if (typeof rec.aiTitle === "string") {
      aiTitle = rec.aiTitle || null;
    }
    if (
      rec.isSidechain === true ||
      rec.isMeta === true ||
      rec.isCompactSummary === true
    ) {
      continue;
    }
    if (rec.type !== "user" && rec.type !== "assistant") {
      continue;
    }
    if (typeof rec.sessionId === "string" && rec.sessionId) {
      session.sessionId = rec.sessionId;
    }
    if (typeof rec.cwd === "string" && !session.cwd) {
      session.cwd = rec.cwd;
    }
    if (typeof rec.gitBranch === "string" && rec.gitBranch) {
      session.gitBranch = rec.gitBranch;
    }
    const message = rec.message as
      | { content?: unknown; model?: unknown }
      | undefined;
    if (
      rec.type === "assistant" &&
      typeof message?.model === "string" &&
      message.model !== "<synthetic>"
    ) {
      session.model = message.model;
    }
    if (rec.type === "assistant" && hasToolUse(message?.content)) {
      usedTools = true;
    }
    const text = textOf(message?.content).trim();
    if (!text || NOISE.test(text)) {
      continue;
    }
    const at =
      typeof rec.timestamp === "string" ? Date.parse(rec.timestamp) : NaN;
    const stamp = Number.isFinite(at) ? at : (session.lastAt ?? 0);
    session.firstAt ??= stamp;
    session.lastAt = stamp;
    const role = rec.type;
    if (role === "user") {
      userTurns += 1;
      allSdkPrompts &&= isSdkPrompt(rec);
    }
    const last = session.messages.at(-1);
    // The CLI writes one assistant record per content block.
    if (last && last.role === "assistant" && role === "assistant") {
      last.text = `${last.text}\n\n${text}`;
      last.at = stamp;
    } else {
      session.messages.push({ role, text, at: stamp });
    }
  }
  const firstUser = session.messages.find((m) => m.role === "user");
  session.title =
    customTitle ??
    aiTitle ??
    (firstUser ? titleFrom(firstUser.text) : "") ??
    "";
  if (!session.title) {
    session.title = "Imported chat";
  }
  session.oneShotPrint = userTurns === 1 && allSdkPrompts && !usedTools;
  session.messages = trimMessages(session.messages);

  return session;
}
