/**
 * OrgTask — one user-initiated cross-repo task. A single "host" agent runs in
 * a neutral workspace (not a worktree of any scope repo) and orchestrates
 * child agents into per-repo worktrees on demand via the Argus MCP tools.
 */

export type OrgTaskStatus = "cancelled" | "completed" | "failed" | "running";

export interface OrgTaskScopeEntry {
  /** Absolute path to the scope repo's root. */
  repo_root: string;
  /** Copy of the org member's role at task-creation time. */
  role: string;
}

export interface OrgTask {
  id: string;
  organization_id: string;
  title: string;
  prompt: string;
  status: OrgTaskStatus;
  created_at: number;
  updated_at: number;

  /** Neutral workspace (kind: "org_host") hosting the lone agent. Null until created. */
  host_workspace_id: string | null;
  /** Agent running in the host workspace. Null until spawned. */
  host_agent_id: string | null;
  /** All in-scope repos (information for the agent; not a fan-out list). */
  scope: OrgTaskScopeEntry[];
}

/** IPC payload for the create call. */
export interface StartOrgTaskInput {
  organizationId: string;
  title: string;
  prompt: string;
  scope: { repo_root: string }[];
}
