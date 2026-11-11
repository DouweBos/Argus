# Features

A catalogue of what Argus supports today. Each section names the surface
area, what's included, and which configuration controls it.

---

## iOS simulators

- Boot any installed iOS Simulator runtime per-session.
- Mirrored live in the Runtime.
- Agents (and you) can tap, swipe, scroll, type, press hardware
  buttons, rotate, and trigger system gestures.
- Per-session isolation — parallel sessions never interfere.

Argus detects iOS projects (Xcode, Expo, React Native, Flutter) on its own.

---

## Android emulators

- Boot any installed AVD per-session.
- Mirrored live in the Runtime.
- Tap, swipe, type, hardware keys.
- Per-session isolation, like iOS.

Argus detects Android projects (Gradle, Expo, React Native, Flutter) on its own.

---

## Embedded Chromium browser

- Chromium running inside Argus.
- Per-session: the browser navigates to the session's allocated URL.
- Agents can click, type, scroll, fill forms, and run JavaScript.
- DevTools available on demand, per-session.
- **Select element**: hover the page, click an element, and it lands in the
  chat as a chip — its selector, React component, text, styles, bounds and a
  cropped screenshot — so you can type "make this red". The device inspector's
  **Attach to Chat** does the same for a view selected on a simulator.

Point it at your dev server with `browser_url` in `.argus.json` (e.g.
`"http://localhost:{PORT}"`).

---

## Terminals

- Real terminals, per-session, started in the session's worktree.
- Configurable in `.argus.json` under `terminals[]` — declare a name,
  starting directory, and any auto-launch commands.
- Both the agent and you can drive the same terminal.
- Reopen a terminal — or open it in another window — and it shows what
  it printed so far before carrying on live.
- Paired phones can follow a session's terminals and dev servers,
  read-only.

---

## Run commands

- Long-running processes declared in `.argus.json` under `run[]` —
  typically your dev server, watcher, or build.
- Each run command has a title, a shell command, and optional flags:
  - `restartOnRerun` — kill and restart on every relaunch.
  - `cwd` — run in a subdirectory of the worktree.
  - `requires` — declare dependencies on other run commands by title; any that aren't running are auto-started first.
  - `prerequisites` — block start until a check command passes.
- Output is streamed live into the Runtime with ANSI colour and
  link detection.

See [Project settings → Run commands](/argus/docs/project-settings) for
the full schema.

---

## Git workflow

A real git workflow lives inside Argus:

- **Branches** — create, switch, delete; sessions branch from your
  configured base branch automatically.
- **Worktrees** — one per session; managed for you.
- **Diff viewer** — file- and hunk-level, side-by-side or inline.
- **Hunk-level staging** — accept individual hunks, reject others, and
  refine before committing.
- **Commit & amend** — commit from the UI.
- **Stash** — list, apply, drop.
- **Merge & rebase** — Argus runs them for you and surfaces conflicts
  with an inline resolver.
- **Pull request** — open a draft PR directly from the session.
- **Pull request state** — a session whose branch has a GitHub PR shows
  GitHub's PR icon next to it in the session list: green when open, grey
  for a draft, purple once merged, red when closed. On a computer, click it
  to open the PR.
  Argus checks every few minutes, when you come back to the window, and
  right after a push or a PR action from Argus. It needs the GitHub CLI
  (`gh`) signed in; without it the icon simply doesn't appear.

---

## Remote access

Reach your projects and agents from a phone or any browser. Argus runs a
gateway on your Mac; a paired device connects straight to it and the
traffic is end-to-end encrypted (Noise IK), so a tunnel only ever sees
ciphertext.

- **Ways in** — devices on your network, and on your tailnet, connect
  directly by IP. A computer linked to your Argus account gets its own
  **managed tunnel** for access from anywhere, with nothing to set up.
  Phones try every address at once, keep the fastest that works, and move
  to a faster one when the network changes.
- **Argus account** — sign in on the iPhone app or Argus for Mac (Apple,
  GitHub or an emailed code) and the computers on your account show up
  with their current addresses, online or offline, with no QR per
  computer. Add one by typing the code it shows and comparing a 6-digit
  code; see [Accounts](accounts.md).
- **Grants per device** — paired devices are monitor + approve by
  default. **Control** lets a device drive agents and land their work —
  commit, push, merge, open a pull request, author an automation.
- **Background push** — wakes paired phones and browsers with a real
  notification when they aren't connected.
- **Phone or tablet** — the web client is one column on a phone and
  splits into a two-pane layout on an iPad or a desktop browser, with the
  session list beside whatever you have open.
- **Offline reading** — the iPhone app keeps the transcripts, changes
  and diffs, pull requests and inbox you looked at last, encrypted on the
  phone and unreadable while it's locked. With the computer out of reach
  (asleep, or you're on a train) they stay readable, even after a
  restart, under a "Saved · 12m ago" pill. Replies and permission answers
  wait on the phone and go out when the connection is back. Unpairing a
  computer deletes what was saved from it.
- **Handoff** — the iPhone app and the Mac advertise whatever session
  you have open to each other, so you can pick an agent up on the phone
  from the lock screen and put it back down on the Mac from the Dock.
- **Revoke** drops a device's pinned key and kills any live session
  immediately.

Off by default; turn it on under **Settings → Remote access**. See
[App settings → Remote Access](/argus/docs/app-settings).

---

## Working across several Macs

Argus attaches to more than one host at once. Each call is routed to the
machine that owns its subject — the session, agent, terminal or repo it
names — so one window can drive your laptop and a Mac mini in the corner
at the same time, with both sets of projects in the sidebar.

- Pair another Mac with the **Admin** grant to hand it the keyboard.
- A host that goes offline leaves what it already loaded on screen;
  anything new fails loudly rather than silently hitting the wrong Mac.
- Projects registered on a remote host stay on that host — they are
  paths on a different disk.

---

## Huddles — sharing one session

Hand someone a temporary link to exactly one agent and one device. They
open it in a browser and watch the transcript and the live simulator
alongside you until you end the huddle.

- The guest's grant is **scoped to that one agent and device** and dies
  with the room.
- Guests never see your other projects, sessions, automations or
  proposals.
- Everyone sees who is typing — you and the guests both — so two people
  don't send the agent the same thing at once. Presence only: no draft
  leaves the browser writing it.
- The device says who is driving it, and flags anyone whose taps are
  being refused — contention over one simulator is visible to everyone
  rather than only to the person it's happening to.
- **A side chat** for the people in the room, so "which build is this?"
  doesn't send anyone back to Slack. The agent never sees it: it isn't in
  the transcript or its context. Like the room, it lives in memory only
  and goes when the huddle ends.

---

## Argus Server — the headless host

Argus Server is Argus with no window: the whole service layer —
agents, worktrees, terminals, simulators, the gateway — on a machine
nobody is sitting at, typically a Mac mini, so agents keep working while
your laptop comes and goes.

- A native Mac app with its own app id and its own state, so a server and
  a desktop can run on the same Mac.
- The gateway is forced on: it is the only way in.
- Serves the web client to phones and browsers itself.
- Menu bar item only — no dock tile, no window. Pairs devices with a QR
  code, links to your Argus account and approves joins from the menu.
- Opens at login, comes back after a crash, and updates itself when no
  agent is running.

See [Argus Server](/argus/docs/server-app).

---

## Automations

Work Argus starts on its own: triggers on a schedule or a signal,
proposals queued in an inbox for you to accept, mark as done or dismiss, and an
autonomy ladder that decides how far a run may go unsupervised.

Signal sources today are GitHub issues and pull requests natively, plus
anything an agent can reach over MCP (e.g. Linear).

See [Automations](/argus/docs/automations) for the full story.

---

## Scratch pads

An agent for one-off work that belongs to no project — a quick script, a
question about several repos at once, a throwaway experiment. Each scratch pad
gets its own folder under `~/.argus/scratch-pads/`, outside every repo, and
stays in the sidebar until you delete it. Deleting one removes its folder.

Create one with the **+** next to **Scratch pads** in the sidebar, from the
command palette, or from the Projects screen on the iOS app.

---

## Usage

**Usage** in the sidebar shows how much of your Claude plan is left: the
5-hour session, the weekly caps and monthly spend, each with when it resets
and whether you are spending ahead of or under pace. Every signed-in account
gets its own section. API-key and Console sign-ins have no plan limits.

The **Cost** and **Tokens** tabs read the Claude Code sessions on this
machine and show what they used over the past 24 hours, 7, 30 or 90 days:
a daily (or hourly) chart, totals, how much caching saved, a split by
input, cache reads, cache writes and output, and a per-model breakdown.
Costs are estimates at API list prices — what the same work would cost
billed per token — and appear once the price list has downloaded.

---

## MCP server

Argus exposes its own primitives — sessions, agents, files, projects,
terminals, merges — over the Model Context Protocol, so an agent can
spawn and drive sibling sessions. Automation runs are gated: a `propose`
automation is refused `create_session` and `spawn_agent`.

An orchestrator can hand a child agent its own devices for the run —
`spawn_agent`, `spawn_agents_batch` and `create_session` take `devices`
(simulator UDIDs or names, Android serials), so one child can test on an
iPhone and an iPad at once. The child's system prompt lists every device it
holds, and no other agent is given them until it ends.

`implement_ticket` hands a Linear ticket to a new agent in a session, or to
an idle one, as [`/implement-ticket`](./integrations.md#implementing-a-ticket-with-proof):
it implements the ticket and proves every acceptance criterion on device.

### Watching a pull request

An agent that opened a pull request can call `watch_pull_request` and end
its turn. Argus checks the PR every two minutes and messages the agent when
a check fails (with GitHub's failure annotations and the end of the failing
job's log), when the checks that gate the merge all pass, when the branch
conflicts with its base, or when someone comments or reviews. Your own
comments don't count — the agent posts as you. Messages wait in the agent's
queue if it is busy. Watching stops when the PR merges or closes, or when
you turn it off.

You can start or stop it yourself from the session's pull request icon in
the sidebar (right-click it) or the session's menu on the phone. A watched
PR shows an eye next to its icon. If no agent is running in the session when
something changes, you get a notification instead. Watches live in memory,
so restarting Argus ends them.

---

## Permissions

- Every tool call an agent makes asks for approval if it isn't already
  allow-listed.
- Inline approval — the agent isn't halted; the prompt appears beside
  the tool call and the agent waits for your response.
- "Always allow" patterns persist for the rest of the session (or until
  you revoke them).
- Default permission mode is configurable in App settings:
  `default`, `acceptEdits`, `bypassPermissions`, `plan`.

---

## Orchestration tree

- Visualises agents that have spawned subagents to delegate work.
- Live: subagent status updates in real time as they run.
- Per-agent model swapping — change the model on a running agent
  mid-conversation.
- Persisted history — long-running conversations are saved to disk and
  can be resumed across app restarts.
- Pinned chats — pin a chat from its tab's menu (or a saved chat) and
  Argus resumes it on its own whenever the host restarts: same session,
  conversation, runner, model, permission mode and effort, under the same
  tab, idle until you send something. Stopping or closing a pinned chat
  keeps it pinned; unpin it to stop it coming back. A pinned chat whose
  session or worktree is gone is unpinned, with a notification.

---

## Onboarding

First launch is two screens: a welcome explaining what Argus does, and a
telemetry choice. Everything else happens in place.

- **Setup cards** — anything missing on your Mac (the `claude` CLI, a
  signed-in Claude account, git, a git identity, notification
  permission, optional device tooling) shows up as a card on the home
  screen with a one-click fix, and disappears once resolved.
- **Tools** — device tooling is opt-in from **Settings → Tools**.
  Turning a tool off hides its UI surfaces and disables its IPC
  handlers so Argus stays focused on what you use.
- **Project config generation** — Argus inspects your project and either
  proposes a sensible default (Quick generate) or asks the `claude` CLI
  for a tailored config (Generate with Claude). Both modes show the
  proposed config for review before saving it on your Mac.
- **Import from Claude Code** — next to Add repository, Argus lists the
  repositories you've used the Claude Code CLI in, with their chat count
  and last activity, and adds the ones you tick as projects. Their CLI
  chats then show up in each project's history.
- **Import from Conductor** — a repository with Conductor settings gets
  its setup script and run actions turned into a project config, and the
  workspaces Conductor made show up as sessions. See
  [Coming from Conductor](/argus/docs/coming-from-conductor).

---

## Tools

Argus's device tooling ships as opt-in tools so the base install stays
lean. Each tool's assets — native bridge binaries, the conductor CLI
tree, the scrcpy server — ship bundled with the app. Updating Argus
updates the tool assets atomically; there are no separate tool versions
or update prompts.

| Tool                    | What it adds                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| **Device recording**    | iOS Simulator + Android emulator screen capture in the runtime panel.                                    |
| **Device UI inspector** | View hierarchy, accessibility, and layout overlays on whatever device is connected. Builds on recording. |
| **Device control**      | Drive devices via `conductor` — taps, keyboard, deep links, navigation.                                  |
| **Device debug**        | Live device log streams and one-shot probes in the Debug panel. Builds on control.                       |

Toggle tools under **Settings → Tools**. A project that doesn't use
any device tooling can mask tools off for the whole team via
`.argus.json#tools.disabled` — see
[Project settings](./project-settings.md).

---

## Auto-update

Argus checks for updates in the background and prompts you to relaunch
when one is ready. Three release channels are available — `latest`
(stable), `beta` (release candidates), and `alpha` (pre-releases from
any branch). Stable users see only stable builds; switch channels under
**Settings → Advanced → Update channel** (internal testers only — alpha
and beta builds can break your install).

---

## What Argus deliberately does _not_ do

- **No cloud sync.** Sessions, worktrees, and conversations live on the
  machine that hosts them — your laptop, or your own Mac mini.
- **No mandatory account.** You sign into the `claude` CLI; Argus has no
  account of its own.
- **Telemetry stops at a headcount by default.** Argus sends one
  anonymous heartbeat per launch — a random install id and the app
  version — so we can count daily active users. Opt in to full
  analytics during onboarding (or any time from App settings) to also
  send feature-level events, errors and crashes along with standard SDK
  properties (browser/OS/screen/timezone). The raw IP is discarded
  post-ingestion, but city-level GeoIP is still derived from it before
  discard. No session replay, no DOM autocapture, no prompts, no file
  contents, no project names — full audit in
  [Telemetry](/argus/docs/telemetry).
- **Not your editor's replacement.** The code view, with language
  servers, is there for quick reads and fixes; the worktree is a normal
  directory on disk, one click away in VS Code, Cursor, Zed or Xcode.
- **No cloud in the path.** Remote access, huddles and the server app
  are your own machines talking to each other, end-to-end encrypted. An
  [Argus account](/argus/docs/accounts) is optional: it only helps your
  machines find each other.
