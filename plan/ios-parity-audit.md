# iOS ↔ desktop parity audit

Snapshot taken at `fdc48a36` (after automation authoring landed on the phone).

## Method

Three lists, compared:

- `packages/remote-protocol/src/capabilities.ts` — 84 entries: 73 callable methods + 11 server→client events. This is the phone's hard ceiling.
- `clients/argus-ios/.../Envelopes.swift` — the 73 methods and 9 events the app actually speaks.
- `electron/ipc.ts` — 367 desktop IPC commands. Anything here without a gateway method is unreachable from a phone by construction.

A paired **desktop** driving a headless host is not affected by any of this: it gets the raw IPC channel through the admin passthrough. Everything below is specifically about the phone.

---

## 1. Gateway methods the phone never calls

The wire surface is nearly saturated. Only these exist host-side and go unused:

| Method                                                              | What the phone is missing                                                                                                                                                                                         |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `devices.claim` / `claim_status` / `release` + `device.claim` event | Interaction arbitration. The app injects `devices.touch`/`button`/`keyboard` **without ever claiming**, so a phone and a desktop can drive the same simulator at once — exactly what the claim exists to prevent. |
| `browser.watch` / `browser.unwatch`                                 | The embedded browser runtime. Frames ride the same binary channel as device video, which the app already decodes.                                                                                                 |
| `agents.vitals`                                                     | Per-agent cost and context vitals. The chip row shows a context meter derived from capabilities, not vitals.                                                                                                      |
| `sessions.changed`, `projects.changed` events                       | The app polls every list on a 4–5s timer instead. Every "stale after unlock" bug is downstream of this.                                                                                                           |
| `huddle.state`, `huddle.chat` events                                | A phone can't take part in a huddle room.                                                                                                                                                                         |

## 2. Desktop features with no gateway method at all

Ordered by how central they are to the phone's own story.

**Landing work** — the whole "agent finished → review → ship" loop dead-ends on the phone.
`git_commit`, `git_push` / `push_session_branch`, `git_stage`/`unstage`/`discard_*`, `merge_session_into_base`, `rebase_session_on_base`, `get_session_merge_blockers`, `get_session_conflicts`, `git_mark_resolved`. The phone can read `sessions.diff` and `sessions.git_status` and nothing else — `ChangesView` says so in its own doc comment.

**Pull requests** — `gh_pr_create`, `gh_pr_merge`, `gh_pr_comment`, `gh_pr_close`, `list_interesting_pull_requests`, `read_pr_template`.

**Ad-hoc automation runs** — `automation_run_scratch`, `automation_scratch_runs_list`. The desktop's Quick Run has no wire equivalent, which is now the obvious hole next to the editor the phone just gained.

**Reading code** — `read_file`, `git_read_blob_at_ref`, `git_file_history`, `git_blame_file`, `git_log`/`git_show_commit`. `sessions.files` lists paths for @-mentions; nothing returns contents, so the phone can't open a file or a commit.

**App and project settings** — `get_app_settings` / `set_app_settings`, `get_user_project_settings`, `read_argus_config` / `write_argus_config`, `llm_list_runners`, MCP config. Includes the automations master switch and the default autonomy rung, which now gates automations the phone can author.

**Project and session lifecycle** — no project registration (`open_project`-equivalents, `onboarding_*`), no `fork_session` / `fork_chat_in_session`, no `restore_agent_at_turn`, no `set_session_base_branch` / `set_session_runner` / `set_session_claude_account`, no `generate_session_title`, no `retry_session_setup`.

**Terminals** — `list_terminals`, `terminal_write`, `terminal_resize`, `create_run_terminal`. Also the run commands (`.argus.json` run entries) that the toolrail triggers.

**Huddles as host** — `huddle_start`/`stop`/`approve_guest`/`deny_guest`/`say`.

## 3. Features present on both, narrower on the phone

| Area           | Desktop                                                                                                                    | iPhone                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Create session | Branch-off / adopt local / adopt remote, base branch, runner + model, linked projects, image attachments, prefilled prompt | One description field; `use_existing_branch` and `base_branch` are supported by `sessions.create` but never sent |
| Spawn agent    | Model, permission mode, resume-from-history, prewarm                                                                       | Defaults only — `agents.spawn` already takes model and permission mode                                           |
| Plan approval  | Approve, approve in new session, keep planning, feedback, drafts, expand                                                   | Same minus draft persistence (as of `c2b8dbdd`)                                                                  |
| Proposals      | Accept, dismiss, resolve, cleanup, **request revision**                                                                    | All but request revision (`proposal_request_revision` has no method)                                             |
| Changes        | Staging, hunk discard, commit, conflict resolution, stashes, commit graph                                                  | Read-only diff, two modes                                                                                        |
| Settings       | Full dialog: agents, autonomy, editors, MCP, telemetry, updater, worktree locations                                        | Push toggle, theme, paired computers                                                                             |
| Devices        | Grid, popouts, claim arbitration, fold poses, AVD/simulator lifecycle                                                      | Mirror + touch/keys + orientation + fold, no claim, no boot/shutdown                                             |

---

# High-impact work, ranked

Each line is scoped by what it actually costs: new gateway methods + iOS UI.

### 1. Land the work from the phone — commit, push, merge

**Impact: highest.** Everything else on the phone ends at "the agent is done and you can read the diff". Adding `sessions.commit`, `sessions.push` and `sessions.merge_base` (plus `merge_blockers` for the pre-flight) turns the phone into the place the loop closes, which is the app's whole premise.
**Cost: medium.** Three control-tier methods over existing host functions (`gitCommit`, `pushSessionBranch`, `mergeSessionIntoBase`), one iOS screen extending `ChangesView` with a commit sheet and a merge button. The guardrail question — should a phone force-push, or merge with conflicts — needs an explicit answer before building.

### 2. Quick run (ad-hoc automation)

**Impact: high, and newly obvious.** The phone can now author a permanent automation but can't fire a one-off playbook, which is the cheaper and more common act — "go look at what broke overnight".
**Cost: small.** One method (`automations.run_scratch`) over `startScratchRun`, and the editor form already built for `AutomationEditorView` minus the trigger section.

### 3. Push-driven lists (`sessions.changed`, `projects.changed`)

**Impact: high, quietly.** Three of today's six bug fixes were staleness. The host already emits these events; the app ignores them and polls, which is both slower and wrong after a lock/unlock.
**Cost: small.** Two event cases in `RemoteEventName`, two handlers in `AppStore`, and the polling intervals can then be relaxed rather than removed.

### 4. Session and agent creation options

**Impact: high per unit of work.** "Start from this branch" and "start this agent on Opus in plan mode" are the two things you most want when kicking work off from a phone, and both are already on the wire.
**Cost: small.** No protocol work at all — `sessions.create` takes `use_existing_branch` and `base_branch`, `agents.spawn` takes model and permission mode. Pure iOS: a branch picker (`sessions.branches` exists) and two picker sheets reusing `PickerSheet`.

### 5. Device claim arbitration

**Impact: correctness, not features.** Today the phone injects touches into a device the desktop may be driving, with no arbitration and no indication that someone else holds it.
**Cost: small.** Claim on entering `DeviceView`, release on exit, handle the `device.claim` event to show who holds it.

### 6. Pull requests

**Impact: high for the ship-from-phone story, once #1 exists.** Open a draft PR from the branch the agent just pushed, read CI state, merge when green.
**Cost: medium.** New `gh.*` method family (create, list, merge, comment) and a PR screen. Depends on #1 to be worth much.

### 7. Read a file or a commit

**Impact: medium-high.** Reviewing a diff without being able to open the surrounding file, or look at what a commit did, is the main reason review moves back to the Mac.
**Cost: medium.** One `sessions.read_file` method (path-confined the way `resolve_mention_path` already is) plus `sessions.commits`/`show`; a file viewer on iOS reusing the existing diff renderer.

### 8. Agent vitals

**Impact: medium, trivially cheap.** Cost and context burn per agent, already on the wire and already shown on the desktop.
**Cost: tiny.** One call, one row in the agent screen.

### 9. App settings subset

**Impact: medium, and rising.** The automations master switch and the default autonomy rung now gate things the phone can author but not govern.
**Cost: small-medium.** A narrow `settings.get`/`settings.set` over a deliberately small allowlist — not the whole `AppSettings` blob.

### 10. Embedded browser view

**Impact: medium.** Web projects are currently invisible from the phone; the simulator ones aren't.
**Cost: small-medium.** `browser.watch`/`unwatch` already exist and the frame decoding is shared with `DeviceVideoView`.

**Deliberately not recommended:** terminals (a pty on a phone is a bad trade for the work), huddle hosting, and the long tail of git plumbing (bisect, submodules, reflog, interactive rebase) — none of it is phone work.
