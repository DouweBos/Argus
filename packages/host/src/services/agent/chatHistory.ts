/**
 * Chat history persistence service.
 *
 * Saves and loads agent conversations to disk. Stored per project (repo root)
 * alongside session metadata, in `~/.argus/projects/{key}/.argus-chat-history/`.
 *
 * Each conversation is an individual JSON file ({id}.json). A lightweight
 * `index.json` stores summaries for fast listing without parsing every file.
 */

import fs from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { loadArgusConfig } from "../session/argusConfig";
import { CHAT_HISTORY_DIR, sidecarPath } from "../session/sidecars";

const INDEX_FILENAME = "index.json";
const SCHEMA_VERSION = 1;
const MAX_ENTRIES = 100;

/** Lightweight summary stored in the index — enough for list rendering. */
export interface ChatHistoryEntry {
  id: string;
  sessionId: string;
  /** Agent that produced this conversation — absent on records saved before
   *  the field existed. Lets callers tell a finished chat from a live one. */
  agentId?: string;
  /** Agent that spawned this one, and the Argus session it ran in — absent
   *  on older records. Lets an orchestrator find its children after a crash. */
  parentAgentId?: string;
  argusSessionId?: string;
  title: string;
  sessionBranch: string;
  sessionDescription: string;
  model?: string;
  /** Runner that produced the conversation — absent on older records.
   *  Resuming re-binds the new agent to it; a transcript belongs to the
   *  gateway that wrote it. */
  runnerId?: string;
  /** Permission mode and effort it last ran with, so a resume keeps them. Absent on older records. */
  permissionMode?: string;
  effort?: string;
  totalCost?: number;
  totalDuration?: number;
  /** Set when the chat was read in from another app's history, not run here. */
  importedFrom?: "claude_code";
  /** Derived from the pins when listed; never stored. */
  pinned?: boolean;
  messageCount: number;
  createdAt: number;
  endedAt: number;
}

/** Full saved conversation (entry metadata + messages). */
export interface SavedConversation extends ChatHistoryEntry {
  messages: unknown[];
}

interface IndexFile {
  version: number;
  entries: ChatHistoryEntry[];
}

function historyDir(repoRoot: string): string {
  // Per project, not per purpose — automations must not get a second history.
  return sidecarPath(repoRoot, CHAT_HISTORY_DIR);
}

function indexPath(repoRoot: string): string {
  return path.join(historyDir(repoRoot), INDEX_FILENAME);
}

function conversationPath(repoRoot: string, historyId: string): string {
  return path.join(historyDir(repoRoot), `${historyId}.json`);
}

/**
 * Load the history index. Returns entries sorted newest-first.
 * Returns an empty array if the file is missing or invalid.
 */
export function loadHistoryIndex(repoRoot: string): ChatHistoryEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(indexPath(repoRoot), "utf8");
  } catch {
    return [];
  }

  try {
    const file = JSON.parse(raw) as IndexFile;
    if (file.version !== SCHEMA_VERSION) {
      return [];
    }

    return (file.entries ?? []).sort((a, b) => b.endedAt - a.endedAt);
  } catch {
    return [];
  }
}

function saveIndex(repoRoot: string, entries: ChatHistoryEntry[]): void {
  const file: IndexFile = { version: SCHEMA_VERSION, entries };
  const dir = historyDir(repoRoot);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      indexPath(repoRoot),
      JSON.stringify(file, null, 2),
      "utf8",
    );
  } catch (e) {
    warn("Failed to write chat history index:", e);
  }
}

/**
 * Save a conversation to disk. Checks the project's `save_chat_history`
 * setting (defaults to true). Upserts by sessionId — if a conversation with
 * the same sessionId already exists, its file is overwritten and the index
 * entry is updated in place (preserving the original id and createdAt). This
 * lets callers save incrementally during an ongoing chat without creating
 * duplicates.
 */
export function saveConversation(
  repoRoot: string,
  conversation: SavedConversation,
): void {
  // Check project setting
  try {
    const config = loadArgusConfig(repoRoot);
    if (config.save_chat_history === false) {
      return;
    }
  } catch {
    // Can't read config — default to saving
  }

  const entries = loadHistoryIndex(repoRoot);

  // Upsert by sessionId — if an entry with the same sessionId already exists,
  // reuse its id and createdAt so the on-disk file stays stable.
  const existingIdx = conversation.sessionId
    ? entries.findIndex((e) => e.sessionId === conversation.sessionId)
    : -1;
  if (existingIdx >= 0) {
    const existing = entries[existingIdx];
    conversation = {
      ...conversation,
      id: existing.id,
      createdAt: existing.createdAt,
    };
    entries.splice(existingIdx, 1);
  }

  // Write the full conversation file
  const dir = historyDir(repoRoot);
  try {
    fs.mkdirSync(dir, { recursive: true });
    // Compact: a long chat is megabytes, rewritten on every save.
    fs.writeFileSync(
      conversationPath(repoRoot, conversation.id),
      JSON.stringify(conversation),
      "utf8",
    );
  } catch (e) {
    warn("Failed to write chat history conversation:", e);

    return;
  }

  // Build the index entry (strip messages)
  const entry: ChatHistoryEntry = {
    id: conversation.id,
    sessionId: conversation.sessionId,
    agentId: conversation.agentId,
    parentAgentId: conversation.parentAgentId,
    argusSessionId: conversation.argusSessionId,
    title: conversation.title,
    sessionBranch: conversation.sessionBranch,
    sessionDescription: conversation.sessionDescription,
    model: conversation.model,
    runnerId: conversation.runnerId,
    permissionMode: conversation.permissionMode,
    effort: conversation.effort,
    totalCost: conversation.totalCost,
    totalDuration: conversation.totalDuration,
    importedFrom: conversation.importedFrom,
    messageCount: conversation.messageCount,
    createdAt: conversation.createdAt,
    endedAt: conversation.endedAt,
  };

  entries.unshift(entry);

  // Enforce retention cap — drop oldest entries and their conversation files.
  if (entries.length > MAX_ENTRIES) {
    const evicted = entries.splice(MAX_ENTRIES);
    for (const old of evicted) {
      try {
        fs.unlinkSync(conversationPath(repoRoot, old.id));
      } catch {
        // File may already be gone — ignore.
      }
    }
  }

  saveIndex(repoRoot, entries);
}

/**
 * Merge chats read in from another app. Argus's own chats are never evicted
 * for them: imports only fill what the retention cap leaves free.
 */
export function importConversations(
  repoRoot: string,
  conversations: SavedConversation[],
): number {
  if (conversations.length === 0) {
    return 0;
  }
  const incoming = new Map(conversations.map((c) => [c.sessionId, c]));
  const entries = loadHistoryIndex(repoRoot).filter(
    (e) => !e.importedFrom || !incoming.has(e.sessionId),
  );
  const own = entries.filter((e) => !e.importedFrom);
  const imported = [
    ...entries.filter((e) => e.importedFrom),
    ...conversations.map(({ messages: _messages, ...entry }) => entry),
  ]
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, Math.max(0, MAX_ENTRIES - own.length));
  const kept = new Set(imported.map((e) => e.id));
  const dir = historyDir(repoRoot);
  let written = 0;
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const conversation of conversations) {
      if (kept.has(conversation.id)) {
        fs.writeFileSync(
          conversationPath(repoRoot, conversation.id),
          JSON.stringify(conversation),
          "utf8",
        );
        written += 1;
      }
    }
  } catch (e) {
    warn("Failed to write imported chat history:", e);

    return written;
  }
  for (const old of entries.filter((e) => e.importedFrom && !kept.has(e.id))) {
    try {
      fs.unlinkSync(conversationPath(repoRoot, old.id));
    } catch {
      // Already gone.
    }
  }
  saveIndex(
    repoRoot,
    [...own, ...imported].sort((a, b) => b.endedAt - a.endedAt),
  );

  return written;
}

/**
 * Load a single saved conversation by its history ID.
 * Returns null if the file is missing or invalid.
 */
export function loadConversation(
  repoRoot: string,
  historyId: string,
): SavedConversation | null {
  let raw: string;
  try {
    raw = fs.readFileSync(conversationPath(repoRoot, historyId), "utf8");
  } catch {
    return null;
  }

  try {
    return JSON.parse(raw) as SavedConversation;
  } catch {
    return null;
  }
}

export interface ChatHistoryMessageMatch {
  /** Index of the match start within `snippet`. */
  matchStart: number;
  /** Index of the match end (exclusive) within `snippet`. */
  matchEnd: number;
  /** Position of the message in the conversation. */
  messageIndex: number;
  role: "assistant" | "system" | "user";
  /** A short excerpt of the message text around the first match. */
  snippet: string;
}

export interface ChatHistorySearchResult {
  entry: ChatHistoryEntry;
  /** Matches inside message text blocks (capped per entry). */
  messageMatches: ChatHistoryMessageMatch[];
  /** True when the query matches title / branch / model / description. */
  metaMatch: boolean;
}

interface MessageLike {
  role?: unknown;
  textBlocks?: unknown;
}

const SNIPPET_WINDOW = 60;
const MAX_MATCHES_PER_ENTRY = 3;

function buildSnippet(
  text: string,
  matchStart: number,
  matchEnd: number,
): { matchEnd: number; matchStart: number; snippet: string } {
  const start = Math.max(0, matchStart - SNIPPET_WINDOW);
  const end = Math.min(text.length, matchEnd + SNIPPET_WINDOW);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  const rawSnippet = prefix + body + suffix;
  const lowered = rawSnippet.toLowerCase();
  const needle = text.slice(matchStart, matchEnd).toLowerCase();
  const pos = lowered.indexOf(needle);

  if (pos < 0) {
    return { matchEnd: 0, matchStart: 0, snippet: rawSnippet };
  }

  return {
    matchEnd: pos + needle.length,
    matchStart: pos,
    snippet: rawSnippet,
  };
}

/**
 * Search saved conversations for `query`. Matches against entry metadata
 * (title, branch, model, description) and message text blocks. Returns
 * newest-first, with up to a few snippets per entry.
 */
export function searchChatHistory(
  repoRoot: string,
  query: string,
): ChatHistorySearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }

  const entries = loadHistoryIndex(repoRoot);
  const results: ChatHistorySearchResult[] = [];

  for (const entry of entries) {
    const title = entry.title?.toLowerCase() ?? "";
    const branch = entry.sessionBranch?.toLowerCase() ?? "";
    // Only match on fields that are rendered on the row. `entry.model` would
    // match every entry for "claude"; `sessionDescription` isn't shown, so
    // a hit there looks like a phantom result.
    const metaMatch = title.includes(q) || branch.includes(q);

    const messageMatches: ChatHistoryMessageMatch[] = [];

    let raw: string;
    try {
      raw = fs.readFileSync(conversationPath(repoRoot, entry.id), "utf8");
    } catch {
      if (metaMatch) {
        results.push({ entry, messageMatches, metaMatch: true });
      }
      continue;
    }

    let saved: { messages?: MessageLike[] } | null = null;
    try {
      saved = JSON.parse(raw) as { messages?: MessageLike[] };
    } catch {
      saved = null;
    }

    const messages = saved?.messages ?? [];
    for (let i = 0; i < messages.length; i++) {
      if (messageMatches.length >= MAX_MATCHES_PER_ENTRY) {
        break;
      }
      const msg = messages[i];
      const blocks = Array.isArray(msg.textBlocks)
        ? (msg.textBlocks as unknown[])
        : [];
      const role =
        msg.role === "assistant" || msg.role === "user" || msg.role === "system"
          ? msg.role
          : "user";

      for (const block of blocks) {
        if (messageMatches.length >= MAX_MATCHES_PER_ENTRY) {
          break;
        }
        if (typeof block !== "string") {
          continue;
        }
        const lower = block.toLowerCase();
        const idx = lower.indexOf(q);
        if (idx < 0) {
          continue;
        }
        const snippet = buildSnippet(block, idx, idx + q.length);
        messageMatches.push({
          matchEnd: snippet.matchEnd,
          matchStart: snippet.matchStart,
          messageIndex: i,
          role,
          snippet: snippet.snippet,
        });
      }
    }

    if (metaMatch || messageMatches.length > 0) {
      results.push({ entry, messageMatches, metaMatch });
    }
  }

  return results;
}

/**
 * Delete a history entry — removes both the conversation file and the
 * index entry.
 */
export function deleteHistoryEntry(repoRoot: string, historyId: string): void {
  // Remove the conversation file
  try {
    fs.unlinkSync(conversationPath(repoRoot, historyId));
  } catch {
    // File may already be gone
  }

  // Remove from index
  const entries = loadHistoryIndex(repoRoot);
  const filtered = entries.filter((e) => e.id !== historyId);
  if (filtered.length !== entries.length) {
    saveIndex(repoRoot, filtered);
  }
}

/** Drop imported chats by history id; Argus's own history is never touched. */
export function removeImportedEntries(
  repoRoot: string,
  historyIds: Iterable<string>,
): number {
  const ids = new Set(historyIds);
  const entries = loadHistoryIndex(repoRoot);
  const gone = entries.filter((e) => e.importedFrom && ids.has(e.id));
  if (gone.length === 0) {
    return 0;
  }
  for (const e of gone) {
    try {
      fs.unlinkSync(conversationPath(repoRoot, e.id));
    } catch {
      // Already gone.
    }
  }
  saveIndex(
    repoRoot,
    entries.filter((e) => !gone.includes(e)),
  );

  return gone.length;
}

/**
 * Load a saved conversation by its runner session id (the id a resume spawn
 * passes to `--resume`). Returns null when nothing was saved for it.
 */
export function loadConversationByRunnerSession(
  repoRoot: string,
  runnerSessionId: string,
): SavedConversation | null {
  const entry = loadHistoryIndex(repoRoot).find(
    (e) => e.sessionId === runnerSessionId,
  );

  return entry ? loadConversation(repoRoot, entry.id) : null;
}
