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
  /** Stable id within the source: `"plexinc/app#412"`, `"ENG-123"`. */
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

export interface SignalSource {
  id: string;
  label: string;
  /** "native" = Node fetches it. "agent" = the run's agent fetches it via MCP. */
  mode: "agent" | "native";
  isAvailable: () => Promise<boolean>;
  /** native sources only */
  fetchAssigned?: (opts: { repoRoots: string[] }) => Promise<WorkItem[]>;
  /** agent sources only — instructions injected into the playbook prompt */
  agentInstructions?: () => string;
}
