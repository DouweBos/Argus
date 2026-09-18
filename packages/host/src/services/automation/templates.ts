/**
 * Built-in automation templates — seeded on first load, then editable like any
 * other automation. Both templates only read: the Standup digest reports, and
 * Morning triage additionally emits proposals, which wait for a human.
 */

import type { CreateAutomationInput } from "./models";
import { GITHUB_SOURCE_ID } from "../signals/sources/github";

export const STANDUP_DIGEST_TEMPLATE_ID = "standup-digest";
export const MORNING_TRIAGE_TEMPLATE_ID = "morning-triage";

const MORNING_TRIAGE_PLAYBOOK = `# Morning triage

You have been handed every issue assigned to you and every pull request waiting
on your review. Decide what is worth doing today, and say why.

Rank the work items, highest first, by:

1. **Blocking others** — a review someone is waiting on, or an issue another
   person's work depends on. These come first regardless of size.
2. **Small and clear** — the fix is obvious from the description and touches
   little. Cheap wins outrank expensive ones.
3. **Stale** — untouched for a week or more, still open, still assigned. Worth
   a decision even if that decision is to close it.

Anything that is none of those goes last, or not at all. Do not pad the list.

Then:

- Call \`emit_proposal\` **once per item you want in front of the user**, in your
  ranked order. Set \`repo_root\` from the work item when it has one, and pass
  its \`source_ref\` through verbatim so the inbox can link back.
- Set \`confidence\` honestly: high only when the item is unambiguous and you
  could hand it to an agent as-is. Use \`recommended_action: "needs_info"\` when
  the item is too vague to act on rather than inflating the number.
- Finally write the report as your final assistant message: a one-line summary
  of the morning, then the ranked list with a sentence each.

## Rules

- This run is read-only. Do not edit any file, do not comment on anything, and
  do not start a session or an agent — \`emit_proposal\` is how you ask.
- Work only from the items you were given. If there are none, say so in one
  line and emit nothing.
- Do not call ExitPlanMode. Nobody is watching this run.
`;

const STANDUP_PLAYBOOK = `# Standup digest

Summarise what happened across the projects in scope since this time yesterday.

For each project:

1. Run \`git log --since="24 hours ago" --all --date=short --pretty=format:"%h %ad %an %s"\` in the project directory to see what landed.
2. Run \`git branch -a --sort=-committerdate\` and note branches with activity in the last day.
3. Read the Argus sessions for the project with the \`list_sessions\` MCP tool, and \`list_agents\` for any session that looks active, to see which work is still in flight.

Then write the digest as your final message, in markdown:

- **Shipped** — what merged or landed, one bullet each, with the short SHA.
- **In flight** — sessions and branches with uncommitted or unmerged work.
- **Stalled** — anything untouched for more than three days.
- **Worth a look** — at most three things you would raise in a standup.

Keep it under 300 words. If a project has no activity, say so in one line rather
than padding it out.

## Rules

- This run is read-only. Do not edit, create or delete any file in any project,
  do not commit, do not push, and do not start any session or agent.
- Do not call ExitPlanMode. Your final assistant message *is* the report — no
  approval step, nobody is watching this run.
- If a project directory is unreadable, note it and carry on with the rest.
`;

/** Every template shipped with the app, keyed by its stable id. */
export const BUILT_IN_TEMPLATES: Record<string, CreateAutomationInput> = {
  [STANDUP_DIGEST_TEMPLATE_ID]: {
    name: "Standup digest",
    description:
      "A daily read-only summary of what every agent and branch did yesterday.",
    // Seeded off: an automation that spawns an agent unprompted should be a
    // deliberate choice, not something an update turns on.
    enabled: false,
    trigger: {
      kind: "schedule",
      cron: "0 9 * * 1-5",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      catch_up: true,
    },
    playbook: STANDUP_PLAYBOOK,
    template_id: STANDUP_DIGEST_TEMPLATE_ID,
  },
  [MORNING_TRIAGE_TEMPLATE_ID]: {
    name: "Morning triage",
    description:
      "What to work on today: assigned issues and review-requested PRs, ranked, one proposal each.",
    enabled: false,
    trigger: {
      kind: "schedule",
      cron: "30 7 * * 1-5",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      catch_up: true,
    },
    source_ids: [GITHUB_SOURCE_ID],
    playbook: MORNING_TRIAGE_PLAYBOOK,
    template_id: MORNING_TRIAGE_TEMPLATE_ID,
  },
};
