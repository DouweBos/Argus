/**
 * What a chat continued on another runner starts from: the original request,
 * the last todo list, files touched, command outcomes and as many recent turns
 * as the token budget leaves room for. {@link buildHistorySeed} is the same
 * digest for a chat rewound, forked or asked about on a runner that can't fork
 * its own transcript.
 */

import type {
  AgentConversation,
  ConversationMessage,
  ToolCallInfo,
} from "../conversation/types";

/** Agents that can call `read_agent_transcript` get a lean seed and page the rest. */
export const MCP_SEED_TOKENS = 8_000;
/** Agents that can't reach Argus's MCP (e.g. Cursor) only ever see the seed. */
export const INLINE_SEED_TOKENS = 30_000;

/** Rough enough for budgeting: English prose and code run ~4 chars a token. */
const CHARS_PER_TOKEN = 4;
const MAX_COMMANDS = 25;
const MAX_FILES = 60;
const COMMAND_CHARS = 240;
const OUTCOME_CHARS = 300;
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

export interface SeedInput {
  conversation: AgentConversation;
  fromAgentId: string;
  fromRunner: string;
  /** Whether the new agent can read the full transcript over MCP. */
  mcp: boolean;
}

export interface Seed {
  text: string;
  /** Older messages left out of "Recent turns". */
  omittedMessages: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) {
    return t;
  }

  return `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Keep a long output's end: that's where errors and summaries land. */
function clipTail(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) {
    return t;
  }

  return `…${t.slice(t.length - max + 1).trimStart()}`;
}

function resultText(result: ToolCallInfo["result"]): string {
  if (typeof result === "string") {
    return result;
  }

  return (result ?? [])
    .map((b) => (b.type === "text" ? b.text : "[image]"))
    .join("\n");
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function messageText(m: ConversationMessage): string {
  return m.textBlocks.join("\n\n").trim();
}

function allCalls(messages: ConversationMessage[]): ToolCallInfo[] {
  return messages.flatMap((m) => m.toolCalls);
}

function originalRequest(messages: ConversationMessage[]): string | null {
  const first = messages.find(
    (m) => m.role === "user" && messageText(m).length > 0,
  );

  return first ? messageText(first) : null;
}

function todoSection(conv: AgentConversation): string | null {
  const todos = conv.todos?.length
    ? conv.todos.map((t) => ({ status: t.status, text: t.content }))
    : Object.values(conv.tasks ?? {}).map((t) => ({
        status: t.status,
        text: t.subject,
      }));
  if (todos.length === 0) {
    return null;
  }
  const mark = { completed: "x", in_progress: "~", pending: " " } as const;

  return todos.map((t) => `- [${mark[t.status]}] ${t.text}`).join("\n");
}

function filesSection(calls: ToolCallInfo[]): string | null {
  const files = new Set<string>();
  for (const c of calls) {
    const path = str(c.input.file_path) || str(c.input.notebook_path);
    if (EDIT_TOOLS.has(c.name) && path && !c.isError) {
      files.add(path);
    }
  }
  if (files.size === 0) {
    return null;
  }
  const list = [...files].slice(-MAX_FILES);

  return list.map((f) => `- ${f}`).join("\n");
}

function commandStatus(c: ToolCallInfo): string {
  if (c.result === undefined) {
    return "no result";
  }

  return c.isError ? "failed" : "ok";
}

function commandsSection(calls: ToolCallInfo[]): string | null {
  const commands = calls.filter(
    (c) => c.name === "Bash" && str(c.input.command),
  );
  if (commands.length === 0) {
    return null;
  }

  return commands
    .slice(-MAX_COMMANDS)
    .map((c) => {
      const cmd = clip(
        str(c.input.command).replace(/\s+/g, " "),
        COMMAND_CHARS,
      );
      const out = clipTail(resultText(c.result), OUTCOME_CHARS);
      const status = commandStatus(c);

      return out
        ? `- \`${cmd}\` → ${status}\n  ${out.replace(/\n+/g, "\n  ")}`
        : `- \`${cmd}\` → ${status}`;
    })
    .join("\n");
}

function callSummary(c: ToolCallInfo): string {
  const target =
    str(c.input.command) ||
    str(c.input.file_path) ||
    str(c.input.pattern) ||
    str(c.input.url) ||
    str(c.input.query);
  const outcome = c.isError ? " (failed)" : "";

  return `[${c.name}${target ? `: ${clip(target.replace(/\s+/g, " "), 120)}` : ""}]${outcome}`;
}

function renderMessage(
  m: ConversationMessage,
  fromRunner: string,
  maxChars: number,
): string | null {
  if (m.role === "system") {
    return null;
  }
  const who = m.role === "user" ? "User" : fromRunner;
  const parts = [messageText(m), ...m.toolCalls.map(callSummary)].filter(
    Boolean,
  );
  if (parts.length === 0) {
    return null;
  }

  return `**${who}:** ${clip(parts.join("\n"), maxChars)}`;
}

/**
 * Newest turns that fit `budgetChars`, oldest first. A single message is
 * capped so one huge paste can't crowd out everything after it.
 */
function recentTurns(
  messages: ConversationMessage[],
  fromRunner: string,
  budgetChars: number,
): { text: string; omitted: number } {
  const perMessage = Math.max(600, Math.floor(budgetChars / 4));
  const picked: string[] = [];
  let used = 0;
  let i = messages.length - 1;
  for (; i >= 0; i--) {
    const rendered = renderMessage(messages[i]!, fromRunner, perMessage);
    if (!rendered) {
      continue;
    }
    if (used + rendered.length > budgetChars && picked.length > 0) {
      break;
    }
    picked.push(rendered);
    used += rendered.length + 2;
  }

  return { text: picked.reverse().join("\n\n"), omitted: i + 1 };
}

/**
 * The chat so far, for an agent that starts with none of it: a rewind or fork
 * on a runner with no transcript fork, or a side question. Inline only, since
 * the source transcript may hold turns past the point this one starts from.
 */
export function buildHistorySeed(
  messages: ConversationMessage[],
  runnerName: string,
  budgetTokens = INLINE_SEED_TOKENS,
): Seed {
  const budget = budgetTokens * CHARS_PER_TOKEN;
  const calls = allCalls(messages);
  const sections: string[] = [];
  const add = (title: string, body: string | null, maxChars: number) => {
    if (body) {
      sections.push(`## ${title}\n\n${clip(body, maxChars)}`);
    }
  };
  add("Original request", originalRequest(messages), budget * 0.2);
  add("Files changed", filesSection(calls), budget * 0.06);
  add("Commands run (oldest first)", commandsSection(calls), budget * 0.16);
  const spent = sections.reduce((n, s) => n + s.length + 2, 0);
  const turns = recentTurns(
    messages,
    runnerName,
    Math.max(budget - spent, budget * 0.2),
  );
  if (turns.text) {
    const note =
      turns.omitted > 0
        ? `_${turns.omitted} earlier message${turns.omitted === 1 ? "" : "s"} left out._\n\n`
        : "";
    sections.push(`## Turns\n\n${note}${turns.text}`);
  }

  return { text: sections.join("\n\n"), omittedMessages: turns.omitted };
}

/** A history seed ahead of the first message an agent gets after it. */
export function withHistorySeed(seed: string, message: string): string {
  return (
    "<conversation-so-far>\n" +
    "This conversation started before you joined it; this is what was said and done up to now. " +
    "Treat it as your own history, check the worktree before relying on it, and answer the message after it.\n\n" +
    `${seed}\n</conversation-so-far>\n\n${message}`
  );
}

export function buildHandoffSeed(input: SeedInput): Seed {
  const { conversation: conv, fromRunner, fromAgentId, mcp } = input;
  const budget = (mcp ? MCP_SEED_TOKENS : INLINE_SEED_TOKENS) * CHARS_PER_TOKEN;
  const calls = allCalls(conv.messages);

  const sections: string[] = [
    `You are taking over a chat that ${fromRunner} was working on in this same worktree. ` +
      "Carry on from where it stopped: don't redo finished work, and check the worktree (`git status`, `git diff`) before relying on anything below.",
  ];
  const add = (title: string, body: string | null, maxChars: number) => {
    if (body) {
      sections.push(`## ${title}\n\n${clip(body, maxChars)}`);
    }
  };
  add("Original request", originalRequest(conv.messages), budget * 0.2);
  add("Last todo list", todoSection(conv), budget * 0.08);
  add("Files changed", filesSection(calls), budget * 0.06);
  add("Commands run (oldest first)", commandsSection(calls), budget * 0.16);

  const footer = mcp
    ? `## Earlier messages\n\nThe full transcript is available through the Argus MCP tool \`read_agent_transcript\` with \`agent_id: "${fromAgentId}"\` (page with \`offset\` and \`limit\`). Tool outputs above are summarised; read it when you need the detail.`
    : null;
  const spent =
    sections.reduce((n, s) => n + s.length + 2, 0) + (footer?.length ?? 0);
  const turns = recentTurns(
    conv.messages,
    fromRunner,
    Math.max(budget - spent, budget * 0.2),
  );
  if (turns.text) {
    const note =
      turns.omitted > 0
        ? `_${turns.omitted} earlier message${turns.omitted === 1 ? "" : "s"} left out._\n\n`
        : "";
    sections.push(`## Recent turns\n\n${note}${turns.text}`);
  }
  if (footer) {
    sections.push(footer);
  }
  sections.push(
    "Continue the work now. If the last turn ended mid-task, finish it; if it was waiting on the user, say what you need.",
  );

  return { text: sections.join("\n\n"), omittedMessages: turns.omitted };
}
