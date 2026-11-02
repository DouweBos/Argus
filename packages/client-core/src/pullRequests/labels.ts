/**
 * How a PR's reasons, review state, checks and merge strategies read — the TS
 * twin of ArgusUI's `PullRequestLabels` and ArgusKit's check tones, so every
 * client says the same thing about the same PR.
 */

/** A tone every client has; the names match Peacock badge tones. */
export type PrTone = "accent" | "error" | "neutral" | "success" | "warning";

export type PrCheckTone = Exclude<PrTone, "accent">;

export function reasonLabel(reason: string): string {
  switch (reason) {
    case "author":
      return "Author";
    case "reviewer":
      return "Reviewer";
    case "team":
      return "Team review";
    case "commenter":
      return "Commented";
    case "mentioned":
      return "Mentioned";
    default:
      return reason.charAt(0).toUpperCase() + reason.slice(1);
  }
}

export function reasonTone(reason: string): PrTone {
  if (reason === "author") {
    return "accent";
  }

  return reason === "reviewer" || reason === "team" ? "success" : "neutral";
}

export function reviewDecisionLabel(
  decision: string | null | undefined,
): { label: string; tone: PrTone } | null {
  switch (decision) {
    case "APPROVED":
      return { label: "Approved", tone: "success" };
    case "CHANGES_REQUESTED":
      return { label: "Changes requested", tone: "error" };
    case "REVIEW_REQUIRED":
      return { label: "Review required", tone: "warning" };
    default:
      return null;
  }
}

/** A review entry's verdict, as the conversation shows it. */
export function reviewStateLabel(state: string | null | undefined): string {
  switch (state) {
    case "APPROVED":
      return "Approved";
    case "CHANGES_REQUESTED":
      return "Requested changes";
    case "DISMISSED":
      return "Review dismissed";
    case null:
    case undefined:
    case "":
    case "COMMENTED":
      return "Commented";
    default:
      return "Reviewed";
  }
}

export interface PrStateInput {
  isDraft: boolean;
  merged: boolean;
  state: string;
}

export function prStateLabel(pr: PrStateInput): {
  label: string;
  tone: PrTone;
} {
  if (pr.merged) {
    return { label: "Merged", tone: "accent" };
  }
  if (pr.state === "CLOSED") {
    return { label: "Closed", tone: "error" };
  }

  return pr.isDraft
    ? { label: "Draft", tone: "neutral" }
    : { label: "Open", tone: "success" };
}

/** A check's state from GitHub's conclusion and status words, either case. */
export function checkTone(
  conclusion: string | null | undefined,
  status: string | null | undefined,
): PrCheckTone {
  switch (conclusion?.toLowerCase()) {
    case "success":
    case "neutral":
    case "skipped":
      return "success";
    case "failure":
    case "timed_out":
    case "startup_failure":
    case "action_required":
      return "error";
    case "cancelled":
    case "stale":
      return "neutral";
    default:
      return status?.toLowerCase() === "completed" ? "neutral" : "warning";
  }
}

export interface ChecksSummary {
  failed: number;
  passed: number;
  pending: number;
  /** "All checks have passed", "2 checks failing", … */
  title: string;
  tone: "error" | "success" | "warning";
  total: number;
}

export function checksSummary(
  checks: readonly {
    conclusion: string | null | undefined;
    status: string | null | undefined;
  }[],
): ChecksSummary | null {
  if (checks.length === 0) {
    return null;
  }
  const tones = checks.map((c) => checkTone(c.conclusion, c.status));
  const passed = tones.filter((t) => t === "success").length;
  const failed = tones.filter((t) => t === "error").length;
  const pending = tones.filter((t) => t === "warning").length;
  const plural = (n: number) => (n === 1 ? "check" : "checks");
  if (failed > 0) {
    return {
      failed,
      passed,
      pending,
      title: `${failed} ${plural(failed)} failing`,
      tone: "error",
      total: checks.length,
    };
  }
  if (pending > 0) {
    return {
      failed,
      passed,
      pending,
      title: `${pending} ${plural(pending)} in progress`,
      tone: "warning",
      total: checks.length,
    };
  }

  return {
    failed,
    passed,
    pending,
    title: "All checks have passed",
    tone: "success",
    total: checks.length,
  };
}

export type PrMergeStrategy = "merge" | "rebase" | "squash";

/** Split-button order: the usual pick first. */
export const PR_MERGE_STRATEGIES: PrMergeStrategy[] = [
  "squash",
  "merge",
  "rebase",
];

/** Where every app remembers the last strategy used (ArgusKit's key too). */
export const PR_MERGE_STRATEGY_KEY = "pullRequestMergeStrategy";

export function prMergeStrategyLabel(strategy: PrMergeStrategy): string {
  switch (strategy) {
    case "squash":
      return "Squash and merge";
    case "merge":
      return "Create a merge commit";
    case "rebase":
      return "Rebase and merge";
  }
}

export function parsePrMergeStrategy(
  raw: string | null | undefined,
): PrMergeStrategy {
  return raw === "merge" || raw === "rebase" ? raw : "squash";
}

/** `gh` missing or signed out is the usual failure; say how to fix it. */
export function explainPullRequestError(error: string): string {
  const lower = error.toLowerCase();
  if (
    lower.includes("enoent") ||
    (lower.includes("not found") && lower.includes("gh"))
  ) {
    return "The GitHub CLI (gh) is required. Install it and run `gh auth login`, then try again.";
  }
  if (
    lower.includes("auth login") ||
    lower.includes("not logged") ||
    lower.includes("authenticat")
  ) {
    return "The GitHub CLI isn't signed in. Run `gh auth login`, then try again.";
  }

  return error;
}

/** `https://github.com/owner/repo/pull/12` → its parts; null for anything else. */
export function parsePullRequestUrl(
  url: string,
): { number: number; owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) {
    return null;
  }

  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

/** "just now", "5 min ago", "3h ago", "2d ago", "4mo ago", "1y ago". */
export function relativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!iso || Number.isNaN(then)) {
    return "";
  }

  return relativeTimeMs(then, now);
}

export function relativeTimeMs(then: number, now = Date.now()): string {
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 60) {
    return "just now";
  }
  const min = Math.round(sec / 60);
  if (min < 60) {
    return `${min} min ago`;
  }
  const hr = Math.round(min / 60);
  if (hr < 24) {
    return `${hr}h ago`;
  }
  const days = Math.round(hr / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  const months = Math.round(days / 30);
  if (months < 12) {
    return `${months}mo ago`;
  }

  return `${Math.round(months / 12)}y ago`;
}
