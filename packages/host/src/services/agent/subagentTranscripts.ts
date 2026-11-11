/**
 * Agent-tool subagents of a Claude Code session. The CLI writes each one next
 * to the session's JSONL (`<session-id>/subagents/agent-<id>.jsonl` plus a
 * `.meta.json`), and never into the parent's stream when it runs in the
 * background — so a transcript without them hides that work.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeProjectSlug } from "../llm/runners/claudeCode/transcriptFork";

/** A tool result longer than this is cut; page the subagent for the gist, not the bytes. */
const MAX_RESULT_CHARS = 4000;

export interface SubagentSummary {
  /** Pass to `read_agent_transcript` as `subagent`. */
  id: string;
  description: string | null;
  agent_type: string | null;
  background: boolean;
  started_at: string | null;
  ended_at: string | null;
  message_count: number;
  tool_calls: number;
  /** Calls per tool name, most used first. */
  tool_counts: Record<string, number>;
}

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  is_error: boolean;
  content: string;
}
export type SubagentBlock =
  | ToolResultBlock
  | ToolUseBlock
  | { type: "text"; text: string };

export interface SubagentMessage {
  role: "assistant" | "user";
  at: string | null;
  content: SubagentBlock[];
}

interface Line {
  type?: string;
  timestamp?: string;
  message?: { id?: string; role?: string; content?: unknown };
}

function projectsRoot(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

/** The session's subagents dir: under its cwd's slug, else wherever the session id turns up. */
export function subagentsDir(
  cwd: string | null,
  sessionId: string,
  root = projectsRoot(),
): string | null {
  const under = (dir: string) => path.join(root, dir, sessionId, "subagents");
  if (cwd && fs.existsSync(under(claudeProjectSlug(cwd)))) {
    return under(claudeProjectSlug(cwd));
  }
  try {
    const found = fs.readdirSync(root).find((dir) => fs.existsSync(under(dir)));

    return found ? under(found) : null;
  } catch {
    return null;
  }
}

function readLines(file: string): Line[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }

  return raw.split("\n").flatMap((l) => {
    if (!l.trim()) {
      return [];
    }
    try {
      return [JSON.parse(l) as Line];
    } catch {
      return [];
    }
  });
}

function readMeta(file: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function resultText(content: unknown): string {
  let text = typeof content === "string" ? content : "";
  if (Array.isArray(content)) {
    text = content
      .map((b: { type?: string; text?: string }) =>
        b.type === "text" ? (b.text ?? "") : `[${b.type ?? "block"}]`,
      )
      .join("\n");
  }

  return text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}… [${text.length - MAX_RESULT_CHARS} more chars]`
    : text;
}

function blocks(content: unknown): SubagentBlock[] {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((b: Record<string, unknown>): SubagentBlock[] => {
    if (b.type === "text" && typeof b.text === "string") {
      return [{ type: "text", text: b.text }];
    }
    if (b.type === "tool_use") {
      return [
        {
          type: "tool_use",
          id: String(b.id),
          name: String(b.name),
          input: b.input,
        },
      ];
    }
    if (b.type === "tool_result") {
      return [
        {
          type: "tool_result",
          tool_use_id: String(b.tool_use_id),
          is_error: b.is_error === true,
          content: resultText(b.content),
        },
      ];
    }

    return [];
  });
}

/** The conversation, with an assistant message split over several lines joined back up. */
function messagesOf(lines: Line[]): SubagentMessage[] {
  const out: SubagentMessage[] = [];
  let lastAssistantId: string | undefined;
  for (const line of lines) {
    if (line.type !== "user" && line.type !== "assistant") {
      continue;
    }
    const content = blocks(line.message?.content);
    if (content.length === 0) {
      continue;
    }
    const id = line.type === "assistant" ? line.message?.id : undefined;
    const prev = out.at(-1);
    if (id && id === lastAssistantId && prev?.role === "assistant") {
      prev.content.push(...content);
      continue;
    }
    lastAssistantId = id;
    out.push({ role: line.type, at: line.timestamp ?? null, content });
  }

  return out;
}

function subagentFiles(dir: string): { id: string; file: string }[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => n.startsWith("agent-") && n.endsWith(".jsonl"))
      .map((n) => ({
        id: n.slice("agent-".length, -".jsonl".length),
        file: path.join(dir, n),
      }));
  } catch {
    return [];
  }
}

export function summarizeSubagent(
  id: string,
  lines: Line[],
  meta: Record<string, unknown>,
): SubagentSummary {
  const counts: Record<string, number> = {};
  const messages = messagesOf(lines);
  for (const message of messages) {
    for (const b of message.content) {
      if (b.type === "tool_use") {
        counts[b.name] = (counts[b.name] ?? 0) + 1;
      }
    }
  }
  const stamps = lines
    .map((l) => l.timestamp)
    .filter((t): t is string => typeof t === "string")
    .sort();
  const str = (v: unknown) => (typeof v === "string" ? v : null);

  return {
    id,
    description: str(meta.description),
    agent_type: str(meta.agentType),
    background: meta.requestShape === "background",
    started_at: stamps[0] ?? null,
    ended_at: stamps.at(-1) ?? null,
    message_count: messages.length,
    tool_calls: Object.values(counts).reduce((a, b) => a + b, 0),
    tool_counts: Object.fromEntries(
      Object.entries(counts).sort((a, b) => b[1] - a[1]),
    ),
  };
}

/** Every subagent of a session, oldest first. */
export function listSubagents(dir: string | null): SubagentSummary[] {
  if (!dir) {
    return [];
  }

  return subagentFiles(dir)
    .map(({ id, file }) =>
      summarizeSubagent(
        id,
        readLines(file),
        readMeta(file.replace(/\.jsonl$/, ".meta.json")),
      ),
    )
    .sort((a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? ""));
}

/** One subagent's conversation, or null when the session has no such subagent. */
export function readSubagent(
  dir: string | null,
  id: string,
): SubagentMessage[] | null {
  const bare = id.replace(/^agent-/, "");
  const entry = dir ? subagentFiles(dir).find((f) => f.id === bare) : null;

  return entry ? messagesOf(readLines(entry.file)) : null;
}
