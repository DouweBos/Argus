import { z } from "zod";
import { AgentInfo } from "./agents";
import { DesignRef, LinkedIssue } from "./integrations";

/**
 * What a session is backed by: a git worktree, the repo root itself, or — for
 * an automation run or a scratch pad — a neutral directory that is not a
 * checkout at all.
 */
export const SessionKind = z.enum([
  "automation_host",
  "project_root",
  "scratch_pad",
  "worktree",
]);
export type SessionKind = z.infer<typeof SessionKind>;

/** Lifecycle state of a session. */
export const SessionStatus = z.union([
  z.enum(["deleting", "initializing", "ready"]),
  z.object({ error: z.string() }),
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

/** Where a session's pull request stands on GitHub. */
export const SessionPullRequestState = z.enum([
  "closed",
  "draft",
  "merged",
  "open",
]);
export type SessionPullRequestState = z.infer<typeof SessionPullRequestState>;

/** The newest GitHub pull request whose head is the session's branch. */
export const SessionPullRequest = z.object({
  number: z.number(),
  state: SessionPullRequestState,
  url: z.string(),
});
export type SessionPullRequest = z.infer<typeof SessionPullRequest>;

/**
 * One slot of a compare run: the same prompt started on several runners or
 * models at once, one session each, grouped under `id`.
 */
export const SessionCompareGroup = z.object({
  id: z.string(),
  /** 0-based position, so the slots keep the order they were picked in. */
  slot: z.number().int().nonnegative(),
  runner_id: z.string().nullable(),
  model: z.string().nullable(),
  effort: z.string().nullable(),
});
export type SessionCompareGroup = z.infer<typeof SessionCompareGroup>;

/** A single session backed by a git worktree or the repo root. */
export const Session = z.object({
  /**
   * Whether the session's files are reachable right now. Orthogonal to
   * `status`: a session can be mid-setup *and* on a drive that just got
   * unplugged, and it has to come back as whatever it was. Absent means
   * available, so anything that predates this field reads correctly.
   */
  availability: z.enum(["available", "unavailable"]).optional(),
  /** The branch this session was created from (e.g. "main"). */
  base_branch: z.string().nullish(),
  /** The feature branch checked out in this worktree. */
  branch: z.string(),
  /**
   * Claude account this session's agents and terminals authenticate as. `null`
   * follows the app-wide active account. Lets two sessions run in parallel on
   * different accounts.
   */
  claude_account_id: z.string().nullish(),
  /** Set while the session is one slot of a compare run. */
  compare_group: SessionCompareGroup.nullish(),
  /** Optional human-readable description for the UI. */
  description: z.string(),
  /** Original display name as entered by the user. Shown in the UI when present. */
  display_name: z.string().nullish(),
  /** Sequential index assigned at creation time. Only set for non-root sessions. */
  env_index: z.number().nullish(),
  /** Stable UUID used as the key in `appState.sessions`. */
  id: z.string(),
  kind: SessionKind,
  /** Figma frames the session's work should match. */
  design_refs: z.array(DesignRef).nullish(),
  /**
   * A worktree made outside Argus and adopted from disk: the project's setup
   * never ran in it. Cleared once setup runs or the user marks it ready.
   */
  setup_pending: z.boolean().optional(),
  /** The tracker issue the session was started from. */
  linked_issue: LinkedIssue.nullish(),
  /**
   * Default model id (runner-specific shape) for agents spawned in this
   * session. `null` lets the cascade fall through to the project default,
   * app default, then runner default.
   */
  model: z.string().nullish(),
  /** Absolute path to the worktree root on disk. */
  path: z.string(),
  /**
   * The branch's pull request on GitHub. Null when it has none or the lookup
   * isn't possible (no `gh`, signed out, not a GitHub remote).
   */
  pull_request: SessionPullRequest.nullish(),
  /** An agent is woken when this PR's checks fail or pass, it conflicts, or someone comments. */
  pull_request_watched: z.boolean().optional(),
  /** Absolute path to the repository root this session belongs to. */
  repo_root: z.string(),
  /**
   * Default LLM runner for agents spawned in this session (e.g.
   * `"claude-code"`). Legacy sessions without it read as `"claude-code"`.
   */
  runner_id: z.string().nullish(),
  /**
   * Transient terminal id for the setup pipeline's PTY, only present on the
   * `create_session` response so a Setup tab can attach synchronously.
   */
  setup_terminal_id: z.string().nullish(),
  status: SessionStatus,
  /** Why it is unreachable. Only set when `availability` is "unavailable". */
  unavailable_reason: z.literal("volume_missing").optional(),
  /** Which step of the last delete failed, while `status` is an error. */
  delete_failed: z.enum(["remove", "teardown"]).nullish(),
  /** Mount point the session lives on, for the message naming the drive. */
  unavailable_volume: z.string().nullish(),
  /** Mount point of the external drive holding the session; null on the boot volume. */
  volume: z.string().nullish(),
});
export type Session = z.infer<typeof Session>;

/** A project the host knows about: a registered repo root or a related project. */
export const ProjectEntry = z.object({
  description: z.string(),
  path: z.string(),
  registered: z.boolean(),
  source: z.string(),
});
export type ProjectEntry = z.infer<typeof ProjectEntry>;

/**
 * One snapshot of everything the host is running. A client attaching over the
 * gateway rebuilds from this on connect; local IPC never drops, so it never
 * needs it.
 */
export const HostSnapshot = z.object({
  agents: z.array(AgentInfo),
  projects: z.array(ProjectEntry),
  sessions: z.array(Session),
});
export type HostSnapshot = z.infer<typeof HostSnapshot>;

/** A file edit replayed onto a forked worktree to rewind it to a message. */
export const ForkReplayOp = z.discriminatedUnion("type", [
  z.object({
    content: z.string(),
    filePath: z.string(),
    timestampMs: z.number(),
    type: z.literal("write"),
  }),
  z.object({
    edits: z.array(
      z.object({
        newString: z.string(),
        oldString: z.string(),
        replaceAll: z.boolean().optional(),
      }),
    ),
    filePath: z.string(),
    timestampMs: z.number(),
    type: z.literal("multiEdit"),
  }),
  z.object({
    filePath: z.string(),
    newString: z.string(),
    oldString: z.string(),
    replaceAll: z.boolean().optional(),
    timestampMs: z.number(),
    type: z.literal("edit"),
  }),
]);
export type ForkReplayOp = z.infer<typeof ForkReplayOp>;

export const ForkChatResult = z.object({
  /** New Claude CLI session id for `--resume` (null when no source JSONL was truncated). */
  claude_session_id: z.string().nullable(),
});
export type ForkChatResult = z.infer<typeof ForkChatResult>;

export const ForkSessionResult = ForkChatResult.extend({ session: Session });
export type ForkSessionResult = z.infer<typeof ForkSessionResult>;

/** A directory the Claude Code CLI has chats for, offered as a project to add. */
export const CliProjectCandidate = z.object({
  path: z.string(),
  name: z.string(),
  chat_count: z.number(),
  /** Unix ms of the newest chat there. */
  last_active_at: z.number(),
  /** Already one of this host's projects. */
  added: z.boolean(),
});
export type CliProjectCandidate = z.infer<typeof CliProjectCandidate>;

/** Where a Claude Code CLI project scan or import was started. */
export const CliProjectImportSource = z.enum(["dialog", "onboarding"]);
export type CliProjectImportSource = z.infer<typeof CliProjectImportSource>;

export const CliProjectScan = z.object({
  candidates: z.array(CliProjectCandidate),
  /** The newest transcripts were read; older projects may be missing. */
  truncated: z.boolean(),
});
export type CliProjectScan = z.infer<typeof CliProjectScan>;

/** Why a worktree would be cleaned up. `over_cap` is the disk cap evicting the least recently used. */
export const WorktreeCleanupReason = z.enum(["idle", "landed", "over_cap"]);
export type WorktreeCleanupReason = z.infer<typeof WorktreeCleanupReason>;

/** What keeps a worktree that would otherwise go. */
export const WorktreeCleanupGuard = z.enum([
  "agent_running",
  "uncommitted",
  "unpushed",
  "unreadable",
]);
export type WorktreeCleanupGuard = z.infer<typeof WorktreeCleanupGuard>;

/** The policy, from app settings with defaults applied. Zero turns a rule off. */
export const WorktreeCleanupPolicy = z.object({
  /** Run the sweep on a schedule. "Clean up now" works either way. */
  enabled: z.boolean(),
  /** Days after a session merged, or its pull request closed. */
  landed_days: z.number().int().nonnegative(),
  /** Days without a commit or agent activity. */
  idle_days: z.number().int().nonnegative(),
  /** Total worktree size to stay under, in GB. */
  max_gb: z.number().nonnegative(),
});
export type WorktreeCleanupPolicy = z.infer<typeof WorktreeCleanupPolicy>;

export const WorktreeCleanupEntry = z.object({
  session_id: z.string(),
  repo_root: z.string(),
  project_name: z.string(),
  branch: z.string(),
  display_name: z.string().nullable(),
  /** Size on disk; null when it couldn't be measured. */
  bytes: z.number().nullable(),
  /** Epoch ms of the last commit or agent activity. */
  last_activity_at: z.number(),
  /** Epoch ms it was first seen merged or its pull request closed. */
  landed_at: z.number().nullable(),
  reason: WorktreeCleanupReason,
  /** Set when a guard keeps it; such an entry is never removed. */
  blocked_by: WorktreeCleanupGuard.nullable(),
});
export type WorktreeCleanupEntry = z.infer<typeof WorktreeCleanupEntry>;

export const WorktreeCleanupSweep = z.object({
  at: z.number(),
  trigger: z.enum(["manual", "scheduled"]),
  removed: z.array(WorktreeCleanupEntry),
  freed_bytes: z.number(),
  /** Removals that were attempted and failed. */
  failed: z.number().int().nonnegative(),
});
export type WorktreeCleanupSweep = z.infer<typeof WorktreeCleanupSweep>;

/** A dry run: what the policy would remove right now, and what it keeps. */
export const WorktreeCleanupPreview = z.object({
  policy: WorktreeCleanupPolicy,
  entries: z.array(WorktreeCleanupEntry),
  /** Size of every worktree session, removable or not. */
  total_bytes: z.number(),
  last_sweep: WorktreeCleanupSweep.nullable(),
});
export type WorktreeCleanupPreview = z.infer<typeof WorktreeCleanupPreview>;
