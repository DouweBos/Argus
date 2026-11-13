/**
 * Compare runs: one prompt on 2–5 runners or models at once, a session per
 * slot, scored side by side, then one kept and the rest torn down.
 */

import type { MergeStrategy } from "../session/merge";
import type { Session } from "../session/models";
import type {
  ImageAttachment,
  RemoteCompareRun,
  RemoteCompareSlot,
  SessionCompareGroup,
} from "@argus/remote-protocol";
import crypto from "node:crypto";
import { emitHostEvent } from "@argus/host/bus";
import { error as logError } from "@argus/host/logger";
import { appState } from "../../state";
import { loadAppSettings } from "../appSettings/store";
import { cdpCall, isScreencasting } from "../browser/cdpScreencast";
import { prepareIssueStart } from "../integrations/issueStart";
import { git, titleToBranchSlug } from "../session/git";
import { createSession, deleteSession } from "../session/manager";
import { loadMetadata, saveMetadata } from "../session/metadata";
import {
  gitCommit,
  mergeSessionIntoBase,
  pushSessionBranch,
  stageAll,
} from "../session/sessionOps";
import { computeSessionDiffStats } from "../session/watcher";
import { iosScreenshot } from "../simulator/screenshot";
import { capture } from "../telemetry/telemetry";
import { listTerminals } from "../terminal/multiplexer";
import { createRemotePullRequest } from "./githubRemote";
import { startAgentWhenReady } from "./startWhenReady";

export interface CompareSlotSpec {
  runner_id?: string;
  model?: string;
  effort?: string;
}

export interface CompareStart {
  repoRoot: string;
  description: string;
  baseBranch?: string;
  prompt: string;
  images?: ImageAttachment[];
  permissionMode?: string;
  linearIssue?: string;
  slots: CompareSlotSpec[];
}

/** Sessions in a compare run, in slot order. */
export function compareSessions(groupId: string): Session[] {
  return [...appState.sessions.values()]
    .filter((s) => s.compare_group?.id === groupId)
    .sort(
      (a, b) => (a.compare_group?.slot ?? 0) - (b.compare_group?.slot ?? 0),
    );
}

/** Branch suffixes for the slots: the runner, then the model when a runner repeats. */
export function slotSuffixes(slots: CompareSlotSpec[]): string[] {
  const fallback = loadAppSettings().default_llm?.runner ?? "default";
  const names = slots.map((s) => {
    const runner = s.runner_id ?? fallback;
    const twins = slots.filter((o) => (o.runner_id ?? fallback) === runner);

    return twins.length > 1 && s.model ? `${runner} ${s.model}` : runner;
  });

  return names.map((name, i) => {
    const slug = titleToBranchSlug(name).slice(0, 24).replace(/-+$/, "");
    const clash = names.filter((n) => n === name).length > 1;

    return clash ? `${slug}-${i + 1}` : slug;
  });
}

export async function createCompareRun(
  start: CompareStart,
): Promise<{ groupId: string; sessions: Session[] }> {
  const groupId = crypto.randomUUID();
  const issue = start.linearIssue
    ? await prepareIssueStart(start.linearIssue, start.prompt)
    : null;
  const suffixes = slotSuffixes(start.slots);
  const sessions: Session[] = [];
  for (const [slot, spec] of start.slots.entries()) {
    const group: SessionCompareGroup = {
      id: groupId,
      slot,
      runner_id: spec.runner_id ?? null,
      model: spec.model ?? null,
      effort: spec.effort ?? null,
    };
    const session = await createSession(
      start.repoRoot,
      issue?.branch ?? "",
      issue?.description ?? (start.description.trim() || start.prompt.trim()),
      false,
      start.baseBranch,
      { runner: spec.runner_id ?? null, model: spec.model ?? null },
      {
        compareGroup: group,
        branchSuffix: suffixes[slot],
        ...(issue
          ? { linkedIssue: issue.linkedIssue, designRefs: issue.designRefs }
          : {}),
      },
    );
    sessions.push(session);
    startAgentWhenReady(session.id, issue ? issue.prompt : start.prompt, {
      model: spec.model,
      permissionMode: start.permissionMode,
      runnerId: spec.runner_id,
      effort: spec.effort,
      images: [...(issue?.images ?? []), ...(start.images ?? [])],
    }).catch(() => {});
  }
  capture("compare_started", {
    slots: start.slots.length,
    distinct_runners: new Set(start.slots.map((s) => s.runner_id ?? null)).size,
    has_images: Boolean(start.images?.length),
    from_issue: issue !== null,
  });

  return { groupId, sessions };
}

/** A `.argus.json` run command whose title reads as a test run. */
export function isTestRun(title: string): boolean {
  return /\b(tests?|specs?|e2e|checks?|vitest|jest|xctest)\b/i.test(title);
}

function runState(exited: boolean, exitCode: number | null) {
  if (!exited) {
    return "running";
  }

  return exitCode === 0 ? "passed" : "failed";
}

function sessionRuns(sessionId: string): RemoteCompareRun[] {
  return listTerminals(sessionId)
    .filter((t) => t.runTitle)
    .map((t) => ({
      title: t.runTitle ?? "",
      state: runState(t.exited, t.exitCode),
      is_test: isTestRun(t.runTitle ?? ""),
    }));
}

function sessionAgents(sessionId: string) {
  return [...appState.agents.values()]
    .filter((a) => a.sessionId === sessionId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** The simulator one of the session's agents reserved, if any. */
function sessionSimulator(sessionId: string): string | null {
  const agentIds = new Set(sessionAgents(sessionId).map((a) => a.agentId));
  for (const r of appState.simulatorReservations.values()) {
    if (agentIds.has(r.agentId)) {
      return r.udid;
    }
  }

  return null;
}

export async function scoreCompareSlot(
  session: Session,
): Promise<RemoteCompareSlot> {
  const agents = sessionAgents(session.id);
  const newest = agents.at(-1) ?? null;
  const ready = session.status === "ready" && Boolean(session.path);
  const diff = ready
    ? await computeSessionDiffStats(session.id).catch(() => null)
    : null;
  const group = session.compare_group;

  return {
    session_id: session.id,
    slot: group?.slot ?? 0,
    runner_id: group?.runner_id ?? session.runner_id ?? null,
    model: newest?.resolvedModel ?? group?.model ?? session.model ?? null,
    effort: group?.effort ?? null,
    agent_id: newest?.agentId ?? null,
    agent_status: newest?.status ?? null,
    diff: diff
      ? {
          files: diff.files,
          insertions: diff.additions,
          deletions: diff.deletions,
        }
      : null,
    runs: sessionRuns(session.id),
    cost_usd: agents.reduce((sum, a) => sum + a.costUsd, 0),
    tokens: agents.reduce((sum, a) => sum + (a.tokensTotal ?? 0), 0),
    has_screen:
      sessionSimulator(session.id) !== null || isScreencasting(session.id),
  };
}

export async function scoreCompareRun(
  groupId: string,
): Promise<RemoteCompareSlot[]> {
  const sessions = compareSessions(groupId);
  if (sessions.length === 0) {
    throw `No compare run ${groupId}`;
  }

  return Promise.all(sessions.map(scoreCompareSlot));
}

/** What the slot's simulator, else its browser, shows right now. */
export async function compareScreenshot(sessionId: string): Promise<{
  image: string | null;
  source: "browser" | "simulator" | null;
}> {
  const udid = sessionSimulator(sessionId);
  if (udid) {
    const png = await iosScreenshot(udid);
    if (png) {
      return { image: png.toString("base64"), source: "simulator" };
    }
  }
  if (isScreencasting(sessionId)) {
    const shot = await cdpCall(sessionId, "Page.captureScreenshot", {
      format: "png",
    }).catch(() => null);
    if (typeof shot?.data === "string") {
      return { image: shot.data, source: "browser" };
    }
  }

  return { image: null, source: null };
}

function setCompareGroup(ws: Session, group: SessionCompareGroup | null) {
  ws.compare_group = group;
  appState.sessions.set(ws.id, ws);
  emitHostEvent("session:updated", { ...ws });
  const meta = loadMetadata(ws.repo_root);
  const m = meta.get(ws.path);
  if (!m) {
    return;
  }
  m.compare_group = group;
  try {
    saveMetadata(ws.repo_root, meta);
  } catch {
    // Non-fatal.
  }
}

/** Landing takes commits; whatever the agent left uncommitted goes in one. */
async function commitLeftovers(ws: Session): Promise<void> {
  const dirty = (await git(ws.path, ["status", "--porcelain"])).trim();
  if (!dirty) {
    return;
  }
  await stageAll(ws.id);
  const subject =
    (ws.display_name ?? ws.description).split(/\r?\n/)[0].slice(0, 72).trim() ||
    "Keep this compare slot";
  await gitCommit(ws.id, subject, false);
}

export type CompareLanding = "merge" | "none" | "pull_request";

export async function keepCompareSlot(params: {
  sessionId: string;
  land: CompareLanding;
  strategy?: MergeStrategy;
  deleteOthers: boolean;
}): Promise<{ pullRequestUrl: string | null; deleted: number }> {
  const ws = appState.sessions.get(params.sessionId);
  if (!ws) {
    throw `Session not found: ${params.sessionId}`;
  }
  const group = ws.compare_group;
  if (!group) {
    throw "This session isn't part of a compare run.";
  }
  let pullRequestUrl: string | null = null;
  try {
    if (params.land !== "none") {
      await commitLeftovers(ws);
    }
    if (params.land === "merge") {
      await mergeSessionIntoBase(ws.id, params.strategy ?? "squash");
    } else if (params.land === "pull_request") {
      await pushSessionBranch(ws.id);
      const open = ws.pull_request;
      pullRequestUrl =
        open && (open.state === "open" || open.state === "draft")
          ? open.url
          : (
              await createRemotePullRequest({
                sessionId: ws.id,
                title: (ws.display_name ?? ws.branch).slice(0, 200),
                body: ws.description,
                draft: false,
              })
            ).url;
    }
  } catch (e) {
    capture("compare_kept", { land: params.land, deleted: 0, success: false });
    throw e;
  }

  setCompareGroup(ws, null);
  let deleted = 0;
  if (params.deleteOthers) {
    for (const other of compareSessions(group.id)) {
      try {
        await deleteSession(other.id, true);
        deleted += 1;
      } catch (e) {
        logError(`Couldn't delete compare slot ${other.id}: ${String(e)}`);
      }
    }
  }
  capture("compare_kept", { land: params.land, deleted, success: true });

  return { pullRequestUrl, deleted };
}
