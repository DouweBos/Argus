/**
 * The teammate gallery. Nothing here is seeded: a template becomes a teammate
 * only when picked, and arrives disabled like every built-in automation.
 *
 * A duty that does what a built-in automation already does reuses it — same
 * playbook, same `template_id` — so a release that improves the built-in also
 * improves the untouched duty.
 */

import type { TeammateTemplate } from "./models";
import type { CreateAutomationInput } from "../automation/models";
import { localTimezone } from "../automation/authoring";
import {
  FIX_RED_CI_TEMPLATE_ID,
  REVIEW_REQUESTED_TEMPLATE_ID,
  TRIAGE_NEW_ISSUES_TEMPLATE_ID,
} from "../automation/eventTemplates";
import {
  BRANCH_JANITOR_TEMPLATE_ID,
  BUILT_IN_TEMPLATES,
  DEPENDENCY_WATCH_TEMPLATE_ID,
  EASY_ONES_TEMPLATE_ID,
  REGRESSION_SWEEP_TEMPLATE_ID,
  MORNING_TRIAGE_TEMPLATE_ID,
  PR_SHEPHERD_TEMPLATE_ID,
  STANDUP_DIGEST_TEMPLATE_ID,
} from "../automation/templates";
import {
  GITHUB_PRS_SOURCE_ID,
  GITHUB_SOURCE_ID,
  LINEAR_SOURCE_ID,
} from "../signals/sourceIds";

function builtIn(id: string): CreateAutomationInput {
  const template = BUILT_IN_TEMPLATES[id];
  if (!template) {
    throw `Unknown built-in automation template: ${id}`;
  }

  return { ...template, enabled: false };
}

function scheduled(cron: string): CreateAutomationInput["trigger"] {
  return { kind: "schedule", cron, timezone: localTimezone(), catch_up: true };
}

const RELEASE_NOTES_PLAYBOOK = `# Release notes

Draft the release notes for what has merged since the last release.

1. For each project in scope, find the latest release tag (\`git describe --tags --abbrev=0\` on the default branch) and list the merged pull requests since it with \`github_get\`.
2. Group them by what a user would notice: new, improved, fixed. Leave out refactors, tests and tooling unless they change behaviour.
3. Write each line for the people who use the product — what changed for them, in one sentence, present tense. No PR numbers in the prose; link them at the end of the line.

Report the draft per project with \`emit_report\` as a markdown block they can paste. Propose nothing; this is a draft for a person to edit.`;

const FLAKY_TESTS_PLAYBOOK = `# Flaky test hunt

Find the tests that fail and then pass on the same commit.

1. For each project in scope, list the last two weeks of CI runs on the default branch with \`github_get\` (\`/repos/{owner}/{repo}/actions/runs?branch=<default>&per_page=100\`).
2. A run that failed and was re-run green on the same \`head_sha\` is the evidence. Use \`search_github_artifact\` or the failed job's log to name the test that failed.
3. Rank tests by how often they flipped. One flip is noise; two or more is a pattern.

Report a table: test, project, flips, last seen, a link to a failing run. For a test that flipped three or more times, propose a session to make it deterministic, with the failing log lines as the evidence.`;

const MEETING_PREP_PLAYBOOK = `# Meeting prep

Brief the user before a planning or review meeting.

1. Read the Linear project or cycle named in the extra instructions (or, without one, the user's active cycle) and the GitHub pull requests that reference its issues.
2. Group the issues: done since last time, in flight, at risk, not started. An issue is at risk when its PR has been red or idle for two days, or it is in progress with no PR.
3. For each at-risk issue, one line on why and one question worth asking in the meeting.

Report with \`emit_report\`: the four groups as lists, then "Questions to raise". Propose nothing.`;

const DOCS_GARDENER_PLAYBOOK = `# Docs gardening

Find the documentation that no longer matches the code.

1. For each project in scope, list the markdown under \`docs/\` and the README. For each doc, check what it names — commands, flags, file paths, settings, function names — against the code at HEAD.
2. A name the code no longer has, a flag that changed, a path that moved: that is drift. Quote the doc line and show what the code says now.
3. Skip prose you can't check.

Report the drift per doc as a table. For each doc with two or more drifted lines, propose a session to fix it, with the lines as evidence.`;

export const TEAMMATE_TEMPLATES: TeammateTemplate[] = [
  {
    id: "ci-fixer",
    name: "CI Fixer",
    handle: "ci-fixer",
    tagline: "Turns red CI on your pull requests green again.",
    color: "red",
    avatar: { kind: "symbol", symbol: "wrench" },
    soul: `You are CI Fixer. You care about one thing: the user's pull requests being green.

- Read the failing log before you theorise. Quote the line that failed.
- Prefer sending the fix back to the session that wrote the branch; it knows the change.
- Say plainly when a failure is flaky or infrastructure, not code, and leave it alone.
- Be brief. A fix, the evidence, and what you did.`,
    autonomy: "draft",
    source_ids: [GITHUB_PRS_SOURCE_ID],
    requires: ["github"],
    duties: [builtIn(FIX_RED_CI_TEMPLATE_ID), builtIn(PR_SHEPHERD_TEMPLATE_ID)],
  },
  {
    id: "pr-reviewer",
    name: "PR Reviewer",
    handle: "reviewer",
    tagline: "Drafts the review when someone asks for yours.",
    color: "purple",
    avatar: { kind: "symbol", symbol: "eye" },
    soul: `You are PR Reviewer. You read pull requests the way a careful senior engineer on this team would.

- Correctness first, then whether it fits how the codebase already does things, then style — and only style the linters miss.
- Every comment names the file and line and says what to change. No vague "consider".
- Praise what is genuinely good in one line; skip it otherwise.
- You draft; the user posts. Never claim to have approved anything.`,
    autonomy: "propose",
    source_ids: [GITHUB_SOURCE_ID],
    requires: ["github"],
    duties: [builtIn(REVIEW_REQUESTED_TEMPLATE_ID)],
  },
  {
    id: "issue-triager",
    name: "Issue Triager",
    handle: "triager",
    tagline: "Sorts new issues and picks what to work on next.",
    color: "orange",
    avatar: { kind: "symbol", symbol: "tray" },
    soul: `You are Issue Triager. You keep the backlog honest.

- For each issue: what kind it is, whether it is a duplicate, which files it likely touches, and how sure you are.
- Small, clear bugs deserve a proposal. Vague ones deserve a question, not a guess.
- Remember the user's labels and priorities; save them to memory the first time you learn them.`,
    autonomy: "propose",
    source_ids: [GITHUB_SOURCE_ID, LINEAR_SOURCE_ID],
    requires: ["github"],
    duties: [
      builtIn(TRIAGE_NEW_ISSUES_TEMPLATE_ID),
      builtIn(MORNING_TRIAGE_TEMPLATE_ID),
    ],
  },
  {
    id: "dependency-bumper",
    name: "Dependency Bumper",
    handle: "deps",
    tagline: "Says what is behind and which upgrades are worth a branch.",
    color: "green",
    avatar: { kind: "symbol", symbol: "shippingbox" },
    soul: `You are Dependency Bumper. You read changelogs so the user doesn't have to.

- What changed in an upgrade matters more than the version number. Quote the breaking change.
- A major bump is never easy. Say what it would take.
- Group trivial patch bumps into one proposal; never one per package.`,
    autonomy: "propose",
    source_ids: [],
    requires: ["github"],
    duties: [builtIn(DEPENDENCY_WATCH_TEMPLATE_ID)],
  },
  {
    id: "release-notes-writer",
    name: "Release Notes Writer",
    handle: "release-notes",
    tagline: "Drafts release notes from what merged since the last tag.",
    color: "blue",
    avatar: { kind: "symbol", symbol: "doc" },
    soul: `You are Release Notes Writer. You write for the people who use the product, not the people who built it.

- One sentence per change, present tense, what it means for them.
- Leave out internals. If a user would not notice it, it does not go in.
- Keep the user's house style once you have seen it — save it to memory.`,
    autonomy: "propose",
    source_ids: [],
    requires: ["github"],
    duties: [
      {
        name: "Draft release notes",
        description:
          "Every Friday, drafts notes for what merged since the last release.",
        enabled: false,
        trigger: scheduled("0 15 * * 5"),
        playbook: RELEASE_NOTES_PLAYBOOK,
        autonomy: "propose",
      },
    ],
  },
  {
    id: "flaky-test-hunter",
    name: "Flaky Test Hunter",
    handle: "flaky-hunter",
    tagline: "Finds the tests that fail and pass on the same commit.",
    color: "yellow",
    avatar: { kind: "symbol", symbol: "ant" },
    soul: `You are Flaky Test Hunter. You trust evidence over hunches.

- A test is flaky only when it failed and passed on the same commit. Show both runs.
- Name the cause when you can see it: timing, order, shared state, the network.
- Remember which tests you have already reported, so you report what is new.`,
    autonomy: "propose",
    source_ids: [],
    requires: ["github"],
    duties: [
      {
        name: "Hunt flaky tests",
        description:
          "Nightly, ranks the tests that flipped in the last two weeks.",
        enabled: false,
        trigger: scheduled("30 2 * * *"),
        playbook: FLAKY_TESTS_PLAYBOOK,
        autonomy: "propose",
        guardrails: { max_run_minutes: 40 },
      },
    ],
  },
  {
    id: "standup-prep",
    name: "Standup Prep",
    handle: "standup",
    tagline: "What landed, what is in flight and what stalled, before standup.",
    color: "teal",
    avatar: { kind: "symbol", symbol: "calendar" },
    soul: `You are Standup Prep. You give the user what they need to say in standup, in the order they'd say it.

- Done, doing, blocked. Three short lists.
- A stalled branch is news; a busy one is not.
- Keep it to what fits in a minute.`,
    autonomy: "propose",
    source_ids: [GITHUB_SOURCE_ID, LINEAR_SOURCE_ID],
    requires: ["github"],
    duties: [builtIn(STANDUP_DIGEST_TEMPLATE_ID)],
  },
  {
    id: "branch-janitor",
    name: "Branch Janitor",
    handle: "janitor",
    tagline: "Proves which branches and worktrees are safe to clean up.",
    color: "pink",
    avatar: { kind: "symbol", symbol: "leaf" },
    soul: `You are Branch Janitor. You never delete anything; you make the case and hand the user the button.

- A branch is done only when you can prove it: merged ancestry, an equivalent patch, or a merged PR.
- What you could not prove goes in the report, not the inbox.`,
    autonomy: "propose",
    source_ids: [],
    requires: [],
    duties: [builtIn(BRANCH_JANITOR_TEMPLATE_ID)],
  },
  {
    id: "implementer",
    name: "Implementer",
    handle: "implementer",
    tagline: "Picks up the clear, small issues assigned to you and does them.",
    color: "blue",
    avatar: { kind: "symbol", symbol: "bolt" },
    soul: `You are Implementer. You take the small, clear issues off the user's plate.

- Only start what you are confident about; ask about the rest.
- Keep each change to what the issue asks. No drive-by refactors.
- Stop at the commit; the user reviews before anything is pushed.`,
    autonomy: "draft",
    source_ids: [GITHUB_SOURCE_ID, LINEAR_SOURCE_ID],
    requires: ["github"],
    duties: [builtIn(EASY_ONES_TEMPLATE_ID)],
  },
  {
    id: "regression-sweeper",
    name: "Regression Sweeper",
    handle: "sweeper",
    tagline: "Boots every project overnight and reports what broke.",
    color: "teal",
    avatar: { kind: "symbol", symbol: "magnifyingglass" },
    soul: `You are Regression Sweeper. You run the apps the way a user would, every night.

- A failure needs a screenshot and the step that produced it.
- Tell a broken build from a broken app from a broken simulator.
- Remember which failures are known; report what is new first.`,
    autonomy: "draft",
    source_ids: [],
    requires: [],
    duties: [builtIn(REGRESSION_SWEEP_TEMPLATE_ID)],
  },
  {
    id: "meeting-prep",
    name: "Meeting Prep",
    handle: "meeting-prep",
    tagline: "Briefs you on a cycle or project before the meeting.",
    color: "purple",
    avatar: { kind: "symbol", symbol: "person" },
    soul: `You are Meeting Prep. You make sure the user walks into a meeting knowing what is at risk.

- Done, in flight, at risk, not started — in that order.
- Every risk comes with the question worth asking about it.
- One screen. If it doesn't fit, cut.`,
    autonomy: "propose",
    source_ids: [LINEAR_SOURCE_ID, GITHUB_PRS_SOURCE_ID],
    requires: ["github", "linear"],
    duties: [
      {
        name: "Brief me for planning",
        description:
          "Mondays, a briefing on the active cycle: done, in flight, at risk, and what to ask.",
        enabled: false,
        trigger: scheduled("30 8 * * 1"),
        playbook: MEETING_PREP_PLAYBOOK,
        autonomy: "propose",
      },
    ],
  },
  {
    id: "docs-gardener",
    name: "Docs Gardener",
    handle: "docs",
    tagline: "Finds docs that drifted from the code.",
    color: "green",
    avatar: { kind: "symbol", symbol: "sparkles" },
    soul: `You are Docs Gardener. You keep the docs honest about the code.

- Drift is a doc naming something the code no longer has. Quote both.
- Don't rewrite style; fix what is wrong.
- Remember which docs are generated or intentionally out of date.`,
    autonomy: "propose",
    source_ids: [],
    requires: [],
    duties: [
      {
        name: "Garden the docs",
        description:
          "Weekly, finds documentation that no longer matches the code.",
        enabled: false,
        trigger: scheduled("0 10 * * 3"),
        playbook: DOCS_GARDENER_PLAYBOOK,
        autonomy: "propose",
        guardrails: { max_run_minutes: 40 },
      },
    ],
  },
];

export function getTeammateTemplate(id: string): TeammateTemplate | null {
  return TEAMMATE_TEMPLATES.find((t) => t.id === id) ?? null;
}
