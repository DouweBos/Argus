/**
 * Bring chats run with the plain Claude Code CLI — in a terminal or another
 * app — into each project's chat history, so they can be read and resumed.
 * Only the repo root's own transcripts count; Argus's worktrees have theirs.
 */

import type { SavedConversation } from "../agent/chatHistory";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { info, warn } from "@argus/host/logger";
import { appState } from "../../state";
import { importConversations, loadHistoryIndex } from "../agent/chatHistory";
import { liveMeta } from "../agent/conversation/live";
import { loadAppSettings } from "../appSettings/store";
import { claudeProjectSlug } from "../llm/runners/claudeCode/transcriptFork";
import { loadArgusConfig } from "../session/argusConfig";
import { capture } from "../telemetry/telemetry";
import { isCliSessionId, readCliSession } from "./cliSession";

/** Chats older than this stay where they are. */
const MAX_AGE_MS = 30 * 24 * 60 * 60_000;
/** Newest transcripts looked at per project per pass. */
const MAX_PER_PROJECT = 100;
const INTERVAL_MS = 10 * 60_000;

export type ImportTrigger = "boot" | "interval" | "manual" | "project_added";

export function importEnabled(): boolean {
  return loadAppSettings().import_cli_chats !== false;
}

function runningSessionIds(): Set<string> {
  const ids = new Set<string>();
  for (const agentId of appState.agents.keys()) {
    const id = liveMeta(agentId)?.sessionId;
    if (id) {
      ids.add(id);
    }
  }

  return ids;
}

/** Import one project's new or grown CLI chats; returns how many were written. */
export async function importCliChats(
  repoRoot: string,
  now = Date.now(),
): Promise<number> {
  try {
    if (loadArgusConfig(repoRoot).save_chat_history === false) {
      return 0;
    }
  } catch {
    // No readable config: the default keeps history.
  }
  const dir = path.join(
    os.homedir(),
    ".claude",
    "projects",
    claudeProjectSlug(repoRoot),
  );
  let names: string[];
  try {
    names = (await fs.promises.readdir(dir)).filter((n) =>
      n.endsWith(".jsonl"),
    );
  } catch {
    return 0;
  }
  const files: { file: string; id: string; mtimeMs: number }[] = [];
  for (const name of names) {
    const id = name.slice(0, -".jsonl".length);
    if (!isCliSessionId(id)) {
      continue;
    }
    try {
      const { mtimeMs } = await fs.promises.stat(path.join(dir, name));
      if (now - mtimeMs <= MAX_AGE_MS) {
        files.push({ file: path.join(dir, name), id, mtimeMs });
      }
    } catch {
      // Deleted mid-scan.
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const known = new Map(
    loadHistoryIndex(repoRoot).map((e) => [e.sessionId, e]),
  );
  const running = runningSessionIds();
  const conversations: SavedConversation[] = [];
  for (const f of files.slice(0, MAX_PER_PROJECT)) {
    const existing = known.get(f.id);
    // Argus's own chats, and imports the transcript hasn't moved past.
    if (
      (existing && !existing.importedFrom) ||
      (existing && existing.endedAt >= f.mtimeMs) ||
      running.has(f.id)
    ) {
      continue;
    }
    const session = await readCliSession(f.file, f.id).catch(() => null);
    if (
      !session ||
      session.ranInArgus ||
      session.messages.length === 0 ||
      session.sessionId !== f.id
    ) {
      continue;
    }
    conversations.push({
      id: existing?.id ?? `cli-${f.id}`,
      sessionId: f.id,
      title: session.title,
      sessionBranch: session.gitBranch,
      sessionDescription: "",
      model: session.model ?? undefined,
      runnerId: "claude-code",
      importedFrom: "claude_code",
      messageCount: session.messages.length,
      createdAt: session.firstAt ?? f.mtimeMs,
      endedAt: Math.max(session.lastAt ?? 0, f.mtimeMs),
      messages: session.messages.map((m, i) => ({
        id: `cli-${f.id}-${i}`,
        role: m.role,
        textBlocks: [m.text],
        timestamp: m.at,
        toolCalls: [],
      })),
    });
  }

  return importConversations(repoRoot, conversations);
}

/** One pass over every open project. */
export async function importAllCliChats(
  trigger: ImportTrigger,
): Promise<{ imported: number; projects: number }> {
  if (trigger !== "manual" && !importEnabled()) {
    return { imported: 0, projects: 0 };
  }
  let imported = 0;
  let projects = 0;
  for (const repoRoot of appState.repoRoots) {
    try {
      const count = await importCliChats(repoRoot);
      imported += count;
      projects += count > 0 ? 1 : 0;
    } catch (e) {
      warn(`[cli-chats] import failed for a project: ${String(e)}`);
    }
  }
  if (imported > 0 || trigger === "manual") {
    info(
      `[cli-chats] imported ${imported} chats into ${projects} projects (${trigger})`,
    );
    capture("cli_chats_imported", {
      trigger,
      imported_bucket: bucket(imported),
      project_count: projects,
    });
  }

  return { imported, projects };
}

export function bucket(n: number): "0" | "1-5" | "6-20" | "21-100" | "100+" {
  if (n === 0) {
    return "0";
  }
  if (n <= 5) {
    return "1-5";
  }
  if (n <= 20) {
    return "6-20";
  }

  return n <= 100 ? "21-100" : "100+";
}

let timer: NodeJS.Timeout | null = null;

/** Import on boot and every few minutes after; `project:added` runs one too. */
export function startCliChatImport(): () => void {
  const run = (trigger: ImportTrigger) => {
    importAllCliChats(trigger).catch((e) => warn(`[cli-chats] ${String(e)}`));
  };
  run("boot");
  timer = setInterval(() => run("interval"), INTERVAL_MS);
  timer.unref?.();

  return () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
