/**
 * A session's agent turns, for diffs scoped to what one prompt changed. A
 * turn runs from the checkpoint taken before its prompt to the snapshot taken
 * when it went idle, else the next turn's checkpoint, else the tree as it is now.
 */

import { appState } from "../../state";
import { git } from "../session/git";
import { sessionMergeBase } from "../session/sessionOps";
import { loadConversation, loadHistoryIndex } from "./chatHistory";
import {
  checkpointRef,
  refForTurnEnd,
  resolveCheckpointRef,
  sessionWorktreePath,
  snapshotWorktree,
} from "./checkpoints";
import { readConversation } from "./conversation/live";

export interface SessionTurn {
  /** 1-based, oldest first, across every agent that ran in the session. */
  number: number;
  checkpointId: string;
  agentId: string;
  /** The prompt's first line, cut short. */
  prompt: string;
  timestamp: number;
}

export type DiffScope =
  | { kind: "branch" }
  | { kind: "turn"; checkpointId?: string };

export interface DiffRange {
  from: string;
  to: string;
}

interface UserMessage {
  role: string;
  checkpointId?: string;
  textBlocks?: string[];
  timestamp: number;
}

const PROMPT_PREVIEW = 80;

function preview(message: UserMessage): string {
  const line =
    (message.textBlocks ?? []).join("\n").trim().split("\n")[0] ?? "";

  return line.length > PROMPT_PREVIEW
    ? `${line.slice(0, PROMPT_PREVIEW - 1)}…`
    : line;
}

interface AgentConversation {
  messages: UserMessage[];
  title?: string;
}

function conversationsOf(sessionId: string): Map<string, AgentConversation> {
  const byAgent = new Map<string, AgentConversation>();
  for (const agent of appState.agents.values()) {
    if (agent.sessionId === sessionId) {
      const conv = readConversation(agent.agentId);
      if (conv) {
        byAgent.set(agent.agentId, conv);
      }
    }
  }
  const repoRoot = appState.sessions.get(sessionId)?.repo_root;
  if (!repoRoot) {
    return byAgent;
  }
  for (const entry of loadHistoryIndex(repoRoot)) {
    const agentId = entry.agentId ?? entry.id;
    if (entry.argusSessionId !== sessionId || byAgent.has(agentId)) {
      continue;
    }
    const saved = loadConversation(repoRoot, entry.id);
    if (saved) {
      byAgent.set(agentId, {
        messages: saved.messages as UserMessage[],
        title: saved.title,
      });
    }
  }

  return byAgent;
}

/** A turn, and whether its checkpoint ref is still there to diff or restore. */
export interface RecordedTurn extends SessionTurn {
  available: boolean;
  agentTitle: string | null;
}

/** Every prompt that took a checkpoint whose ref is still there, oldest first. */
export async function listSessionTurns(
  sessionId: string,
): Promise<SessionTurn[]> {
  return (await listRecordedTurns(sessionId))
    .filter((t) => t.available)
    .map(({ available: _, agentTitle: __, ...turn }) => turn);
}

/** Every prompt that took a checkpoint, numbered across gone ones so numbers stay put. */
export async function listRecordedTurns(
  sessionId: string,
): Promise<RecordedTurn[]> {
  const cwd = sessionWorktreePath(sessionId);
  const seen = new Set<string>();
  const turns: Omit<RecordedTurn, "available" | "number">[] = [];
  for (const [agentId, conv] of conversationsOf(sessionId)) {
    const agentTitle = conv.title?.trim() || null;
    for (const message of conv.messages) {
      const id = message.checkpointId;
      if (message.role !== "user" || !id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      turns.push({
        checkpointId: id,
        agentId,
        agentTitle,
        prompt: preview(message),
        timestamp: message.timestamp,
      });
    }
  }
  const live = await existingRefs(
    cwd,
    turns.map((t) => t.checkpointId),
  );

  return turns
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((t, i) => ({
      ...t,
      number: i + 1,
      available: live.has(t.checkpointId),
    }));
}

async function existingRefs(cwd: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) {
    return new Set();
  }
  const out = await git(cwd, [
    "for-each-ref",
    "--format=%(refname)",
    "refs/argus/checkpoints/",
  ]);
  const refs = new Set(out.split("\n").filter(Boolean));

  return new Set(ids.filter((id) => refs.has(checkpointRef(id))));
}

/** The two commits to diff for a scope; `to` may be a fresh snapshot of the tree. */
export async function sessionDiffRange(
  sessionId: string,
  scope: DiffScope,
): Promise<DiffRange> {
  const cwd = sessionWorktreePath(sessionId);
  if (scope.kind === "branch") {
    const base = await sessionMergeBase(sessionId);
    if (!base) {
      throw "This session has no base branch to compare with";
    }

    return { from: base, to: (await snapshotWorktree(cwd)).sha };
  }
  const turns = await listSessionTurns(sessionId);
  const index = scope.checkpointId
    ? turns.findIndex((t) => t.checkpointId === scope.checkpointId)
    : turns.length - 1;
  const turn = turns[index];
  if (!turn) {
    throw scope.checkpointId
      ? "That turn's checkpoint is gone"
      : "No agent turns yet";
  }
  const from = await resolveCheckpointRef(
    cwd,
    checkpointRef(turn.checkpointId),
  );
  if (!from) {
    throw "That turn's checkpoint is gone";
  }
  const to =
    (await turnEndSha(cwd, turn, turns[index + 1])) ??
    (await snapshotWorktree(cwd)).sha;

  return { from, to };
}

/** Where a finished turn left the tree: its end snapshot, else the next turn's start. */
export async function turnEndSha(
  cwd: string,
  turn: SessionTurn,
  next: SessionTurn | undefined,
): Promise<string | null> {
  return (
    (await resolveCheckpointRef(cwd, refForTurnEnd(turn.checkpointId))) ??
    (next
      ? await resolveCheckpointRef(cwd, checkpointRef(next.checkpointId))
      : null)
  );
}
