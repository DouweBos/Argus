/**
 * `list_sessions` and `refresh_sessions`: a project's sessions as agents see
 * them. Both list from disk, so a worktree made with `git worktree add` becomes
 * a session (adopted) the moment either is called.
 */

import type { SessionListTrigger } from "../../telemetryEvents";
import type { Session } from "../session/models";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listSessions } from "../session/manager";

type ResolveRepoRoot = (projectPath: string | undefined) => string;

const projectPath = z
  .string()
  .optional()
  .describe(
    "Absolute path to the project root. Defaults to the first registered project.",
  );

export function sessionSummaries(sessions: Session[]) {
  return sessions.map((ws) => ({
    session_id: ws.id,
    kind: ws.kind,
    branch: ws.branch,
    display_name: ws.display_name,
    description: ws.description,
    path: ws.path,
    status: ws.status,
    base_branch: ws.base_branch,
  }));
}

async function listed(
  project_path: string | undefined,
  resolveRepoRoot: ResolveRepoRoot,
  trigger: SessionListTrigger,
) {
  const sessions = await listSessions(resolveRepoRoot(project_path), trigger);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(sessionSummaries(sessions), null, 2),
      },
    ],
  };
}

export function registerSessionListTools(
  server: McpServer,
  resolveRepoRoot: ResolveRepoRoot,
): void {
  server.tool(
    "list_sessions",
    'List all sessions for a project. Exactly one has `kind: "project_root"` — that is the checkout the user has open, always `ready`, and addressable as `"root"` in any tool taking a `session`; the rest are worktrees. Returns session IDs, branches, paths, and statuses. The `status` field is `"initializing"` while `git worktree add` and the project\'s setup pipeline run, `"ready"` once provisioning completes, or an error object if setup failed. Sessions in `initializing` cannot host agents yet — spawning into them is queued by `spawn_agent`/`spawn_agents_batch` until ready, so freshly-created sessions may legitimately show no agents in `list_agents` for several seconds (or longer if dependency installs are running).',
    { project_path: projectPath },
    async ({ project_path }) =>
      listed(project_path, resolveRepoRoot, "listing"),
  );

  server.tool(
    "refresh_sessions",
    "Rescan a project's git worktrees and return its sessions, adopting any made outside Argus. Call it right after creating a worktree yourself (`git worktree add`): the new worktree is then a session you can address by branch, id or path — e.g. to `trigger_run` its run commands — without waiting for Argus to notice it. The apps show it straight away too. Any tool taking a `session` also rescans once when it doesn't recognise the name, so this is mainly for seeing the list.",
    { project_path: projectPath },
    async ({ project_path }) =>
      listed(project_path, resolveRepoRoot, "mcp_refresh"),
  );
}
