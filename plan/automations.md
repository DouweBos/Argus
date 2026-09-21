# Automations — Argus initiates the work

## Context

Argus today is a very good Claude Code wrapper: every unit of work starts with a human
clicking "start agent". Everything downstream of that click is excellent — worktree
isolation, simulators, org host agents fanning out across repos — but nothing ever
happens unless someone is sitting there.

The gap is not "add cron". The gap is three missing primitives:

1. **Signals** — Argus has no idea what work exists. It knows about repos, sessions and
   agents. It does not know that four issues are assigned to you and one of them is a
   two-line fix.
2. **Automations** — there is no persisted "when X, do Y" object. No scheduler exists
   anywhere in `electron/`; every `setInterval` in the codebase is a refresh poll
   (`autoFetch.ts`, `watcher.ts`, tray, updater), never a work trigger.
3. **An inbox** — there is no surface where Argus says "here's what I found, here's what
   I already did, here's what I want permission to do". `HomeScreen` is a project picker.

The intended outcome: you open your laptop and Argus has already triaged your tickets,
already implemented the two it was confident about, and is asking about the third.

**Decisions taken** (from clarifying questions): the feature family is **Automations**
(each firing is a **Run**); ticket sources go through a **pluggable source layer** with
GitHub first and Linear second; all three autonomy levels ship, **configurable per
automation with an app-wide default**; the scheduler runs **locally now but is designed
so it moves to the headless Mac mini host from `plan/argus-server-architecture.md`
unchanged**.

## The shape, and why it fits

> **Ported 2026-09-17.** This plan was written against a tree that no longer
> exists. `main` removed organizations and cross-repo tasks (`226eb2bb`), and the
> service layer moved into `@argus/host`. The orchestrator this design was built
> to reuse **is gone** — see §0. The design survives; the reuse table did not.

The original observation was "this is already built, it just has no clock" —
`organizationTask/orchestrator.ts` spawned a neutral non-git host session, gave its
agent the Argus MCP surface, and let it fan work into worktrees. That file has since
been deleted. The automation host must therefore be **built, not borrowed**, which is
the single biggest change to the estimate below.

What remains true is the shape: an Automation Run is a neutral host session whose
agent orchestrates via MCP, triggered by a clock instead of a button. The pieces it
leans on:

| need                                           | what it maps to now                                                                                                                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| neutral host for the orchestrating agent       | **Build it.** New `SessionKind: "automation_host"` in `session/models.ts` (currently `"project_root" \| "worktree"`), plus a non-git session creator. The deleted `createOrgHostSession` is recoverable from git history at `226eb2bb^` as a reference, not as code to import. |
| spawning + prompting a backend-initiated agent | **Build it**, but the hard part is known: `startAgent` + a manual `agent:started` event, or the agent is invisible to the UI. Same history is the reference.                                                                                                                   |
| fanning work into worktrees                    | MCP `create_session` / `spawn_agent` / `spawn_agents_batch` (`packages/host/src/services/mcp/server.ts`) — unchanged and current.                                                                                                                                              |
| versioned JSON persistence                     | `organizationTask/store.ts` is gone. Use `appSettings/store.ts` or `remote/deviceStore.ts` as the live pattern.                                                                                                                                                                |
| repeating timer                                | `session/autoFetch.ts` — still current.                                                                                                                                                                                                                                        |
| ticket data                                    | `github/issues.ts`, `github/pullRequests.ts`, `github/prDetail.ts` — all still current, all still `gh` CLI, no tokens.                                                                                                                                                         |
| Linear data                                    | Linear MCP merged via `mcp/userConfig.ts` — still current.                                                                                                                                                                                                                     |
| telling you about it                           | `remote/push/` + the relay — still current.                                                                                                                                                                                                                                    |
| renderer events                                | **`emitHostEvent(channel, payload)` from `@argus/host/bus`.** `broadcastToRenderers` and `addBroadcastTap` no longer exist; the bus is transport-agnostic and `electron/broadcast.ts` is just one sink.                                                                        |
| making it work headless                        | **Already done.** The gateway, the `admin` tier and the command registry shipped in PR #22. New commands get a tier in `defineCommand`; anything not in `HOST_ONLY_COMMANDS` is remotable. This is no longer future work.                                                      |

Nothing here needs a new agent runtime, a new transport, or a new persistence engine.

---

## 0. What changed under this plan

Verified against the tree at the time of porting.

**Gone:**

- `organizationTask/orchestrator.ts`, `store.ts`, `paths.ts` — the whole reuse premise.
- `createOrgHostSession`, and the `org_host` session kind. `SessionKind` is now
  `"project_root" | "worktree"`.
- `initOrganizations()` / `initOrgTasks()` in `main.ts` — the scheduler has no
  neighbours to start next to; it starts on its own.
- `broadcastToRenderers()` / `addBroadcastTap()` → `emitHostEvent()` /
  `addHostEventSink()` in `@argus/host/bus`.
- `plan/argus-server-architecture.md` — implemented and deleted. References to its
  §4.1 mean the `admin` tier, which now lives in
  `packages/remote-protocol/src/capabilities.ts`.
- `electron/services/**` → `packages/host/src/services/**`. **`packages/host` must not
  import `electron`** — enforced by `noElectron.test.ts` and an eslint rule. Anything
  needing the shell goes through `HostPlatform`.

**Cheaper than planned:**

- **P6 is nearly free.** The gateway, `admin` tier and command registry all shipped.
  P6 reduces to: give each `automation_*` command a tier, keep them out of
  `HOST_ONLY_COMMANDS`, and confirm the events flow — the bus does that by
  construction now.
- **Scoped grants exist** (`packages/remote-protocol/src/scope.ts`), so an automation
  surface can later be exposed to a narrowly-scoped client without new machinery.

**Still exactly as described:** the autonomy ladder, the MCP-layer gate (caller
identity is bound per MCP session — `callerAgentId` in `mcp/server.ts`), the closed
`ReportBlock` union, the signal source interface, and every template.

**Loose end found while porting:** `packages/host/src/telemetryEvents.ts` still
declares `SessionKind = "org_host" | "project_root" | "worktree"`, drifted from
`session/models.ts`. Fix it when adding `automation_host` rather than adding a third
spelling.

---

## 1. Data model

New service `packages/host/src/services/automation/` — `models.ts`, `store.ts`, `manager.ts`,
`scheduler.ts`, `runner.ts`, `guardrails.ts`, `outcomes.ts`.

```ts
// models.ts
export type AutomationTriggerKind = "event" | "manual" | "schedule" | "signal";

export type AutomationTrigger =
  | { kind: "schedule"; cron: string; timezone: string; catch_up: boolean }
  | { kind: "signal"; source_id: string; on: "changed" | "new" }
  | {
      kind: "event";
      event: "ci_failed" | "pr_review_requested" | "session_merged";
    }
  | { kind: "manual" };

/** The autonomy ladder. Each rung strictly contains the one above it. */
export type AutonomyLevel =
  | "propose" // write a proposal into the inbox; touch nothing
  | "draft" // create the worktree, implement, commit — then stop
  | "pr" // ...and push + open a draft PR
  | "auto_merge"; // ...and merge when CI is green (never a default)

export interface AutomationGuardrails {
  confidence_threshold: number; // 0..1, default 0.8
  max_concurrent_sessions: number; // default 2
  max_files_changed: number; // default 25
  max_cost_usd_per_run: number; // default 5
  path_denylist: string[]; // globs, e.g. ["infra/**", "**/*.lock"]
  require_clean_ci: boolean; // gates "auto_merge"
}

export interface Automation {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  /** Repos + optional org the run may act on. */
  scope: { organization_id: string | null; repo_roots: string[] };
  /** Which signal sources to feed the run. Empty = none. */
  source_ids: string[];
  /** The instructions. Markdown. This is the actual product surface. */
  playbook: string;
  /** null = inherit the app-wide default. */
  autonomy: AutonomyLevel | null;
  guardrails: AutomationGuardrails;
  model: string | null;
  /** Built-in template this was created from, for upgrade-on-release. */
  template_id: string | null;
  created_at: number;
  updated_at: number;
  last_run_at: number | null;
  next_run_at: number | null;
}

export type RunStatus =
  | "cancelled"
  | "failed"
  | "queued"
  | "running"
  | "skipped"
  | "succeeded";

export interface AutomationRun {
  id: string;
  automation_id: string;
  status: RunStatus;
  trigger_reason: string; // "schedule 07:30", "manual", "catch-up"
  started_at: number;
  finished_at: number | null;
  host_session_id: string | null; // kind: "automation_host"
  host_agent_id: string | null;
  /** Session ids the run created via MCP, for cascade-cancel + the inbox. */
  spawned_session_ids: string[];
  cost_usd: number | null;
  error: string | null;
}

/** The unit Argus puts in front of you. */
export interface Proposal {
  id: string;
  run_id: string;
  automation_id: string;
  title: string;
  summary: string;
  /** 0..1, self-reported by the agent, calibrated against `outcomes.ts`. */
  confidence: number;
  rationale: string;
  recommended_action: "ignore" | "needs_info" | "review" | "start_session";
  source_ref: { external_id: string; source_id: string; url: string } | null;
  repo_root: string | null;
  status: "accepted" | "auto_started" | "dismissed" | "pending";
  session_id: string | null;
  created_at: number;
}
```

Persistence: `~/.argus/automations.json` and `~/.argus/automation-runs.json`, both using
the versioned envelope + `.bak`-on-mismatch pattern from
`organizationTask/store.ts`. Run working dirs at
`~/.argus/automation-runs/{automationId}/{runId}/` (paths module mirrors
`organizationTask/paths.ts`). Run retention: keep last 50 per automation, mirroring
`MAX_ORG_TASKS_PER_ORG`.

---

## 2. Signals — a pluggable source layer

New service `packages/host/src/services/signals/`.

```ts
// types.ts
export interface WorkItem {
  source_id: string; // "github" | "linear" | ...
  external_id: string; // "plexinc/app#412", "ENG-123"
  url: string;
  title: string;
  body: string;
  state: string;
  assignee: string | null;
  labels: string[];
  priority: number | null;
  updated_at: number;
  kind: "issue" | "pull_request" | "task";
  /** Resolved against `collectAllProjects()` when the item maps to a local repo. */
  repo_root: string | null;
}

export interface SignalSource {
  id: string;
  label: string;
  /** "native" = Node fetches it. "agent" = the run's agent fetches it via MCP. */
  mode: "agent" | "native";
  isAvailable(): Promise<boolean>;
  /** native sources only */
  fetchAssigned?(opts: { repoRoots: string[] }): Promise<WorkItem[]>;
  /** agent sources only — instructions injected into the playbook prompt */
  agentInstructions?(): string;
}
```

Two implementations ship:

- **`sources/github.ts` (native)** — `gh search issues --assignee @me --state open --json …`
  plus `gh search prs --review-requested @me`, reusing the defensive
  "return `[]` on any failure" contract already established in
  `github/issues.ts`. Zero new auth.
- **`sources/linear.ts` (agent-mode)** — deliberately _not_ a new API client. The Linear
  MCP server is already merged into every agent's tool set by `mcp/userConfig.ts`. The
  source contributes prompt text ("call `mcp__linear__list_my_issues`, normalize each
  into a `WorkItem` and pass it to `emit_proposal`") and the host agent does the fetch.
  This is what the pluggable layer buys: a source is either Node code or a paragraph.

`agentInstructions()` is what makes Jira/Sentry/PagerDuty/Slack a config change rather
than a project.

---

## 3. The scheduler

`packages/host/src/services/automation/scheduler.ts`. Single 30-second `setInterval` started from `main.ts`. It has no neighbours
to start next to any more — `initOrganizations()` / `initOrgTasks()` are gone.

- `computeNextRun(cron, timezone, from)` — a small 5-field cron evaluator in
  `packages/host/src/services/automation/cron.ts` with unit tests. No new dependency; the grammar
  needed is `min hour dom mon dow` with `*`, `,`, `-`, `*/n`.
- **Missed fires coalesce, never backfill.** On boot, an automation whose `next_run_at`
  is in the past fires _once_ if `catch_up`, with `trigger_reason: "catch-up"`; otherwise
  it just reschedules. A closed laptop must not produce eight 7:30 briefings.
- **No overlap.** If the previous run is still `running`, record a `skipped` run with the
  reason and reschedule. Concurrency across automations is capped by an app setting.
- **Quiet hours** — app-level setting; schedule-triggered runs defer to the window edge.
- `signal` triggers poll their source on the same tick at a per-source interval and fire
  on a content hash change, so "a new issue was assigned to me" is a trigger without a
  webhook endpoint.

**Host-readiness comes for free** and is the reason to build it this way: the scheduler
touches no `BrowserWindow`. All state changes emit through `emitHostEvent()`
(`automations:changed`, `automation_run:changed`, `proposals:changed`), and the host
bus fans out to every transport — renderer and gateway alike — by construction. The
headless server already ships, so this is verification rather than porting: the
desktop in server mode sees the mini's automations as its own.

---

## 4. The runner, and where the autonomy gate actually lives

`packages/host/src/services/automation/runner.ts` is a near-transcription of
`organizationTask/orchestrator.ts:83` (`spawnHost`):

1. `ensureRepoRegistered()` each scope repo.
2. Create the `automation_host` session at the run dir.
3. Gather `WorkItem`s from native sources; hold agent-mode source instructions.
4. `startAgent(sessionId, automation.model, permissionModeFor(autonomy))` —
   `propose` → `"plan"`, everything else → `"auto"`.
5. Fire the `agent:started` renderer event manually (the org-task code comments on why —
   without it the agent is invisible to the UI).
6. `sendAgentMessage` with: playbook + serialized work items + agent-source instructions
   - **the guardrail statement** + **the calibration block** (§7) + the output contract.
7. `waitForAgent`, then `get_agent_result` for cost, mark the run terminal.

### The gate is in the MCP layer, not the prompt

Two new tools in `packages/host/src/services/mcp/server.ts`, registered **only when the
calling agent is an automation host**. Caller identity already exists and is current —
`callerAgentId` is bound per MCP session from the `X-Argus-Agent-Id` header:

- `emit_proposal({ title, summary, confidence, rationale, recommended_action, source_ref?, repo_root? })`
- `emit_report({ blocks })` — see §5.

`emit_proposal` is where autonomy is enforced, in `guardrails.ts`:

```
recommended_action === "start_session"
  && confidence >= guardrails.confidence_threshold
  && effectiveAutonomy >= "draft"
  && running spawned sessions < max_concurrent_sessions
  && repo's project-level autonomy_ceiling allows it
  → create_session + spawn_agent (status: "auto_started")
otherwise
  → Proposal { status: "pending" } lands in the inbox
```

This matters: **the model cannot argue its way past the gate**, because the gate is a
Node `if` on the tool call, not an instruction it could reinterpret. Same for the
post-conditions — `max_files_changed` and `path_denylist` are checked against
`list_session_changes` before a `pr`-level run is allowed to push, and `require_clean_ci`
before `auto_merge`.

Effective autonomy = `min(app default, automation.autonomy, project ceiling)`. A repo can
always cap itself lower than the app; never higher.

---

## 5. Dashboards as data, never as markup

A "Claude-generated dashboard" must not be Claude-generated HTML — that violates the
Peacock rules (no inline `<svg>` in `app/`, tokens only) the moment the model emits a
single hex color.

So `emit_report` accepts a closed union:

```ts
export type ReportBlock =
  | { type: "heading"; text: string }
  | { type: "markdown"; text: string }
  | { type: "stats"; items: { label: string; value: string; delta?: number }[] }
  | { type: "table"; columns: string[]; rows: (string | number)[][] }
  | { type: "list"; items: { text: string; href?: string; tone?: Tone }[] }
  | { type: "series"; kind: "bar" | "line"; labels: string[]; values: number[] }
  | { type: "proposals"; ids: string[] } // renders live proposal cards
  | { type: "sessions"; ids: string[] }; // renders live session cards
```

Rendered by a new Peacock `ReportView` composed of one component per block type, each
with a story, palette from `tokens.css`, charts per the `dataviz` skill. The model picks
_structure and data_; Peacock owns every pixel. Both the desktop and `clients/argus-web`
render the same blocks.

---

## 6. Surfaces

Routes (extend `app/lib/router.tsx` + `ParsedRoute`, document in `docs/routing.md`):

| URL                                      | Screen                                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `/inbox`                                 | **The briefing.** Pending proposals, auto-started sessions awaiting review, ready-to-merge branches, failed runs. |
| `/automations`                           | List: name, trigger, last run, next run, autonomy badge, enable toggle.                                           |
| `/automations/:automationId`             | Config editor + run history.                                                                                      |
| `/automations/:automationId/runs/:runId` | The run: report blocks, transcript link, spawned sessions.                                                        |

`/inbox` becomes the launch route behind an app setting (default on once proposals exist).
That single change is the difference between a Claude wrapper and an IDE with initiative.

Proposal cards have exactly three actions: **Start** (accept → `create_session` +
`spawn_agent` with the proposal as the prompt), **Dismiss** (with an optional one-line
reason — that reason is the training signal), **Open source** (the issue/PR URL).

Notifications reuse `notifications/push.ts`: a run that auto-started work, or one that
needs a decision, pushes with `urgency: "normal"` — and reaches your phone through the
existing relay. Quiet hours respected.

---

## 7. The learning loop (what makes this not-a-cron)

`packages/host/src/services/automation/outcomes.ts` records, per automation:
proposal → accepted / dismissed(+reason) / auto-started, and for started sessions whether
the branch merged, was abandoned, or was reverted.

Each run's prompt gets a compact calibration block:

> Your last 20 proposals for this automation: 14 accepted, 6 dismissed. Dismissed:
> "#388 — touched the payments module, I don't want agents there", "#401 — the issue is
> ambiguous". Weight your confidence accordingly.

Cheap to build, and it's what turns "confidence" from a number the model invents into a
number that means something. It also surfaces honestly in the UI: the automation detail
screen shows the acceptance rate, so an automation that is wrong 70% of the time is
visibly wrong rather than quietly noisy.

---

## 8. Built-in templates (ship as seeded, editable playbooks)

These are the product. The engine above exists to make them one JSON file each.

1. **Morning triage** — `30 7 * * 1-5`. Pull assigned issues + review-requested PRs from
   every source, rank by "blocking others > small and clear > stale", emit a report and a
   proposal per item. Report-only at `propose`.
2. **Take the easy ones** — chains off triage. For every proposal above threshold, open a
   worktree, implement, run the project's `run[]` commands, commit. Default `draft`.
3. **PR shepherd** — every 30m. For your open PRs: CI red → spawn a fix agent into the
   _existing_ session; new review comments → draft a reply and a patch. Reuses
   `github/prDetail.ts` and `prActions.ts`.
4. **Regression sweep** — nightly. Boot a simulator, run `.argus.json` `run[]` plus
   `conductor` smoke flows, report failures with screenshots. **This is the one nobody
   else can build** — a cron job with an iOS simulator attached is the whole Argus thesis.
5. **Branch janitor** — nightly. Merged worktrees → propose cleanup; stale sessions →
   summarize and archive. Reuses `merge.ts` and `deleteSession`.
6. **Dependency watch** — weekly. Feeds off the existing `dependencies` service; proposes
   upgrade branches with changelog summaries.
7. **Standup digest** — daily. What every agent did yesterday, from `chatHistory` + git
   log, as a report. Report-only, no scope risk — **build this one first**.

---

## 9. Settings

**App-level** (`packages/host/src/services/appSettings/store.ts`, because automations are _host_
state, not renderer state — this is what makes them work in server mode; document in
`docs/app-settings.md`):
`automations_enabled`, `default_autonomy` (default `"propose"`),
`automation_quiet_hours` (`{ start, end }`), `max_concurrent_automation_sessions`
(default 3), `automation_daily_budget_usd`, `launch_route` (`home` | `inbox`).

Surface in the Settings dialog (`app/components/shared/SettingsDialog/`) with
`SettingsScreenField`.

**Project-level** (`ArgusConfig` in `packages/host/src/services/session/models.ts`, parsed in
`session/setup.ts`, editable in `app/components/sidebar/SetupConfigDialog/`, documented in
`docs/project-settings.md`):

```jsonc
"automations": {
  "autonomy_ceiling": "draft",        // this repo never goes past draft
  "disabled": ["regression-sweep"],
  "path_denylist": ["infra/**", "**/migrations/**"]
}
```

---

## 10. Phasing

Each phase is shippable and independently useful.

- **P1 — the clock.** `automation/` service (models, store, manager, cron + tests,
  scheduler, runner), `automation_host` session kind, IPC commands, `/automations` routes,
  manual trigger, **Standup digest** as the only template, report rendered as plain
  markdown. No external sources, no worktree spawning, zero blast radius. Proves the loop
  end to end.
- **P2 — signals + inbox.** `signals/` layer + GitHub source, `emit_proposal`,
  `Proposal` model, `/inbox`, **Morning triage** at `propose`. Argus now tells you what to
  work on; it still doesn't touch anything.
- **P3 — autonomy.** The ladder, `guardrails.ts`, MCP-layer gate, auto-start into
  worktrees, **Take the easy ones**, per-automation + project-level config. Ship the
  default at `draft`, never `auto_merge`.
- **P4 — dashboards.** `ReportBlock` union, Peacock `ReportView` + block components +
  stories, retrofit the earlier reports.
- **P5 — breadth.** Linear agent-mode source, PR shepherd, regression sweep on
  simulators, `outcomes.ts` calibration loop.
- **P6 — host.** Mostly free now that the gateway shipped: give each `automation_*`
  command a tier in `defineCommand`, confirm none are in `HOST_ONLY_COMMANDS`, and
  confirm the event channels reach a paired client. The host bus fans out by
  construction, so this is verification, not porting.

Changesets: P1–P5 each get one (`argus`, `minor`); P4 also bumps `@argus/peacock`.

---

## 11. Verification

**P1**

- Unit-test `cron.ts` against a table of expressions incl. DST boundaries and `*/n`.
- Unit-test the scheduler's coalescing: two missed fires while "closed" → exactly one
  catch-up run; overlapping fire → a `skipped` run, not a second host.
- Create a manual-trigger Standup automation, hit Run, watch the `automation_host` session
  appear in the sidebar and produce a report. Confirm the run record survives an app
  restart and that the host dir is cleaned on delete.

**P2**

- With `gh` authenticated: triage run returns real assigned issues; with `gh` logged out
  it returns an empty report rather than a failed run (mirror the `issues.ts` contract, and
  test it).
- Proposals render in `/inbox`; Start creates a worktree session prompted with the
  proposal; Dismiss persists the reason.

**P3** — the important one, test adversarially:

- Set `autonomy: "propose"` and have the playbook explicitly instruct the agent to start a
  session anyway. It must land as `pending`. This asserts the gate is code, not prompt.
- Set `confidence_threshold: 0.95`, emit at 0.9 → pending.
- Set `max_concurrent_sessions: 1`, emit two qualifying proposals → one starts, one pends.
- Add `path_denylist: ["src/**"]` and a change under `src/` → the `pr` step refuses.
- Set a project `autonomy_ceiling: "propose"` while the app default is `pr` → propose wins.

**P4** — Storybook stories for every block type in both themes; `pnpm lint` catches any
hardcoded color.

**P6** — pair a second desktop as `admin`, switch it to server mode, confirm automations
list, run history, live run events and Start-from-inbox all work over the wire.

Throughout: `pnpm lint` (`tsc --noEmit` + eslint + prettier) and keep every new file under
the 500-line target — `runner.ts`, `scheduler.ts` and `guardrails.ts` stay separate for
exactly that reason.
