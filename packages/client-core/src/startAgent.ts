/**
 * What a start composer offers and how its start goes out: the twin of
 * ArgusUI's `PhoneAgentStart` and ArgusCore's `HostStore+StartAgent`.
 */

import type {
  GatewayParams,
  RemotePermissionMode,
} from "@argus/remote-protocol";

/** Where the agent works: the checkout in front of you, a new worktree, or a branch that already exists. */
export type StartWorkspace = "current" | "existing" | "worktree";

export interface StartContext {
  /** The session "current" means; absent when the composer opened on a project. */
  sessionId: string | null;
  /** The project a new worktree lands in; absent for a scratch pad. */
  repoRoot: string | null;
}

/** The workspaces a composer can pick between. */
export function workspaceOptions(context: StartContext): StartWorkspace[] {
  return [
    ...(context.sessionId ? (["current"] as const) : []),
    ...(context.repoRoot ? (["worktree", "existing"] as const) : []),
  ];
}

/** With no session there's no "current"; with no project, nothing else. */
export function initialWorkspace(
  context: StartContext,
  preferred: StartWorkspace,
): StartWorkspace {
  if (!context.sessionId) {
    return "worktree";
  }

  return context.repoRoot ? preferred : "current";
}

export interface StartDraft {
  workspace: StartWorkspace;
  /** What the agent is sent, linked-projects preamble included. */
  message: string;
  /** What the clients show, when it differs from `message`. */
  displayText: string;
  images: { data: string; media_type: string }[];
  model: string | null;
  permissionMode: RemotePermissionMode | null;
  effort: string | null;
  runnerId: string | null;
  baseBranch: string | null;
  existingBranch: string | null;
}

/** Whether the start can go: a worktree is named from the prompt, an existing branch must be picked. */
export function canStart(draft: StartDraft, context: StartContext): boolean {
  const hasText = draft.displayText.trim().length > 0;
  switch (draft.workspace) {
    case "current":
      return !!context.sessionId && (hasText || draft.images.length > 0);
    case "worktree":
      return !!context.repoRoot && hasText;
    case "existing":
      return !!context.repoRoot && !!draft.existingBranch;
  }
}

/**
 * Text alone rides the new session's own prompt, which the host starts once
 * setup finishes; images and effort can't, so the client starts that agent.
 */
export function hostStartsWorktree(draft: StartDraft): boolean {
  return draft.images.length === 0 && draft.effort === null;
}

/** `sessions.create` for a new worktree (or an existing branch) with the draft's agent. */
export function worktreeParams(
  draft: StartDraft,
  repoRoot: string,
): GatewayParams<"sessions.create"> {
  const existing = draft.workspace === "existing" ? draft.existingBranch : null;
  const hostStarts = hostStartsWorktree(draft);

  return {
    repo_root: repoRoot,
    branch: existing ?? "",
    description: draft.displayText.trim(),
    ...(existing ? { use_existing_branch: true } : {}),
    ...(!existing && draft.baseBranch ? { base_branch: draft.baseBranch } : {}),
    ...(hostStarts && draft.message.trim() ? { prompt: draft.message } : {}),
    ...(draft.model ? { model: draft.model } : {}),
    ...(draft.permissionMode ? { permission_mode: draft.permissionMode } : {}),
    ...(draft.runnerId ? { runner_id: draft.runnerId } : {}),
  };
}

/** `agents.spawn` for the draft's agent in a session. */
export function spawnParams(
  draft: Pick<StartDraft, "model" | "permissionMode" | "runnerId">,
  sessionId: string,
): GatewayParams<"agents.spawn"> {
  return {
    session_id: sessionId,
    ...(draft.model ? { model: draft.model } : {}),
    ...(draft.permissionMode ? { permission_mode: draft.permissionMode } : {}),
    ...(draft.runnerId ? { runner_id: draft.runnerId } : {}),
  };
}

/** The permission modes the gateway can start an agent in; `trusted` is fixed at launch on the computer. */
export const REMOTE_PERMISSION_MODES: RemotePermissionMode[] = [
  "auto",
  "ask",
  "plan",
  "review",
];

/** A saved chat's (or agent's) mode, if the gateway can spawn in it. */
export function spawnableMode(
  mode: string | null | undefined,
): RemotePermissionMode | null {
  return REMOTE_PERMISSION_MODES.find((m) => m === mode) ?? null;
}
