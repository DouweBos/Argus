/**
 * What a watched pull request looks like on one poll, and what changed since
 * the last one: the pure half of the PR watch, kept apart from `gh` so the
 * wake rules are testable.
 */

export type CheckBucket = "fail" | "pass" | "pending" | "skip";

export interface WatchedCheck {
  bucket: CheckBucket;
  detailsUrl: string | null;
  /** Failure annotations GitHub attached to the run, `path:line message`. */
  failures: string[];
  name: string;
  required: boolean;
}

export interface WatchedComment {
  author: string | null;
  body: string;
  id: string;
  kind: "comment" | "inline" | "review";
  /** `path:line` for an inline review comment. */
  location?: string;
  /** Review verdict, e.g. `CHANGES_REQUESTED`. */
  reviewState?: string;
  url: string;
}

export interface PrSnapshot {
  checks: WatchedCheck[];
  comments: WatchedComment[];
  headOid: string;
  mergeable: "CONFLICTING" | "MERGEABLE" | "UNKNOWN";
  number: number;
  state: "CLOSED" | "MERGED" | "OPEN";
  url: string;
  /** The signed-in `gh` user; their own comments are the agent's, not news. */
  viewer: string | null;
}

/** What has already been reported, so each thing wakes the agent once. */
export interface WatchMemory {
  /** Head commit a conflict was reported on. */
  conflictOid: string | null;
  /** `oid\0check` for every failure reported. */
  failures: Set<string>;
  /** Head commit the all-green was reported on. */
  greenOid: string | null;
  /** Unset until the first poll seeds it. */
  seenComments: Set<string> | null;
}

export type WatchEvent =
  | { kind: "check_failed"; check: WatchedCheck }
  | { kind: "checks_passed"; count: number }
  | { kind: "comment"; comment: WatchedComment }
  | { kind: "conflict" };

export function emptyMemory(): WatchMemory {
  return {
    conflictOid: null,
    failures: new Set(),
    greenOid: null,
    seenComments: null,
  };
}

/**
 * The checks that gate the merge: the required ones when branch protection
 * names any, otherwise all of them.
 */
function gatingChecks(checks: WatchedCheck[]): WatchedCheck[] {
  const required = checks.filter((c) => c.required);

  return required.length > 0 ? required : checks;
}

export function checksGreen(checks: WatchedCheck[]): boolean {
  const gating = gatingChecks(checks);

  return (
    gating.length > 0 &&
    gating.every((c) => c.bucket === "pass" || c.bucket === "skip")
  );
}

/**
 * What is new in `snap`. The first poll is a baseline for comments and for
 * green — the agent already knows those — but failures and conflicts present
 * then still wake it: they are work waiting to be done.
 */
export function diffSnapshot(
  memory: WatchMemory,
  snap: PrSnapshot,
): WatchEvent[] {
  const events: WatchEvent[] = [];
  const baseline = memory.seenComments === null;

  for (const check of snap.checks) {
    const key = `${snap.headOid}\0${check.name}`;
    if (check.bucket === "fail" && !memory.failures.has(key)) {
      memory.failures.add(key);
      events.push({ kind: "check_failed", check });
    }
  }

  if (checksGreen(snap.checks) && memory.greenOid !== snap.headOid) {
    memory.greenOid = snap.headOid;
    if (!baseline) {
      events.push({
        kind: "checks_passed",
        count: gatingChecks(snap.checks).length,
      });
    }
  }

  if (snap.mergeable === "CONFLICTING") {
    if (memory.conflictOid !== snap.headOid) {
      memory.conflictOid = snap.headOid;
      events.push({ kind: "conflict" });
    }
  } else if (snap.mergeable === "MERGEABLE") {
    memory.conflictOid = null;
  }

  const seen = memory.seenComments ?? new Set<string>();
  for (const comment of snap.comments) {
    if (seen.has(comment.id)) {
      continue;
    }
    seen.add(comment.id);
    const own =
      snap.viewer !== null &&
      comment.author?.toLowerCase() === snap.viewer.toLowerCase();
    if (!baseline && !own && comment.body.trim().length > 0) {
      events.push({ kind: "comment", comment });
    }
  }
  memory.seenComments = seen;

  return events;
}

const BODY_LIMIT = 2_000;

function clip(text: string, limit: number): string {
  const trimmed = text.trim();

  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
}

function quote(text: string): string {
  return clip(text, BODY_LIMIT)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function commentHeading(c: WatchedComment): string {
  const who = c.author ? `@${c.author}` : "someone";
  if (c.kind === "inline") {
    return `New review comment from ${who}${c.location ? ` on ${c.location}` : ""}`;
  }
  if (c.kind === "review") {
    const verdicts: Record<string, string> = {
      APPROVED: " (approved)",
      CHANGES_REQUESTED: " (changes requested)",
    };
    const verdict = verdicts[c.reviewState ?? ""] ?? "";

    return `New review from ${who}${verdict}`;
  }

  return `New comment from ${who}`;
}

/** The excerpt of a failing run's log, keyed by check name. */
export type LogExcerpts = Map<string, string>;

/** The one-line label the transcript shows for a wake. */
export function wakeSummary(prNumber: number, events: WatchEvent[]): string {
  const failed = events.filter((e) => e.kind === "check_failed");
  const comments = events.filter((e) => e.kind === "comment").length;
  const parts: string[] = [];
  if (failed.length === 1) {
    parts.push(`${failed[0]!.check.name} failed`);
  } else if (failed.length > 1) {
    parts.push(`${failed.length} checks failed`);
  }
  if (events.some((e) => e.kind === "conflict")) {
    parts.push("merge conflict");
  }
  if (comments > 0) {
    parts.push(comments === 1 ? "new comment" : `${comments} new comments`);
  }
  if (events.some((e) => e.kind === "checks_passed")) {
    parts.push("checks pass");
  }

  return `PR #${prNumber}: ${parts.join(", ")}`;
}

/** The message that wakes the agent: everything it needs to act, no lookups. */
export function wakeMessage(
  snap: Pick<PrSnapshot, "number" | "url">,
  events: WatchEvent[],
  logs: LogExcerpts,
): string {
  const sections: string[] = [];
  for (const event of events) {
    if (event.kind === "check_failed") {
      const { check } = event;
      const lines = [`## Check failed: ${check.name}`];
      if (check.detailsUrl) {
        lines.push(check.detailsUrl);
      }
      if (check.failures.length > 0) {
        lines.push("", "Annotations:", ...check.failures.map((f) => `- ${f}`));
      }
      const log = logs.get(check.name);
      if (log) {
        lines.push("", "End of the failing step's log:", "```", log, "```");
      }
      sections.push(lines.join("\n"));
    } else if (event.kind === "conflict") {
      sections.push(
        "## Merge conflict\nThe branch no longer merges cleanly into its base. Rebase or merge the base in, resolve, and push.",
      );
    } else if (event.kind === "comment") {
      const { comment } = event;
      sections.push(
        `## ${commentHeading(comment)}\n${comment.url}\n\n${quote(comment.body)}`,
      );
    } else {
      sections.push(
        `## Checks pass\nAll ${event.count} ${event.count === 1 ? "check that gates" : "checks that gate"} the merge passed. Nothing to fix for CI. Don't merge unless you were asked to.`,
      );
    }
  }
  const actionable = events.some((e) => e.kind !== "checks_passed");

  return [
    `[Argus PR watch] Pull request #${snap.number} (${snap.url}) changed while you were watching it.`,
    ...sections,
    actionable
      ? "Fix what is actionable, push, and reply on the PR where a reviewer asked something. If something is not yours to fix, say so instead. The watch keeps running until the PR merges or closes."
      : "The watch keeps running until the PR merges or closes.",
  ].join("\n\n");
}
