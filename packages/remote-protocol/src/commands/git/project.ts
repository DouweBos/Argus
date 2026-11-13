import { z } from "zod";
import {
  ArgusConfig,
  MoveWorktreesPlan,
  ProjectConfig,
  MoveWorktreesResult,
  PushSessionBranchResult,
  ReleaseNotePatternConfig,
  ReleaseNotesPreview,
  SessionReleaseNotesResult,
  UserProjectSettings,
  WorktreeLocationProbe,
  WorktreePurpose,
  WorktreeStorage,
} from "../../models/git";
import { LandStackResult, RestackResult } from "../../models/sessions";
import { type CommandSpec, NoParams, Void } from "../spec";
import { RepoRoot, SessionId } from "./shared";

const WorktreesMove = RepoRoot.extend({
  toBaseDir: z.string(),
  purpose: WorktreePurpose.optional(),
});

export const GIT_PROJECT_COMMANDS = {
  /** The effective config: the checked-in `.argus.json` with the host's layer merged over it. */
  read_argus_config: { tier: "admin", params: RepoRoot, result: ArgusConfig },
  get_project_config: {
    tier: "admin",
    params: RepoRoot,
    result: ProjectConfig,
  },
  /** Stores `config`'s values for `keys` (the ones the user edited) and for keys already stored. Never writes the repo. */
  save_project_config: {
    tier: "admin",
    params: RepoRoot.extend({
      config: z.record(z.string(), z.unknown()),
      keys: z.array(z.string()),
    }),
    result: ProjectConfig,
  },
  /** The effective config as `.argus.json` text. */
  export_project_config: {
    tier: "admin",
    params: RepoRoot,
    result: z.string(),
  },
  /** Validates `.argus.json` text and replaces the host's layer with every key in it. */
  import_project_config: {
    tier: "admin",
    params: RepoRoot.extend({ content: z.string() }),
    result: ProjectConfig,
  },
  get_user_project_settings: {
    tier: "admin",
    params: RepoRoot,
    result: UserProjectSettings,
  },
  set_user_project_settings: {
    tier: "admin",
    params: RepoRoot.extend({ settings: UserProjectSettings }),
    result: UserProjectSettings,
  },
  /** What relocating a project's worktrees would move, and what blocks it. */
  plan_worktrees_move: {
    tier: "admin",
    params: WorktreesMove,
    result: MoveWorktreesPlan,
  },
  move_worktrees: {
    tier: "admin",
    params: WorktreesMove,
    result: MoveWorktreesResult,
  },
  get_worktrees_default_base: {
    tier: "admin",
    params: NoParams,
    result: z.string(),
  },
  get_worktree_storage: {
    tier: "admin",
    params: RepoRoot,
    result: WorktreeStorage,
  },
  /** Validates a candidate worktree base; never creates anything. */
  probe_worktree_location: {
    tier: "admin",
    params: z.object({
      baseDir: z.string(),
      repoRoot: z.string().optional(),
    }),
    result: WorktreeLocationProbe,
  },
  /** Slash-command popularity for a project, by command name. */
  get_command_metrics: {
    tier: "admin",
    params: RepoRoot,
    result: z.record(z.string(), z.number()),
  },
  /** Re-arms auto-fetch after `auto_fetch_minutes` changes in `.argus.json`. */
  git_reconfigure_auto_fetch: {
    tier: "admin",
    params: RepoRoot.extend({ minutes: z.number().nullable() }),
    result: Void,
  },
  set_session_base_branch: {
    tier: "admin",
    params: SessionId.extend({ baseBranch: z.string() }),
    result: Void,
  },
  get_session_conflicts: {
    tier: "admin",
    params: SessionId,
    result: z.array(z.string()),
  },
  get_session_merge_blockers: {
    tier: "admin",
    params: SessionId,
    result: z.array(z.string()),
  },
  get_session_release_notes: {
    tier: "admin",
    params: SessionId,
    result: SessionReleaseNotesResult,
  },
  preview_release_notes: {
    tier: "admin",
    params: RepoRoot.extend({ patterns: z.array(ReleaseNotePatternConfig) }),
    result: ReleaseNotesPreview,
  },
  get_session_commits_ahead: {
    tier: "admin",
    params: SessionId,
    result: z.number(),
  },
  get_session_commits_behind: {
    tier: "admin",
    params: SessionId,
    result: z.number(),
  },
  merge_session_into_base: {
    tier: "admin",
    params: SessionId.extend({
      strategy: z.enum(["keep", "squash"]).default("squash"),
    }),
    result: Void,
  },
  rebase_session_on_base: { tier: "admin", params: SessionId, result: Void },
  /** Rebase the sessions stacked in this one's stack onto their parents, and push their PRs. */
  restack_session: { tier: "admin", params: SessionId, result: RestackResult },
  /** Merge the stack bottom-up, moving each session onto the landed base. */
  land_stack: {
    tier: "admin",
    params: SessionId.extend({
      strategy: z.enum(["keep", "squash"]).default("squash"),
    }),
    result: LandStackResult,
  },
  push_session_branch: {
    tier: "admin",
    params: SessionId,
    result: PushSessionBranchResult,
  },
} as const satisfies Record<string, CommandSpec>;
