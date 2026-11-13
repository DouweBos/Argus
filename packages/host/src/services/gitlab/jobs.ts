/** GitLab pipeline jobs as Argus's checks, and the tail of a failed job's log. */

import type {
  CheckConclusion,
  CheckStatus,
  PullRequestCheck,
} from "../github/prDetail";
import type { CheckBucket, WatchedCheck } from "../github/prWatch/snapshot";
import { glabText, projectApiPath } from "./glab";

export interface JobNode {
  allowFailure?: boolean | null;
  name?: string | null;
  status?: string | null;
  webPath?: string | null;
}

export const JOB_FIELDS = "name status webPath allowFailure";

const QUEUED = new Set([
  "created",
  "pending",
  "preparing",
  "waiting_for_resource",
  "waiting_for_callback",
]);

/** A job as a GitHub-style check: allowed failures and manual jobs never fail it. */
export function jobCheck(host: string, job: JobNode): PullRequestCheck {
  const status = job.status?.toLowerCase() ?? "";
  let outStatus: CheckStatus | null = "completed";
  let conclusion: CheckConclusion | null = null;
  if (status === "success") {
    conclusion = "success";
  } else if (status === "failed") {
    conclusion = job.allowFailure ? "neutral" : "failure";
  } else if (status === "canceled" || status === "canceling") {
    conclusion = "cancelled";
  } else if (status === "skipped") {
    conclusion = "skipped";
  } else if (status === "manual") {
    conclusion = "neutral";
  } else if (status === "running") {
    outStatus = "in_progress";
  } else if (status === "scheduled") {
    outStatus = "waiting";
  } else if (QUEUED.has(status)) {
    outStatus = "queued";
  } else {
    outStatus = null;
  }

  return {
    name: job.name ?? "job",
    status: outStatus,
    conclusion,
    detailsUrl: job.webPath ? `https://${host}${job.webPath}` : null,
    description: null,
  };
}

function bucketOf(check: PullRequestCheck): CheckBucket {
  if (check.status !== "completed") {
    return "pending";
  }
  if (check.conclusion === "failure") {
    return "fail";
  }

  return check.conclusion === "success" ? "pass" : "skip";
}

export function watchedJob(host: string, job: JobNode): WatchedCheck {
  const check = jobCheck(host, job);

  return {
    name: check.name,
    bucket: bucketOf(check),
    // A job allowed to fail doesn't gate the merge.
    required: job.allowFailure !== true,
    detailsUrl: check.detailsUrl,
    failures: [],
  };
}

/** Whether a set of jobs is green; null when there are none. */
export function jobsClean(host: string, jobs: JobNode[]): boolean | null {
  if (jobs.length === 0) {
    return null;
  }

  return jobs
    .map((j) => bucketOf(jobCheck(host, j)))
    .every((b) => b === "pass" || b === "skip");
}

const LOG_LINES = 60;
const LOG_CHARS = 6_000;
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");
const SECTION = /section_(?:start|end):\d+:[^\s\r]*(?:\[[^\]]*\])?\r?/g;
const JOB_URL = /^https?:\/\/([^/]+)\/(.+?)\/-\/jobs\/(\d+)/i;

/** A job trace without colours or collapsible-section markers, last lines only. */
export function trimJobTrace(raw: string): string {
  const lines = raw
    .replace(SECTION, "")
    .replace(ANSI, "")
    .split("\n")
    .map((line) => {
      // A carriage return redraws the line; only the last frame was seen.
      const frames = line.split("\r").filter((f) => f.trim().length > 0);

      return (frames.at(-1) ?? "").trimEnd();
    })
    .filter((line) => line.length > 0);
  const tail = lines.slice(-LOG_LINES).join("\n");

  return tail.length > LOG_CHARS ? `…${tail.slice(-LOG_CHARS)}` : tail;
}

/** The tail of a GitLab job's log from its web URL; null for anything else. */
export async function gitlabJobLogExcerpt(
  detailsUrl: string | null,
): Promise<string | null> {
  const match = detailsUrl ? JOB_URL.exec(detailsUrl) : null;
  if (!match) {
    return null;
  }
  const [, host, project, jobId] = match;
  try {
    const excerpt = trimJobTrace(
      await glabText(host!, `${projectApiPath(project!)}/jobs/${jobId}/trace`),
    );

    return excerpt.length > 0 ? excerpt : null;
  } catch {
    // Expired or erased logs: the link still helps.
    return null;
  }
}
