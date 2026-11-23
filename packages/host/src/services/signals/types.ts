/**
 * The signal layer: what work exists, normalized away from wherever it came
 * from.
 *
 * A source is either Node code (`native` — Argus fetches it and serializes it
 * into the run's prompt) or a paragraph (`agent` — the source contributes
 * instructions and the run's agent fetches it through its own MCP tools). That
 * split is the point: adding Jira or Sentry is a config change, not a project.
 */

/** One piece of work, however it was discovered. */
export interface WorkItem {
  /** Id of the source that produced this item, e.g. `"github"`. */
  source_id: string;
  /** Stable id within the source: `"acme/app#412"`, `"ENG-123"`. */
  external_id: string;
  url: string;
  title: string;
  body: string;
  state: string;
  assignee: string | null;
  labels: string[];
  priority: number | null;
  /** Epoch ms. */
  updated_at: number;
  kind: "issue" | "pull_request" | "task";
  /** Local checkout this item maps to, resolved against known projects. */
  repo_root: string | null;
}

/** Something that happened to a work item, as a signal trigger reacts to it. */
export type SignalEventKind =
  | "assigned"
  | "ci_failed"
  | "mentioned"
  | "new_issue"
  | "new_pr"
  | "review_requested";

export const SIGNAL_EVENT_KINDS: readonly SignalEventKind[] = [
  "new_issue",
  "new_pr",
  "assigned",
  "review_requested",
  "ci_failed",
  "mentioned",
];

/**
 * One event. Present-tense on purpose: a source reports what is true now (this
 * PR is red, this comment mentions you) and the watcher fires on keys it has
 * not seen before, so sources stay stateless.
 */
export interface SignalEvent {
  kind: SignalEventKind;
  /** Same key on the next poll means the same event; a new key fires again. */
  key: string;
  item: WorkItem;
  /** Why it fired, beyond the item: the red checks, the mentioning comment. */
  detail: SignalEventDetail;
}

export interface SignalEventDetail {
  failing_checks?: { name: string; url: string | null; log_tail?: string }[];
  comment?: { author: string; body: string; url: string };
}

export interface SignalSource {
  id: string;
  label: string;
  /** "native" = Node fetches it. "agent" = the run's agent fetches it via MCP. */
  mode: "agent" | "native";
  isAvailable: () => Promise<boolean>;
  /** native sources only */
  fetchAssigned?: (opts: { repoRoots: string[] }) => Promise<WorkItem[]>;
  /** Event kinds this source can watch for. Native sources only. */
  events?: readonly SignalEventKind[];
  /** What is true now for `kinds`; scoped repos bound `new_issue` / `new_pr`. */
  fetchEvents?: (opts: {
    kinds: SignalEventKind[];
    repoRoots: string[];
  }) => Promise<SignalEvent[]>;
  /** Fill in the expensive part (a failing job's log) for an event about to fire. */
  enrichEvent?: (event: SignalEvent) => Promise<SignalEvent>;
  /** agent sources only — instructions injected into the playbook prompt */
  agentInstructions?: () => string;
}
