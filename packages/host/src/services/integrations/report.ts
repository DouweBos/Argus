/**
 * Report a session's outcome back on its Linear issue: what changed, the pull
 * request, and what the simulator shows now — the proof a reviewer or PM would
 * otherwise ask for. Best-effort: a failed report never touches the session.
 */

import type { Session } from "../session/models";
import type { LinkedIssue } from "@argus/remote-protocol";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { addHostEventSink } from "@argus/host/bus";
import { warn } from "@argus/host/logger";
import { appState } from "../../state";
import { loadAppSettings } from "../appSettings/store";
import { git } from "../session/git";
import { capture } from "../telemetry/telemetry";
import { linearApi } from "./service";

const execFileAsync = promisify(execFile);
const MAX_COMMITS = 10;

export type ReportTrigger = "merge" | "pr";

/** Sessions already reported, per trigger, so a retried merge doesn't double-post. */
const reported = new Set<string>();

export function reportBody(opts: {
  trigger: ReportTrigger;
  branch: string;
  baseBranch: string | null;
  prUrl: string | null;
  commits: string[];
  screenshotUrls: string[];
}): string {
  const lines = [
    opts.trigger === "pr"
      ? `Argus opened a pull request for this issue: ${opts.prUrl}`
      : `Argus merged \`${opts.branch}\`${opts.baseBranch ? ` into \`${opts.baseBranch}\`` : ""}.`,
  ];
  if (opts.commits.length > 0) {
    lines.push("", "**Changes**", ...opts.commits.map((c) => `- ${c}`));
  }
  if (opts.screenshotUrls.length > 0) {
    lines.push(
      "",
      "**Simulator**",
      ...opts.screenshotUrls.map((url, i) => `![Simulator ${i + 1}](${url})`),
    );
  }

  return lines.join("\n");
}

async function commitSubjects(
  session: Session,
  base: string | null,
): Promise<string[]> {
  if (!base || !session.path) {
    return [];
  }
  try {
    const out = await git(session.path, [
      "log",
      "--format=%s",
      `-${MAX_COMMITS}`,
      `${base}..${session.branch}`,
    ]);

    return out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** PNGs of the simulators this session's agents hold right now. */
async function simulatorShots(sessionId: string): Promise<Buffer[]> {
  const udids = new Set<string>();
  for (const [agentId, reservation] of appState.simulatorReservations) {
    if (appState.agents.get(agentId)?.sessionId === sessionId) {
      udids.add(reservation.udid);
    }
  }
  const shots: Buffer[] = [];
  for (const udid of udids) {
    const file = path.join(
      tmpdir(),
      `argus-issue-shot-${udid}-${Date.now()}.png`,
    );
    try {
      await execFileAsync("xcrun", ["simctl", "io", udid, "screenshot", file], {
        timeout: 15_000,
      });
      shots.push(await fs.readFile(file));
    } catch {
      // A shut-down simulator just means no picture.
    } finally {
      fs.unlink(file).catch(() => {});
    }
  }

  return shots;
}

async function issueFor(session: Session): Promise<LinkedIssue | null> {
  if (session.linked_issue) {
    return session.linked_issue;
  }
  // Started by hand on a branch that names the issue: Linear can still match it.
  const found = await linearApi()
    ?.issueForBranch(session.branch)
    .catch(() => null);

  return found
    ? {
        source: "linear",
        identifier: found.identifier,
        title: found.title,
        url: found.url,
      }
    : null;
}

export async function reportOnIssue(
  sessionId: string,
  trigger: ReportTrigger,
  details: { prUrl?: string; baseBranch?: string } = {},
): Promise<void> {
  const setting = loadAppSettings().linear_report ?? "pr";
  const session = appState.sessions.get(sessionId);
  const api = linearApi();
  const key = `${sessionId}:${trigger}`;
  if (setting !== trigger || !session || !api || reported.has(key)) {
    return;
  }
  const issue = await issueFor(session);
  if (!issue) {
    return;
  }
  reported.add(key);
  try {
    const base = details.baseBranch ?? session.base_branch ?? null;
    const [commits, shots] = await Promise.all([
      commitSubjects(session, base),
      simulatorShots(sessionId),
    ]);
    const screenshotUrls = await Promise.all(
      shots.map((png, i) =>
        api.upload(png, `${issue.identifier}-simulator-${i + 1}.png`),
      ),
    );
    const target = await api.issue(issue.identifier);
    if (!target) {
      return;
    }
    await api.comment(
      target.id,
      reportBody({
        trigger,
        branch: session.branch,
        baseBranch: base,
        prUrl: details.prUrl ?? null,
        commits,
        screenshotUrls,
      }),
    );
    capture("issue_report_posted", {
      has_screenshots: screenshotUrls.length > 0,
      trigger,
    });
  } catch (err) {
    reported.delete(key);
    warn(
      `[integrations] couldn't report on ${issue.identifier}: ${String(err)}`,
    );
  }
}

/** A pull request opened for `head` in `repoRoot` — report on its session's issue. */
export function pullRequestOpened(
  repoRoot: string,
  head: string,
  prUrl: string,
): void {
  const session = [...appState.sessions.values()].find(
    (s) => s.repo_root === repoRoot && s.branch === head,
  );
  if (session) {
    reportOnIssue(session.id, "pr", { prUrl }).catch(() => {});
  }
}

let detach: (() => void) | null = null;

export function initIssueReports(): void {
  detach?.();
  detach = addHostEventSink((channel, args) => {
    if (channel !== "session:merged") {
      return;
    }
    const payload = args[0] as
      | { baseBranch?: string; sessionId?: string }
      | undefined;
    if (payload?.sessionId) {
      reportOnIssue(payload.sessionId, "merge", {
        baseBranch: payload.baseBranch,
      }).catch(() => {});
    }
  });
}
