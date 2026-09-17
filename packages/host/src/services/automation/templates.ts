/**
 * Built-in automation templates — seeded on first load, then editable like any
 * other automation. P1 ships one: the Standup digest, which only reads and
 * only produces a report.
 */

import type { CreateAutomationInput } from "./models";

export const STANDUP_DIGEST_TEMPLATE_ID = "standup-digest";

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
};
