/**
 * OrgTask — one user-initiated cross-repo task that fans out to every selected
 * member repo of an organization. Each member gets its own workspace + agent;
 * agents share the task prompt and know about each other via the organization
 * context prompt.
 */

export type OrgTaskStatus = "running" | "completed" | "failed" | "cancelled";

export type OrgTaskMemberStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export interface OrgTaskMember {
  /** Absolute path to the member's repo root. */
  repo_root: string;
  /** Copy of the org member's role at task-creation time. */
  role: string;
  /** Workspace created for this member (null until workspace is set up). */
  workspace_id: string | null;
  /** Agent spawned in that workspace (null until spawned). */
  agent_id: string | null;
  /** Optional per-member extra instructions appended to the shared prompt. */
  addendum: string;
  /** Per-member lifecycle state. */
  status: OrgTaskMemberStatus;
}

export interface OrgTask {
  /** Stable UUID. */
  id: string;
  /** Parent organization. */
  organization_id: string;
  /** Short label ("Add favorites list"). */
  title: string;
  /** Shared prompt injected into every member agent. */
  prompt: string;
  /** Overall task status. */
  status: OrgTaskStatus;
  /** Unix ms. */
  created_at: number;
  /** Unix ms. */
  updated_at: number;
  /** One entry per selected member repo. */
  members: OrgTaskMember[];
}

/** IPC payload for the create call. */
export interface StartOrgTaskInput {
  organizationId: string;
  title: string;
  prompt: string;
  members: { repo_root: string; addendum?: string }[];
}
