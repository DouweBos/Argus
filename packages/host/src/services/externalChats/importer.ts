/**
 * Bring chats run with the plain Claude Code CLI — in a terminal or another
 * app — into each project's chat history, so they can be read and resumed.
 * Only the repo root's own transcripts count; Argus's worktrees have theirs.
 */

import type { CliSession } from "./cliSession";
import type { SavedConversation } from "../agent/chatHistory";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { info, warn } from "@argus/host/logger";
import { appState } from "../../state";
import {
  importConversations,
  loadHistoryIndex,
  removeImportedEntries,
} from "../agent/chatHistory";
import { liveMeta } from "../agent/conversation/live";
import { loadAppSettings } from "../appSettings/store";
import { claudeProjectSlug } from "../llm/runners/claudeCode/transcriptFork";
import { loadArgusConfig } from "../session/argusConfig";
import { capture } from "../telemetry/telemetry";
import { isCliSessionId, readCliSession } from "./cliSession";
import { isArgusHelperPrompt } from "./helperPrompts";

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

/** A scripted `claude -p` call — Argus's own title helpers and the like — not a chat. */
function isAutomated(session: CliSession): boolean {
  const first = session.messages.find((m) => m.role === "user");

  return session.oneShotPrint || (!!first && isArgusHelperPrompt(first.text));
}

export interface ProjectImport {
  imported: number;
  /** Automated transcripts newly passed over. */
  skipped: number;
  /** Earlier imports of automated transcripts, taken back out. */
  removed: number;
}

/** Transcripts judged on an earlier pass, by session id → mtime, so each is read once. */
const judged = new Map<string, number>();

/** Import one project's new or grown CLI chats. */
export async function importCliChats(
  repoRoot: string,
  now = Date.now(),
): Promise<ProjectImport> {
  const none = { imported: 0, skipped: 0, removed: 0 };
  try {
    if (loadArgusConfig(repoRoot).save_chat_history === false) {
      return none;
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
    return none;
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

  const index = loadHistoryIndex(repoRoot);
  const known = new Map(index.map((e) => [e.sessionId, e]));
  // Earlier passes imported Argus's own helper calls; their titles give them away.
  const stale = new Set(
    index
      .filter((e) => e.importedFrom && isArgusHelperPrompt(e.title))
      .map((e) => e.id),
  );
  let skipped = 0;
  const running = runningSessionIds();
  const conversations: SavedConversation[] = [];
  for (const f of files.slice(0, MAX_PER_PROJECT)) {
    const existing = known.get(f.id);
    const unchanged = !!existing && existing.endedAt >= f.mtimeMs;
    // Argus's own chats, and imports the transcript hasn't moved past — short
    // ones get one more read, as they may be one-shot calls imported earlier.
    if (
      (existing && !existing.importedFrom) ||
      (existing &&
        unchanged &&
        (existing.messageCount > 2 || stale.has(existing.id))) ||
      running.has(f.id) ||
      judged.get(f.id) === f.mtimeMs
    ) {
      continue;
    }
    const session = await readCliSession(f.file, f.id).catch(() => null);
    if (session && (unchanged || isAutomated(session))) {
      judged.set(f.id, f.mtimeMs);
    }
    if (session && isAutomated(session)) {
      skipped += 1;
      if (existing) {
        stale.add(existing.id);
      }
      continue;
    }
    if (
      unchanged ||
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

  const removed = removeImportedEntries(repoRoot, stale);
  if (removed > 0) {
    info(`[cli-chats] removed ${removed} imported one-shot CLI calls`);
  }

  return {
    imported: importConversations(repoRoot, conversations),
    skipped,
    removed,
  };
}

/** One pass over every open project. */
export async function importAllCliChats(
  trigger: ImportTrigger,
): Promise<{ imported: number; projects: number }> {
  if (trigger !== "manual" && !importEnabled()) {
    return { imported: 0, projects: 0 };
  }
  let imported = 0;
  let skipped = 0;
  let projects = 0;
  for (const repoRoot of appState.repoRoots) {
    try {
      const result = await importCliChats(repoRoot);
      imported += result.imported;
      skipped += result.skipped;
      projects += result.imported > 0 ? 1 : 0;
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
      skipped_bucket: bucket(skipped),
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
