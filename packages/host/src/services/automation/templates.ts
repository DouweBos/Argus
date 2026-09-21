/**
 * Built-in automation templates — seeded on first load, then editable like any
 * other automation.
 *
 * Every one of them ships disabled. An automation that spawns an agent
 * unprompted has to be a deliberate choice, not something an update turns on,
 * and that holds even for the read-only ones.
 */

import type { CreateAutomationInput } from "./models";
import {
  GITHUB_PRS_SOURCE_ID,
  GITHUB_SOURCE_ID,
  LINEAR_SOURCE_ID,
} from "../signals/sourceIds";

export const STANDUP_DIGEST_TEMPLATE_ID = "standup-digest";
export const MORNING_TRIAGE_TEMPLATE_ID = "morning-triage";
export const EASY_ONES_TEMPLATE_ID = "take-the-easy-ones";
export const PR_SHEPHERD_TEMPLATE_ID = "pr-shepherd";
export const REGRESSION_SWEEP_TEMPLATE_ID = "regression-sweep";
export const BRANCH_JANITOR_TEMPLATE_ID = "branch-janitor";
export const DEPENDENCY_WATCH_TEMPLATE_ID = "dependency-watch";
export const LOCAL_BRANCH_CLEANUP_TEMPLATE_ID = "local-branch-cleanup";

/** The machine's zone, so a seeded 07:30 means 07:30 where you are. */
function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

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
- Set \`cta\` to the one thing the user should do. Code to write is
  \`{ kind: "start_session", label: "Start" }\`. An item whose next move is a
  human's — a PR needing a reviewer, a ticket needing an answer — is
  \`{ kind: "open_url", label: "Open PR #6478", url }\`. Something worth knowing
  but not worth acting on takes no \`cta\` at all, and the inbox shows no button.
  Never ask for a session when there is no code to write.
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
4. Find the work that is finished and waiting on a decision. A session qualifies when its agent is idle and \`list_session_changes\` shows its branch is committed with nothing dirty left behind. For each one, work out which of the two it needs:
   - **Open a PR** — the branch has no PR yet. Check with \`gh pr list --head <branch> --state all --json number,url,state\`.
   - **Merge** — a PR exists and is green, or the branch is a local one you would merge straight back. Use \`merge_status\` and \`check_conflicts\` to say whether it would go in cleanly.

Then write the digest as your final message, in markdown:

- **Shipped** — what merged or landed, one bullet each, with the short SHA.
- **Ready to ship** — finished work waiting on you. One bullet each: the branch, one line on what it does, whether it wants a PR or a merge, and any blocker (conflicts, red CI, unpushed commits). This is the section to lead with when it is not empty — these are done and costing you nothing but the decision.
- **In flight** — sessions and branches with work still in progress.
- **Stalled** — anything untouched for more than three days.
- **Worth a look** — at most three things you would raise in a standup.

Keep it under 350 words. If a project has no activity, say so in one line rather
than padding it out. Leave out any section that has nothing in it.

## Rules

- This run is read-only. Do not edit, create or delete any file in any project,
  do not commit, do not push, and do not start any session or agent.
- Do not call ExitPlanMode. Your final assistant message *is* the report — no
  approval step, nobody is watching this run.
- If a project directory is unreadable, note it and carry on with the rest.
`;

const EASY_ONES_PLAYBOOK = `# Take the easy ones

You have been handed the work items assigned to you. Pick out only the ones an
agent can finish on its own, and hand each to a session.

An item qualifies when **all** of these hold:

- The change it asks for is obvious from the description — no design decision
  is left open.
- It is small: a handful of files, no schema change, no dependency bump.
- It maps to a project you were given, so \`repo_root\` can be set.

Everything else is somebody else's morning. Skip it; do not lower your bar to
fill a list.

For each item that qualifies, call \`emit_proposal\` with
\`recommended_action: "start_session"\`, \`cta: { kind: "start_session", label:
"Start" }\`, an honest \`confidence\`, and the \`repo_root\` of the project. Argus decides what happens next: above the
confidence threshold and within the session cap it starts the work itself,
otherwise it waits for a human. Either way the answer comes back in the tool
result — read it and report what actually happened.

Finally write the report: what you started, what you left pending, and why.

## Rules

- Do not call \`create_session\` or \`spawn_agent\` yourself. Proposals are the
  only route; the direct calls are refused unless the autonomy level allows
  them, and going around the gate is not your call to make.
- Work only from the items you were given.
- Do not call ExitPlanMode. Nobody is watching this run.
`;

const PR_SHEPHERD_PLAYBOOK = `# PR shepherd

You have been handed every open pull request you authored, each with its CI
state and any comments written since its last commit. Keep them moving.

Work the list in order. For each PR, exactly one of these applies:

1. **Labelled \`ci-red\`** — the named checks are failing. Find the session
   already working this branch: call \`list_sessions\` and match on the
   \`head:<branch>\` label in the item's labels. If one exists, call
   \`send_agent_message\` on its running agent — or \`spawn_agent\` if it has
   none — with the failing check names, the PR url, and the instruction to
   reproduce the failure locally first. **Do not create a second session for a
   branch that already has one**; two agents on one worktree corrupt it.
2. **Labelled \`unanswered-comments\`** — somebody reviewed it after your last
   push. Draft the reply *and* the patch: read the comments in the item body,
   then either message the existing session with what to change, or emit a
   proposal when the comment asks a question you cannot answer from the code.
3. **Both** — treat the red CI first; a review answered on a broken branch gets
   answered twice.
4. **Neither** — say so in one line and move on. Do not invent work.

If no session exists for a branch and the PR needs code, emit a proposal with
\`recommended_action: "start_session"\`, a matching \`cta\`, and the PR's
\`repo_root\`. Argus decides whether to start it. A PR that needs no code — only
a reviewer — takes \`cta: { kind: "open_url", label: "Open PR #123", url }\`
instead; do not ask for a session to go and wait for a human.

Finish with \`emit_report\`: a \`stats\` block (open PRs, red, awaiting reply),
a \`table\` of PR / branch / state / what you did, and a \`sessions\` block for
anything you nudged.

## Rules

- Never push, never merge, never comment on GitHub yourself. You hand work to
  sessions and proposals; humans and the autonomy gate decide the rest.
- Work only from the pull requests you were given.
- Do not call ExitPlanMode. Nobody is watching this run.
`;

const REGRESSION_SWEEP_PLAYBOOK = `# Regression sweep

Run each project in scope on a simulator and report what broke. This is the
overnight pass that catches what a unit test does not: the app failing to boot,
a screen rendering blank, a tap going nowhere.

For each project:

1. Find or create a session on the project's default branch — call
   \`list_sessions\` first and reuse one rather than piling up worktrees.
2. \`list_run_commands\` for that session, then \`trigger_run\` each command in
   turn and \`wait_for_terminal\` for it to settle. A command that exits
   non-zero is a failure; capture the last 50 lines of \`read_terminal\` as the
   evidence.
3. Once the app is up, drive it with the \`conductor\` CLI — it is already on
   your PATH and already pointed at this project. \`conductor ui\` to read the
   current screen, \`conductor tap\` / \`conductor type\` / \`conductor open-link\`
   to move through it, \`conductor screenshot <path>\` to capture what you saw.
   Never script a simulator by hand and never call \`xcrun simctl\` yourself.
4. Walk the app's primary flow: launch, the first screen, the main navigation,
   and back. Screenshot each step into the run's working directory.

A failure is a command that exited non-zero, a screen that conductor reports as
empty, or a flow step that could not be completed. For each one, emit a
proposal naming the project, the step, and the evidence.

Finish with \`emit_report\`: a \`stats\` block (projects swept, failures), a
\`table\` of project / step / result, and a \`list\` of failures with the
screenshot path and a \`critical\` tone.

## Rules

- Never commit, push or merge. This run observes; fixing is somebody's morning.
- If no simulator is available, or a project has no run commands, report that
  as the finding rather than failing the run.
- Leave the sessions you used in place — the screenshots live there.
- Do not call ExitPlanMode. Nobody is watching this run.
`;

const BRANCH_JANITOR_PLAYBOOK = `# Branch janitor

Tidy up after finished work. Nothing here is urgent, so nothing here should be
destructive on its own.

For each project in scope:

1. Call \`list_sessions\` and, for each session, \`list_session_changes\` and
   \`merge_status\`.
2. A session whose branch is fully merged into its base and has no uncommitted
   changes is **done** — emit a proposal to delete it, with the branch name and
   the merge commit in the rationale.
3. A session with no commits and no uncommitted changes, older than a week, is
   **stale** — emit a proposal to delete it, and say plainly that nothing would
   be lost.
4. A session with unmerged commits untouched for more than two weeks is
   **stalled** — summarise what it was doing in two lines and emit a proposal
   with \`recommended_action: "review"\` and no \`cta\`: the decision is the
   user's to make from the summary. Never propose deleting one.

Finish with \`emit_report\`: a \`stats\` block (done, stale, stalled) and a
\`table\` of session / branch / age / verdict.

## Rules

- Never call \`delete_session\` yourself, whatever the autonomy level says. A
  worktree with unpushed work in it is not recoverable, so a human presses the
  button.
- Never merge anything.
- Do not call ExitPlanMode. Nobody is watching this run.
`;

const DEPENDENCY_WATCH_PLAYBOOK = `# Dependency watch

Find the dependency updates worth taking this week, and skip the rest.

For each project in scope:

1. Read the manifest (\`package.json\`, \`Package.swift\`, \`build.gradle\`,
   \`Podfile\`, whichever the project has) to see what it depends on and how it
   is pinned.
2. Run the ecosystem's own check in the project directory — \`pnpm outdated\`,
   \`npm outdated\`, or the equivalent. Do not install anything.
3. For each outdated package, read its changelog or release notes for the
   versions being skipped. Two sentences on what actually changed.

Propose only what is worth a branch:

- **Security fixes** — always, whatever the size of the jump.
- **Patch and minor bumps** on packages the project uses heavily, batched into
  one proposal per project rather than one per package.
- **Major bumps** — one proposal each, with \`recommended_action: "review"\`, a
  \`cta\` of \`{ kind: "open_url", label: "Open the changelog", url }\`, and the
  breaking changes named. Never claim a major bump is easy.

Skip anything you could not find release notes for, and say you skipped it.

Finish with \`emit_report\`: a \`stats\` block (packages behind, security), a
\`table\` of package / current / latest / what changed, and a \`list\` of the
security ones with a \`critical\` tone.

## Rules

- Do not install, do not edit a lockfile, do not commit. You read and propose.
- Do not call ExitPlanMode. Nobody is watching this run.
`;

const LOCAL_BRANCH_CLEANUP_PLAYBOOK = `# Local branch cleanup

A merged pull request deletes the branch on the remote and leaves the local one
behind. Find the local branches that have nothing left in them and propose
deleting each one.

For each project in scope:

1. \`git fetch --prune\` so the remote-tracking refs are current. If the command
   is refused, say so in the report and carry on — the rest still works, it is
   just reading a staler view.
2. \`git branch -vv\` — a branch marked \`[origin/<name>: gone]\` had its remote
   deleted, which is what a merged and tidied-up PR looks like.
3. \`git branch --merged <default branch>\` — fully merged into the default
   branch, so deleting it loses nothing.
4. For each candidate, \`git log <default branch>..<branch> --oneline\` to see
   what deleting it would actually lose. Empty means safe.

Never propose deleting:

- the branch that is currently checked out, or the default branch itself;
- a branch that has an Argus worktree on it — call \`list_sessions\` and match on
  the branch name. Deleting it breaks the worktree; the **Branch janitor**
  automation is what retires those;
- anything you could not establish the state of. Say you skipped it and why.

Then, **one \`emit_proposal\` per branch**:

- **Safe** — the remote is gone *and* \`git log <default>..<branch>\` is empty.
  Use \`recommended_action: "review"\`, name the branch, give its last commit date
  and the PR it merged in if you can find it, and put the exact
  \`git branch -d <branch>\` in the summary.
- **Not safe** — the remote is gone but commits remain. Use
  \`recommended_action: "needs_info"\`, list the commits that would be lost, and
  say plainly that this needs \`-D\` and that nothing on the remote is holding
  them.

Omit \`cta\` on both. There is no session to start and no page to open — the
proposal is the reminder, and the command in it is the whole job.

Set \`repo_root\` to the project so the proposal says which one it means.

Finish with \`emit_report\`: a \`stats\` block (branches checked, safe to delete,
needs a look), a \`table\` of branch / last commit / remote / verdict, and the
single \`git branch -d\` line that deletes every safe one at once.

## Rules

- This run is read-only. Do not delete a branch, do not check one out, do not
  commit, and do not push. You read and propose.
- Never propose a \`-D\` as if it were routine. Unmerged commits that exist
  nowhere else are gone for good.
- Do not call ExitPlanMode. Nobody is watching this run.
`;

/** Every template shipped with the app, keyed by its stable id. */
export const BUILT_IN_TEMPLATES: Record<string, CreateAutomationInput> = {
  [STANDUP_DIGEST_TEMPLATE_ID]: {
    name: "Standup digest",
    description:
      "A daily read-only summary of what every agent and branch did yesterday, and what is finished and waiting to ship.",
    // Seeded off: an automation that spawns an agent unprompted should be a
    // deliberate choice, not something an update turns on.
    enabled: false,
    trigger: {
      kind: "schedule",
      cron: "0 9 * * 1-5",
      timezone: localTimezone(),
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
      timezone: localTimezone(),
      catch_up: true,
    },
    // Linear rides along as an agent source: when its MCP server is not
    // configured it drops out of the run instead of failing it.
    source_ids: [GITHUB_SOURCE_ID, LINEAR_SOURCE_ID],
    playbook: MORNING_TRIAGE_PLAYBOOK,
    template_id: MORNING_TRIAGE_TEMPLATE_ID,
  },
  [EASY_ONES_TEMPLATE_ID]: {
    name: "Take the easy ones",
    description:
      "Implements the assigned issues it is confident about, in their own worktrees, and stops at the commit.",
    enabled: false,
    trigger: {
      kind: "schedule",
      cron: "0 8 * * 1-5",
      timezone: localTimezone(),
      catch_up: false,
    },
    source_ids: [GITHUB_SOURCE_ID],
    playbook: EASY_ONES_PLAYBOOK,
    // Implements and commits; never pushes and never merges.
    autonomy: "draft",
    guardrails: { confidence_threshold: 0.85, max_concurrent_sessions: 2 },
    template_id: EASY_ONES_TEMPLATE_ID,
  },
  [PR_SHEPHERD_TEMPLATE_ID]: {
    name: "PR shepherd",
    description:
      "Every 30 minutes: red CI on your own PRs goes back to the session that wrote the branch, and new review comments get an answer drafted.",
    enabled: false,
    trigger: {
      kind: "schedule",
      cron: "*/30 * * * *",
      timezone: localTimezone(),
      catch_up: false,
    },
    source_ids: [GITHUB_PRS_SOURCE_ID],
    playbook: PR_SHEPHERD_PLAYBOOK,
    // Messages existing sessions and proposes new ones; never pushes.
    autonomy: "draft",
    guardrails: { confidence_threshold: 0.8, max_concurrent_sessions: 2 },
    template_id: PR_SHEPHERD_TEMPLATE_ID,
  },
  [REGRESSION_SWEEP_TEMPLATE_ID]: {
    name: "Regression sweep",
    description:
      "Nightly: boots each project on a simulator, runs its run commands and a conductor smoke flow, and reports failures with screenshots.",
    enabled: false,
    trigger: {
      kind: "schedule",
      cron: "0 2 * * *",
      timezone: localTimezone(),
      // A sweep that missed its window is stale by morning; the next night
      // covers it.
      catch_up: false,
    },
    playbook: REGRESSION_SWEEP_PLAYBOOK,
    // Needs a session to run the app in, and nothing beyond it.
    autonomy: "draft",
    guardrails: { max_concurrent_sessions: 1, max_cost_usd_per_run: 10 },
    template_id: REGRESSION_SWEEP_TEMPLATE_ID,
  },
  [BRANCH_JANITOR_TEMPLATE_ID]: {
    name: "Branch janitor",
    description:
      "Nightly: proposes cleanup for merged worktrees and summarises the sessions that have stalled.",
    enabled: false,
    trigger: {
      kind: "schedule",
      cron: "0 3 * * *",
      timezone: localTimezone(),
      catch_up: false,
    },
    playbook: BRANCH_JANITOR_PLAYBOOK,
    // Deleting a worktree is not undoable, so this one never leaves propose.
    autonomy: "propose",
    template_id: BRANCH_JANITOR_TEMPLATE_ID,
  },
  [DEPENDENCY_WATCH_TEMPLATE_ID]: {
    name: "Dependency watch",
    description:
      "Weekly: what is behind, what actually changed in it, and which upgrades are worth a branch.",
    enabled: false,
    trigger: {
      kind: "schedule",
      cron: "0 9 * * 1",
      timezone: localTimezone(),
      catch_up: true,
    },
    playbook: DEPENDENCY_WATCH_PLAYBOOK,
    autonomy: "propose",
    template_id: DEPENDENCY_WATCH_TEMPLATE_ID,
  },
  [LOCAL_BRANCH_CLEANUP_TEMPLATE_ID]: {
    name: "Local branch cleanup",
    description:
      "Weekly: local branches whose pull request already merged and whose remote is gone, one proposal each.",
    enabled: false,
    trigger: {
      kind: "schedule",
      cron: "0 10 * * 1",
      timezone: localTimezone(),
      catch_up: true,
    },
    playbook: LOCAL_BRANCH_CLEANUP_PLAYBOOK,
    // Deleting a branch is not undoable, so this one never leaves propose.
    autonomy: "propose",
    template_id: LOCAL_BRANCH_CLEANUP_TEMPLATE_ID,
  },
};
