import { z } from "zod";

/** Which level of the cascade decided a worktree location. */
export const WorktreeRootSource = z.enum([
  "app",
  "automation_app",
  "automation_project",
  "default",
  "project",
]);
export type WorktreeRootSource = z.infer<typeof WorktreeRootSource>;

/** Who a worktree is for. Automations can be pointed at a separate drive. */
export const WorktreePurpose = z.enum(["automation", "user"]);
export type WorktreePurpose = z.infer<typeof WorktreePurpose>;

const VolumeState = z.enum(["available", "unavailable"]);

/** Where a project's worktrees live, and whether that drive is connected. */
export const WorktreeStorage = z.object({
  /** Base dir set app-wide, if any. */
  app_base: z.string().nullable(),
  /** Base dir set for this project, if any. Personal, never checked in. */
  project_base: z.string().nullable(),
  /** Automation base dir set app-wide, if any. */
  automation_app_base: z.string().nullable(),
  /** Automation base dir set for this project, if any. */
  automation_project_base: z.string().nullable(),
  /** The base dir used when neither is set. */
  default_base: z.string(),
  /** Absolute dir holding this project's worktrees right now. */
  root: z.string(),
  source: WorktreeRootSource,
  state: VolumeState,
  /** Mount point the root depends on; null when it is on the internal disk. */
  volume: z.string().nullable(),
  volume_label: z.string().nullable(),
  /** The same four, for worktrees automations open. Equal to the above when
   * no automation base is set. */
  automation_root: z.string(),
  automation_source: WorktreeRootSource,
  automation_state: VolumeState,
  automation_volume: z.string().nullable(),
  automation_volume_label: z.string().nullable(),
});
export type WorktreeStorage = z.infer<typeof WorktreeStorage>;

/** Result of checking a candidate worktree location before saving it. */
export const WorktreeLocationProbe = z.object({
  exists: z.boolean(),
  /** Set when the path can't be used, phrased for the user. */
  reason: z.string().nullable(),
  /** True when the path is on a drive that can be disconnected. */
  removable: z.boolean(),
  volume: z.string().nullable(),
  volume_label: z.string().nullable(),
  writable: z.boolean(),
});
export type WorktreeLocationProbe = z.infer<typeof WorktreeLocationProbe>;

export const MoveBlockerKind = z.enum([
  "agent_running",
  "locked",
  "mid_operation",
  "terminal_open",
]);
export type MoveBlockerKind = z.infer<typeof MoveBlockerKind>;

export const MoveBlocker = z.object({
  detail: z.string(),
  kind: MoveBlockerKind,
  session_id: z.string(),
  session_label: z.string(),
});
export type MoveBlocker = z.infer<typeof MoveBlocker>;

/** What a worktree relocation would do, and what is standing in its way. */
export const MoveWorktreesPlan = z.object({
  blockers: z.array(MoveBlocker),
  from_root: z.string(),
  sessions: z.array(
    z.object({
      branch: z.string(),
      from: z.string(),
      id: z.string(),
      to: z.string(),
    }),
  ),
  to_root: z.string(),
});
export type MoveWorktreesPlan = z.infer<typeof MoveWorktreesPlan>;

export const MoveWorktreesResult = z.object({
  failed: z.array(z.object({ error: z.string(), id: z.string() })),
  moved: z.array(z.string()),
  to_root: z.string(),
});
export type MoveWorktreesResult = z.infer<typeof MoveWorktreesResult>;
