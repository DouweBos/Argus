/**
 * Activity event types surfaced on the Activity screen. These are normalized
 * representations of various backend signals (agent lifecycle, session
 * lifecycle, git commits, device state) and are kept in an in-memory capped
 * ring in `activityStore`.
 */

export type ActivityKind =
  | "agent_errored"
  | "agent_spawned"
  | "agent_stopped"
  | "commit_landed"
  | "device_offline"
  | "device_online"
  | "session_created"
  | "session_deleted"
  | "session_merged";

export interface ActivityEvent {
  /** Agent involved, if applicable. */
  agentId?: string;
  /** Branch name (for commit/merge/session events). */
  branch?: string;
  /** Optional secondary line (e.g. commit subject, merge target). */
  detail?: string;
  id: string;
  kind: ActivityKind;
  /** Repo root this event belongs to, if applicable. */
  repoRoot?: string;
  /** Session the event belongs to, if applicable. */
  sessionId?: string;
  /** Short human-readable title. */
  title: string;
  /** Epoch milliseconds. */
  ts: number;
}
