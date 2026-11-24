/**
 * What a teammate's conversation is told up front: who it is, what it may
 * do, what it remembers, and what its duties did lately. Rebuilt every time
 * the conversation's agent starts, so an edited soul or memory lands on the
 * next wake.
 */

import type { Teammate } from "./models";
import type { AutonomyLevel } from "../automation/models";
import { resolveHostAutonomy } from "../automation/autonomy";
import { listAutomationRuns } from "../automation/manager";
import { reportPreview } from "../automation/reportPreview";
import { memorySection } from "../automation/runPrompt";
import { teammateChatAutomation } from "./chatPolicy";
import { soulForPrompt } from "./soul";

const RECENT_RUNS = 5;

const ALLOWED: Record<AutonomyLevel, string> = {
  propose:
    "You may read the projects, answer, and save to your memory. You may not edit files, start sessions or push: when something should be done, call `emit_proposal` and the user starts it from the inbox with one click.",
  draft:
    "You may start sessions that implement and commit, or `emit_proposal` for the user to start. Pushing and merging will be refused.",
  pr: "You may start sessions and open pull requests for them. Merging will be refused.",
  auto_merge:
    "You may start sessions, open pull requests, and merge them once CI is green.",
};

export function buildTeammatePrompt(
  teammate: Teammate,
  dutyIds: string[],
): string {
  const soul = soulForPrompt(teammate.id);
  const autonomy = resolveHostAutonomy(teammateChatAutomation(teammate));
  const projects =
    teammate.scope.repo_roots.length > 0
      ? teammate.scope.repo_roots.map((r) => `- \`${r}\``).join("\n")
      : "- (none set — ask which project before you go looking)";

  return [
    `# You are ${teammate.name} (@${teammate.handle})`,
    "",
    teammate.tagline,
    "",
    soul || "(The user hasn't written your soul yet. Be direct and brief.)",
    "",
    "---",
    "",
    "## This conversation",
    "",
    "You are talking with the user directly. They can come back to this conversation later, and your duties run on their own; what should carry over between them goes in memory.",
    "",
    "Projects you look after:",
    "",
    projects,
    "",
    "You are in a neutral folder that is not a checkout; read the projects at their absolute paths.",
    "",
    "## Autonomy",
    "",
    `Your autonomy is **${autonomy}**. ${ALLOWED[autonomy]} These limits are enforced by Argus, not by you.`,
    ...memorySection({ kind: "teammate", id: teammate.id }).map((line) =>
      line.replace(
        "Don't save this run's findings; those belong in the report.",
        "When the user says to remember something, save it.",
      ),
    ),
    ...recentActivity(dutyIds),
  ].join("\n");
}

/** One line per recent duty run, so "what did you find this morning?" works. */
function recentActivity(dutyIds: string[]): string[] {
  const ids = new Set(dutyIds);
  const runs = listAutomationRuns()
    .filter((r) => ids.has(r.automation_id) && r.status !== "skipped")
    .sort((a, b) => b.started_at - a.started_at)
    .slice(0, RECENT_RUNS);
  if (runs.length === 0) {
    return [];
  }

  return [
    "",
    "## What your duties did lately",
    "",
    ...runs.map((run) => {
      const when = new Date(run.started_at).toISOString().slice(0, 16);
      const summary = reportPreview(run) ?? run.error ?? "no report";

      return `- ${when} — ${run.status}: ${summary}`;
    }),
  ];
}
