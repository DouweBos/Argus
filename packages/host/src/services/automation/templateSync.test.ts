/**
 * The refresh has one job and one prohibition: carry a new playbook onto an
 * untouched built-in, and never onto one you edited.
 */

import type { Automation } from "./models";
import { describe, expect, it } from "vitest";
import { DEFAULT_GUARDRAILS } from "./guardrails";
import {
  LEGACY_PLAYBOOK_HASHES,
  playbookHash,
  refreshBuiltIns,
} from "./templateSync";
import { BUILT_IN_TEMPLATES, STANDUP_DIGEST_TEMPLATE_ID } from "./templates";

const template = BUILT_IN_TEMPLATES[STANDUP_DIGEST_TEMPLATE_ID];

/** The playbook as shipped before the "Ready to ship" section was added. */
const LEGACY_STANDUP = `# Standup digest

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

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "a1",
    name: "Standup digest",
    description: "old description",
    enabled: true,
    trigger: { kind: "manual" },
    scope: { repo_roots: ["/repo"] },
    source_ids: [],
    playbook: LEGACY_STANDUP,
    extra_instructions: "",
    autonomy: null,
    guardrails: DEFAULT_GUARDRAILS,
    model: null,
    runner: null,
    template_id: STANDUP_DIGEST_TEMPLATE_ID,
    seeded_playbook_hash: null,
    created_at: 1,
    updated_at: 1,
    last_run_at: null,
    next_run_at: null,
    ...overrides,
  };
}

describe("refreshBuiltIns", () => {
  it("recognises a pre-fingerprint built-in by its shipped hash", () => {
    // Guards the legacy table: a typo there silently strands every install.
    expect(playbookHash(LEGACY_STANDUP)).toBe("c707f2e9ff881b9c");
  });

  it("carries the new playbook onto an untouched built-in", () => {
    const list = [automation()];

    expect(refreshBuiltIns(list)).toBe(true);
    expect(list[0].playbook).toBe(template.playbook);
    expect(list[0].seeded_playbook_hash).toBe(playbookHash(template.playbook));
    // The fixture's description is not stock, so it is left as the user left it.
    expect(list[0].description).toBe("old description");
  });

  it("leaves an edited playbook alone", () => {
    const list = [
      automation({
        playbook: `${LEGACY_STANDUP}\nAlso mention the weather.\n`,
      }),
    ];

    expect(refreshBuiltIns(list)).toBe(false);
    expect(list[0].playbook).not.toBe(template.playbook);
  });

  it("leaves an edit alone even once the automation has a fingerprint", () => {
    const list = [
      automation({
        playbook: "mine now",
        seeded_playbook_hash: playbookHash(LEGACY_STANDUP),
      }),
    ];

    expect(refreshBuiltIns(list)).toBe(false);
    expect(list[0].playbook).toBe("mine now");
  });

  it("keeps everything that is yours — schedule, scope and enabled", () => {
    const list = [automation({ enabled: false, name: "My standup" })];
    refreshBuiltIns(list);

    expect(list[0].enabled).toBe(false);
    expect(list[0].name).toBe("My standup");
    expect(list[0].scope.repo_roots).toEqual(["/repo"]);
  });

  it("never reverts a description you edited, even with a stock playbook", () => {
    const list = [automation({ description: "my own words" })];
    refreshBuiltIns(list);

    expect(list[0].description).toBe("my own words");
    // The playbook is still stock, so that half must still refresh.
    expect(list[0].playbook).toBe(template.playbook);
  });

  it("refreshes a stock description even when the playbook is edited", () => {
    const list = [
      automation({
        playbook: "mine now",
        seeded_playbook_hash: playbookHash(LEGACY_STANDUP),
        description:
          "A daily read-only summary of what every agent and branch did yesterday.",
      }),
    ];

    expect(refreshBuiltIns(list)).toBe(true);
    expect(list[0].description).toBe(template.description);
    expect(list[0].playbook).toBe("mine now");
  });

  it("ignores automations that came from no template", () => {
    const list = [automation({ template_id: null })];

    expect(refreshBuiltIns(list)).toBe(false);
  });

  it("fingerprints a built-in whose template did not change, once", () => {
    // Whichever template's legacy hash is still its current one: there is
    // nothing to carry over, but it should stop consulting the legacy table.
    const [id, unchanged] = Object.entries(BUILT_IN_TEMPLATES).find(
      ([tid, t]) =>
        LEGACY_PLAYBOOK_HASHES[tid]?.includes(playbookHash(t.playbook)),
    )!;
    const list = [
      automation({ template_id: id, playbook: unchanged.playbook }),
    ];

    expect(refreshBuiltIns(list)).toBe(true);
    expect(list[0].seeded_playbook_hash).toBe(playbookHash(unchanged.playbook));
    expect(refreshBuiltIns(list)).toBe(false);
  });
});
