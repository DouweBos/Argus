/**
 * Cross-project sessions: one session spanning several repositories, each with
 * a worktree on the same branch name.
 *
 * The primary session keeps its worktree as the agent's cwd, so setup,
 * terminals, run commands and the git views behave exactly as for a
 * single-repo session; each other repository gets a session of its own (its
 * own `.argus.json` setup, git watcher, merge and pull request), and the
 * agent opens those worktrees beside its cwd.
 */

import type { Session } from "./models";
import type { SessionLinkedRepo } from "@argus/remote-protocol";
import { emitHostEvent } from "@argus/host/bus";
import { info, warn } from "@argus/host/logger";
import { appState } from "../../state";
import { isAgentBusy } from "../agent/busy";
import { respawnAgent } from "../agent/lifecycle";
import { hasHistory, resumeRefOf } from "../agent/resumeRef";
import { collectAllProjects } from "../mcp/projectDiscovery";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { setLinkedRepos } from "./crossProjectState";
import { git } from "./git";
import { addRepoRoot, createSession, deleteSession } from "./manager";

export interface CrossProjectFailure {
  repo_root: string;
  error: string;
}

export interface CrossProjectResult {
  session: Session;
  failed: CrossProjectFailure[];
}

function reposBucket(count: number): "2" | "3" | "4+" {
  if (count <= 2) {
    return "2";
  }

  return count === 3 ? "3" : "4+";
}

async function hasLocalBranch(repoRoot: string, branch: string) {
  try {
    await git(repoRoot, [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${branch}`,
    ]);

    return true;
  } catch {
    return false;
  }
}

/** One linked repo's worktree on the primary's branch name, set up like any session. */
async function addLinkedRepo(
  primary: Session,
  repoRoot: string,
): Promise<SessionLinkedRepo> {
  // Setup runs the project's commands, so only a project the host knows of.
  if (!collectAllProjects().some((p) => p.path === repoRoot)) {
    throw `unknown project: ${repoRoot}`;
  }
  // Its sessions are only listed for a project in the sidebar.
  addRepoRoot(repoRoot);
  const existing = await hasLocalBranch(repoRoot, primary.branch);
  let member: Session;
  try {
    member = await createSession(
      repoRoot,
      primary.branch,
      primary.description,
      existing,
      undefined,
      { runner: primary.runner_id ?? null, model: primary.model ?? null },
      {
        awaitWorktreeReady: true,
        crossProjectOf: primary.id,
        exactBranch: true,
      },
    );
  } catch (e) {
    // The half-made session would be an orphan nobody lists under its primary.
    for (const s of [...appState.sessions.values()]) {
      if (s.cross_project_of === primary.id && s.repo_root === repoRoot) {
        if (!s.path) {
          appState.sessions.delete(s.id);
          emitHostEvent("session:deleted", s.id);
        }
      }
    }
    throw e;
  }

  return {
    session_id: member.id,
    repo_root: repoRoot,
    worktree_path: member.path,
    branch: member.branch,
    base_branch: member.base_branch ?? null,
  };
}

/** Restart the session's idle agents so they open the new worktrees; a busy one picks them up on its next start. */
function reopenAgents(sessionId: string): void {
  for (const agent of appState.agents.values()) {
    if (agent.sessionId !== sessionId || agent.paused || isAgentBusy(agent)) {
      continue;
    }
    if (agent.status !== "idle") {
      continue;
    }
    const resumeRef = resumeRefOf(agent) ?? undefined;
    if (hasHistory(agent) && !resumeRef) {
      continue;
    }
    respawnAgent(agent.agentId, { keepModel: true, resumeRef }).catch(
      (e: unknown) => {
        warn(`[agent:${agent.agentId}] reopening for linked repos: ${e}`);
      },
    );
  }
}

/**
 * Turn a worktree session into a cross-project one, or add repositories to
 * one: a worktree per repo on the session's branch name, each through its
 * project's setup. Repos that fail are reported, not fatal to the rest.
 */
export async function makeCrossProjectSession(
  id: string,
  repoRoots: string[],
): Promise<CrossProjectResult> {
  const primary = appState.sessions.get(id);
  if (!primary) {
    throw `Session not found: ${id}`;
  }
  if (primary.kind !== "worktree" || !primary.path || !primary.branch) {
    throw "Only a session with its own worktree can span other projects";
  }
  if (primary.cross_project_of) {
    throw "This session is already part of a cross-project session";
  }
  const linked = primary.linked_repos ?? [];
  const wanted = [...new Set(repoRoots)].filter(
    (root) =>
      root !== primary.repo_root && !linked.some((r) => r.repo_root === root),
  );
  if (wanted.length === 0) {
    throw "Those projects are already part of this session";
  }

  const added: SessionLinkedRepo[] = [];
  const failed: CrossProjectFailure[] = [];
  for (const root of wanted) {
    try {
      added.push(await addLinkedRepo(primary, root));
      info(`Linked ${root} to session ${id} on ${primary.branch}`);
    } catch (e) {
      failed.push({
        repo_root: root,
        error: typeof e === "string" ? e : String(e),
      });
    }
  }

  const current = appState.sessions.get(id);
  if (current && added.length > 0) {
    setLinkedRepos(current, [...(current.linked_repos ?? []), ...added]);
    reopenAgents(id);
  }
  telemetryCapture("cross_project_session_created", {
    repos_bucket: reposBucket(1 + linked.length + added.length),
    extended: linked.length > 0,
    failed: failed.length > 0,
  });
  if (!current) {
    for (const r of added) {
      deleteSession(r.session_id, true, { withPrimary: true }).catch(
        () => undefined,
      );
    }
    throw "The session was deleted while its projects were being linked";
  }
  if (added.length === 0) {
    throw failed.map((f) => f.error).join("\n");
  }

  return { session: { ...current }, failed };
}
