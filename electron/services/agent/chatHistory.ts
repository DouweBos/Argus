/**
 * Chat history persistence service.
 *
 * Saves and loads agent conversations to disk. Stored per project (repo root)
 * alongside workspace metadata in:
 * `~/.stagehand/worktrees/{RepoName}-stagehand-worktrees/.stagehand-chat-history/`
 *
 * Each conversation is an individual JSON file ({id}.json). A lightweight
 * `index.json` stores summaries for fast listing without parsing every file.
 */

import fs from "node:fs";
import path from "node:path";
import { warn } from "../../../app/lib/logger";
import { worktreesRoot } from "../workspace/git";
import { loadStagehandConfig } from "../workspace/setup";

const HISTORY_DIR_NAME = ".stagehand-chat-history";
const INDEX_FILENAME = "index.json";
const SCHEMA_VERSION = 1;

/** Lightweight summary stored in the index — enough for list rendering. */
export interface ChatHistoryEntry {
  id: string;
  sessionId: string;
  title: string;
  workspaceBranch: string;
  workspaceDescription: string;
  model?: string;
  totalCost?: number;
  totalDuration?: number;
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
  return path.join(worktreesRoot(repoRoot), HISTORY_DIR_NAME);
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
 * setting (defaults to true). Deduplicates by sessionId — if a conversation
 * with the same sessionId already exists, this is a no-op.
 */
export function saveConversation(
  repoRoot: string,
  conversation: SavedConversation,
): void {
  // Check project setting
  try {
    const config = loadStagehandConfig(repoRoot);
    if (config.save_chat_history === false) {
      return;
    }
  } catch {
    // Can't read config — default to saving
  }

  const entries = loadHistoryIndex(repoRoot);

  // Deduplicate by sessionId
  if (entries.some((e) => e.sessionId === conversation.sessionId)) {
    return;
  }

  // Write the full conversation file
  const dir = historyDir(repoRoot);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      conversationPath(repoRoot, conversation.id),
      JSON.stringify(conversation, null, 2),
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
    title: conversation.title,
    workspaceBranch: conversation.workspaceBranch,
    workspaceDescription: conversation.workspaceDescription,
    model: conversation.model,
    totalCost: conversation.totalCost,
    totalDuration: conversation.totalDuration,
    messageCount: conversation.messageCount,
    createdAt: conversation.createdAt,
    endedAt: conversation.endedAt,
  };

  entries.unshift(entry);
  saveIndex(repoRoot, entries);
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
