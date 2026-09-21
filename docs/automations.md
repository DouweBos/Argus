# Automations — Argus starting the work itself

Everything else in Argus starts with you clicking **Start agent**. An automation
is the exception: a persisted "when this, do that" object that fires on a clock,
looks at what work exists, and either tells you what it found or does it.

The intended shape of a morning: you open your laptop, Argus has already triaged
the issues assigned to you, already implemented the two it was confident about,
and is asking about the third.

Automations live at **`/automations`**. What they want from you lands in the
**Inbox** at **`/inbox`**.

---

## The pieces

| Thing          | What it is                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| **Automation** | The persisted object: a trigger, a playbook, the projects it may look at, and how far it may go.      |
| **Run**        | One firing. Each run gets its own session and its own agent, and produces a report.                   |
| **Signal**     | Work the automation is handed before it starts thinking — assigned issues, PRs waiting on you.        |
| **Proposal**   | One thing a run wants done. Either Argus starts it, or it waits for you in the Inbox.                 |
| **Report**     | What the run found, rendered as a dashboard. Written by the run's agent, not scraped from its output. |

A run is an ordinary Argus session with an ordinary agent in it — you can open
it, read the transcript and talk to it like any other. It just has no worktree:
it is a neutral directory, because the run orchestrates work rather than doing
it. The work it starts happens in real worktree sessions, one per proposal.

---

## Triggers

**Schedule** — a 5-field cron expression (`min hour dom mon dow`) interpreted in
an IANA timezone you pick, so a seeded `07:30` means half past seven where you
are, not in UTC.

Two behaviours matter more than the cron itself:

- **Missed fires coalesce.** A laptop closed over the weekend produces at most
  one catch-up run, never one per missed slot. There is no backfill queue.
  Catch-up is per-automation: a nightly regression sweep is stale by morning, so
  it skips; a Monday dependency report is not, so it catches up.
- **Runs never overlap.** A fire while the previous run of the same automation
  is still going records a `skipped` run with the reason, and the schedule moves
  on. Two agents in one place is not a thing to design for.

**Manual** — no clock at all. It only runs when you press **Run now**, which
every automation supports regardless of its trigger.

**No automation at all** — see [Quick runs](#quick-runs-one-off-without-saving).

---

## Quick runs — one-off, without saving

Sometimes you just want a playbook run once. **Automations → Quick run**
(`/automations/quick`) is a box to type one into, a list of projects to point it
at, and a **Run once** button. Nothing is saved: no automation appears in the
list, and nothing is written to `automations.json`.

Everything else is identical to a scheduled run. It is the same runner, the same
neutral host session, the same agent you can open and talk to, the same report,
and — this is the part that matters — the same
[autonomy ladder](#the-autonomy-ladder). A quick run has no autonomy of its own,
so it inherits the app default and is still floored by every project's ceiling.
It cannot ask for a higher rung, because there is no field in which to ask.
The MCP gate, the shell guard and the spend ceilings all see it as exactly what
it is.

Quick runs are kept in the same history as everything else — they live at
`/automations/quick`, open at `/automations/quick/runs/:runId`, and are swept
under one shared cap of fifty rather than one cap each.

### Save as an automation

A finished quick run has a **Save as automation** button. It creates a real
automation prefilled with the playbook and the projects you just used, so
nothing is retyped — which is what makes a one-off the way you write an
automation, rather than a dead end. It is saved **paused**, with a **manual**
trigger: a run you did by hand must not turn into a clock you never asked for.
Give it a schedule and enable it when you mean to.

The run itself stays a quick run. Its history is what actually happened.

---

## The autonomy ladder

How far a run may go on its own. Each rung strictly contains the one before it:

| Rung             | What it may do                                                        |
| ---------------- | --------------------------------------------------------------------- |
| **Propose**      | Write proposals into the Inbox. Touches nothing else — not one file.  |
| **Draft**        | Open a worktree, implement the change, commit — then stop.            |
| **Pull request** | Also push the branch and open a draft PR.                             |
| **Auto-merge**   | Also merge, once CI is green. Never a default; opt in per automation. |

The effective level is the **lowest** of three: the app-wide default
([App settings → Agents → Autonomy](./app-settings.md#autonomy)), the
automation's own setting, and the project's ceiling
([`.argus.json` → `automations`](./project-settings.md#automations--how-far-automations-may-go-here)).
A repository can always ask for less than the app allows, and never for more.

**The app default is Propose.** So is the floor a project drops to when it lists
an automation as disabled.

### The ladder is code, not instructions

This is the part worth trusting. The rungs are not a paragraph in the playbook
that the model could reinterpret — they are enforced in three places, all in
Node:

1. **The MCP layer.** A `propose` run that calls `create_session` or
   `spawn_agent` directly is refused, told why, and pointed back at
   `emit_proposal`. A playbook that explicitly instructs the agent to start work
   anyway still produces a proposal that waits for you.
2. **The shell.** Every agent Argus starts on an automation's behalf — the run's
   own agent and each session it started — has its publishing commands checked
   on the permission request itself. Below `pr`, `git push` and `gh pr create`
   are denied outright, in any spelling, whatever the permission mode says.
3. **The permission mode.** A `propose` run is started in plan mode, so the CLI
   refuses edits before Argus is even asked. Its own `emit_proposal` and
   `emit_report` are allowed through, so an unattended run never stops to ask
   for the one call it exists to make.

---

## Guardrails

Per-automation limits, applied to every proposal before it may start work:

| Guardrail                 | Default | What it does                                                       |
| ------------------------- | ------- | ------------------------------------------------------------------ |
| `confidence_threshold`    | `0.8`   | A proposal the run is less sure about than this never auto-starts. |
| `max_concurrent_sessions` | `2`     | Sessions this automation may have in flight at once.               |
| `max_files_changed`       | `25`    | A branch touching more files than this cannot be pushed.           |
| `max_cost_usd_per_run`    | `5`     | Ceiling on one run's spend.                                        |
| `path_denylist`           | empty   | Globs no automation-started branch may touch, e.g. `["infra/**"]`. |
| `require_clean_ci`        | `true`  | Gates auto-merge: CI must be green.                                |

Two more caps live above the individual automation, in
[App settings](./app-settings.md#autonomy): **concurrent automation sessions**
across all of them (default 3), and a **daily spend budget** in USD (unset means
no budget).

A "session in flight" frees its slot when the session is **deleted**, not when
its agent goes idle — the branch is still open, unreviewed and unmerged, and
counting it as finished would let an automation stack up branches forever.

Project-level guardrails are additive: a repo's `path_denylist` is added to the
automation's, never substituted for it.

### What happens when a limit is hit

Nothing is killed mid-thought. A proposal that fails the gate lands as
**pending** in the Inbox with the reason attached, and you can start it by hand.
**Cost ceilings stop the next turn, not the current one** — a run that crosses
its ceiling finishes what it is saying, records what it spent, and is marked
failed with the reason; it does not lose its work.

---

## Signal sources

What a run is handed before it starts thinking. Sources are per-automation, and
one that is not configured drops out of the run rather than failing it.

| Source                   | Mode   | Needs                          | Provides                                                       |
| ------------------------ | ------ | ------------------------------ | -------------------------------------------------------------- |
| **GitHub**               | native | `gh` logged in                 | Issues assigned to you, PRs requesting your review.            |
| **GitHub pull requests** | native | `gh` logged in                 | Your open PRs, with CI state and comments since the last push. |
| **Linear**               | agent  | A Linear MCP server configured | Your assigned issues, fetched by the agent itself.             |

_Native_ sources are fetched by Argus and serialized into the run's prompt.
_Agent_ sources hand the agent instructions and let it do the fetching. With
`gh` logged out, a triage run reports an empty morning instead of failing.

---

## Proposals and the Inbox

A run asks for work by calling `emit_proposal`: a title, a summary, a rationale,
a self-reported confidence, the project it applies to, and what it thinks should
happen (`start_session`, `review`, `needs_info` or `ignore`).

It also writes the proposal's **call to action** — the button you see in the
inbox. Not everything a run finds is code to write, so the run says which of
these it is:

| `cta`                                        | Button            | What pressing it does                 |
| -------------------------------------------- | ----------------- | ------------------------------------- |
| `{ kind: "start_session", label: "Start" }`  | **Start**         | Creates the worktree and starts a run |
| `{ kind: "open_url", label: "…", url: "…" }` | The run's wording | Opens the link in your browser        |
| omitted                                      | none              | Only **Dismiss** — nothing to act on  |

A proposal that names no `cta` falls back to **Start** when it recommends
`start_session` and has a project, to opening its source item when it has one,
and to no button at all otherwise. A proposal whose action is not
`start_session` cannot be started — the session it would create would have
nothing to do.

Argus decides what happens next, synchronously, and the answer comes back in the
tool result so the run can report what actually happened:

- **Auto-started** — the rung allows it, confidence clears the threshold, a
  session slot is free and the budget holds. Argus creates the worktree session
  and prompts an agent with the proposal.
- **Pending** — anything else. It waits in `/inbox` with the reason. You press
  its button — **Start** and get the same session you would have got, or
  whatever the run asked you to open — or **Dismiss**, and the reason is kept.

The Inbox groups by what you would do about it, not by which automation produced
it: proposals to decide on, work that was started and is waiting for review, and
runs that failed.

---

## Reports

A run's final assistant message is its report. Runs can do better than markdown
by calling `emit_report` with structured blocks — stats, tables, lists, session
references — which render as a dashboard rather than as prose. When both exist
the blocks win.

Reports are visible at `/automations/:automationId/runs/:runId`, along with the
run's status, cost, duration and a link to its host session. The home screen
carries a **Recent runs** list — the newest five, across every automation and
every quick run — because a run is the one thing in Argus that happens while
nobody is looking. A report you have not opened is flagged there and listed
first; opening it clears the flag, and so does a newer report from the same
automation, so only the latest one ever chases you.

Home also carries a **Needs you** section: the pending proposals and the runs
that failed, with the same Start and Dismiss buttons the Inbox has.

---

## Built-in templates

Seven ship with Argus, seeded on first launch and then editable like anything
else — the playbook is yours to rewrite.

**Every one of them ships disabled.** An automation that spawns an agent
unprompted has to be a deliberate choice, not something an update turns on, and
that holds even for the read-only ones.

| Template                 | Default schedule  | Autonomy | What it does                                                                                                            |
| ------------------------ | ----------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Standup digest**       | `09:00`, weekdays | Propose  | Read-only summary of what landed, what is in flight and what stalled across your projects.                              |
| **Morning triage**       | `07:30`, weekdays | Propose  | Ranks assigned issues and review requests, one proposal each.                                                           |
| **Take the easy ones**   | `08:00`, weekdays | Draft    | Implements the assigned issues it is confident about in their own worktrees, stops at the commit.                       |
| **PR shepherd**          | every 30 minutes  | Draft    | Red CI on your PRs goes back to the session that wrote the branch; new review comments get a reply drafted.             |
| **Regression sweep**     | `02:00`, nightly  | Draft    | Boots each project on a simulator, runs its run commands and a conductor smoke flow, reports failures with screenshots. |
| **Branch janitor**       | `03:00`, nightly  | Propose  | Proposes cleanup for merged worktrees, summarises stalled sessions. Never deletes anything itself.                      |
| **Dependency watch**     | `09:00`, Mondays  | Propose  | What is behind, what actually changed in it, and which upgrades are worth a branch.                                     |
| **Local branch cleanup** | `10:00`, Mondays  | Propose  | Local branches whose PR already merged and whose remote is gone, one proposal each with the `git branch -d` to run.     |

Schedules are seeded in your machine's timezone. Branch janitor, dependency
watch and local branch cleanup are pinned at Propose on purpose: deleting a
worktree or a branch with unpushed work in it is not undoable, and no major
version bump is ever as easy as it looks.

Branch janitor and local branch cleanup do not overlap: the janitor retires
Argus **sessions and their worktrees**, while local branch cleanup looks at
plain **local git branches** left behind after a merge, and skips any branch a
worktree is sitting on.

---

## Describing one instead of writing it

**Automations → Describe it** takes a sentence — "every weekday at 8am, tell me
which of my open PRs have gone stale" — and hands back a draft: a name, a
playbook, a cron with a timezone, and the projects and signal sources it thinks
apply. You read it, edit anything, and press save.

Nothing is saved on your behalf, and three things about the draft are Argus's
call rather than the model's:

- **It arrives disabled**, the way every built-in template does. A model must
  not be able to create a live, scheduled, autonomous thing by itself.
- **It inherits the app-wide autonomy default.** A description asking for
  auto-merge does not get it — the suggested rung is dropped and the draft says
  so. Climb the ladder yourself, after you have read the playbook.
- **The schedule is checked before you see it.** The cron goes through the same
  evaluator the scheduler uses; one that does not parse — or parses but never
  fires — is repaired where it can be and otherwise downgraded to a manual
  trigger, with a note. The editor shows the next fire times either way.

A project the draft names that is not open, and a signal source that does not
exist, are dropped rather than saved.

---

## The calibration loop

Argus records how each proposal turned out — started and merged, started and
abandoned, dismissed and why — and hands the next run of the same automation a
short block of its own track record. An automation whose high-confidence
proposals keep getting dismissed is told so, in its own prompt, before it ranks
anything.

This is what makes an automation not-a-cron: it gets told whether it was right.

---

## Where state lives

All of it under your Argus home (`~/.argus`, or `~/.argus-server` for the
[server app](./server-app.md) — the two never share):

| File                                      | Contents                                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `automations.json`                        | The automations themselves.                                                                                      |
| `automation-runs.json`                    | Run history, with reports. A quick run's playbook and scope live here, on the run — never in `automations.json`. |
| `automation-runs/<automationId>/<runId>/` | One run's working directory.                                                                                     |
| `automation-proposals.json`               | Proposals, across every automation.                                                                              |
| `automation-outcomes.json`                | The calibration record.                                                                                          |
| `automation-sessions.json`                | Which sessions an automation owns.                                                                               |

Deleting an automation cleans up its run directories. Run records survive a
restart; so does the schedule — `next_run_at` is persisted, which is what makes
catch-up possible at all.

---

## On a headless host

Automations are the main reason to run
[Argus Server](./server-app.md) on a Mac mini: a clock that only ticks when your
laptop is open is not much of a clock.

The scheduler starts with the app, before and independently of any window, and
touches no renderer — every state change goes out on the host bus. So a headless
server runs it unchanged, and the mini keeps triaging overnight.

When you pair a desktop to that host as **admin** and switch to it
([App settings → Hosts](./app-settings.md#hosts)), the automations you see are
the _host's_. Creating one, editing a playbook, pressing Run now, watching a run
progress live and starting a proposal from the Inbox all act on the machine that
runs the clock, and its live events stream back to you. There is nothing to
duplicate: your laptop is a window onto the mini's automations, not a second
copy of them.

Two things to know when the host is headless:

- **Its automations are its own.** A server has its own `ARGUS_HOME`, so it has
  its own automations, its own inbox and its own run history. Enabling something
  on your laptop does not enable it on the mini.
- **A huddle guest sees none of this.** Sharing an agent with someone hands them
  that agent and nothing else — the automation surface is not reachable from a
  scoped grant at all, and automation events are never forwarded to one.

---

## From your phone

[Argus Remote](../clients/argus-remote/README.md) reaches the connected
computer's automations from the Automations button on its projects screen: the
automations themselves, the recent runs across all of them, and one run with
its report — structured blocks included.

It is deliberately narrower than the desktop. A phone **watches and fires**;
it does not author. There is no playbook editor, no schedule picker and no
inbox — those are the desktop's, and a paired Mac driving a headless mini still
gets all of them through the admin passthrough.

- **Run now and Cancel need the `control` grant.** Firing an automation starts
  an agent on the computer, which is code execution; a monitor-only device sees
  the runs and no buttons.
- **A huddle guest reaches none of it**, the same as everywhere else — every
  `automations.*` method is denied to a scoped grant.
- The lists poll rather than stream, like every other list on the phone.

---

## Turning it all off

**App settings → Agents → Automations enabled** is the master switch for the
clock. With it off, nothing fires on a schedule and every automation can still
be run by hand. It is host state, so when you drive another Mac the switch
belongs to that machine.

Per project, `.argus.json` can name automations that must not act on that repo
at all, or cap the whole repo at a lower rung. See
[`automations` in Project settings](./project-settings.md#automations--how-far-automations-may-go-here).
