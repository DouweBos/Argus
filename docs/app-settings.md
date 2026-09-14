# App settings

App-level settings apply to your install of Argus, regardless of which
project is open. They live on your machine and are not shared with the
team.

Open them with **⌘,** or from the command palette → _Settings_.

For project settings _shared_ with the team (setup commands, run
targets, related projects, …) see
[Project settings](./project-settings.md).

---

## Appearance

| Setting          | Default   | Description                                                                                                                  |
| ---------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Theme**        | `system`  | `system`, `light`, or `dark`. `system` follows the OS appearance.                                                            |
| **Display size** | `default` | One of `larger`, `large`, `default`, `small`, `smaller`. Scales the whole app — useful on very large or very small displays. |

---

## Claude account

Stay signed in to several Claude accounts at once and switch between them
instantly — no logging out, no terminal.

- **Accounts** — every account you've signed in, with its email, organization
  and plan. Click a row to make it active; agents, terminals and one-shot
  helpers started from then on use it. Rename a row to give an account a
  friendlier label, or remove it to sign out and forget it. A row marked
  **Signed out** has credentials that stopped working — **Sign in again** renews
  them in place, keeping the session pins and the label.
- **Add another account** — pick **Claude subscription** or **Anthropic
  Console**, then click Add account. Argus opens your browser to authenticate;
  approve access there and it signs in automatically — no code to copy. (If the
  browser can't open, it falls back to asking for a pasted code.) Accounts
  already signed in stay signed in.

Switching never interrupts a running agent — each agent keeps the account it
started with.

**Pinning a session to an account.** Once you have more than one account, the
model picker in the chat input grows an **Account** section. Pin a session there
to run it on a specific account regardless of which one is active — handy when
one account is rate-limited and you want work to continue on another in
parallel. Sessions default to _Follow app default_.

Your first account is adopted from whatever `claude` was already logged into, so
upgrading Argus never costs you a re-authentication.

Additional accounts store their credentials under
`~/.argus/claude-accounts/<id>/`, alongside their own copy of the Claude CLI's
`.claude.json` so each account carries its own identity and organization. The
location is part of how the credentials are keyed, so moving or renaming
`~/.argus` means signing those accounts in again — nothing else breaks.
Everything else the Claude CLI keeps in `~/.claude` (settings, `CLAUDE.md`,
plugins, transcripts) is linked back to the shared copy, so it stays one set of
files across accounts.

---

## Agents

| Setting                     | Default | Description                                                                                            |
| --------------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| **Default permission mode** | `auto`  | The permission mode applied to every new agent — at spawn — unless overridden in the new-agent picker. |

Permission modes:

- **`auto`** — smart classifier auto-approves safe actions; risky ones still
  ask.
- **`ask`** — agent asks before each edit, command, or write that isn't
  already allow-listed.
- **`plan`** — plan-only mode; no edits or shell.
- **`review`** — auto-approves file edits; still asks for shell + network.
- **`trusted`** ("yolo") — runs every tool without prompting.

The mode is applied at spawn time, so it takes effect for the agent's very
first action. Agents restored to an earlier turn keep the mode they were
running with.

---

## LLM

App-level default for which LLM runner and model power new sessions. The
runner is fixed at session creation; the model can still be overridden by
[`.argus.json`](./project-settings.md), individual sessions, or the
new-agent picker.

| Setting           | Default       | Description                                                                                                                            |
| ----------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Runner**        | `claude-code` | The CLI/agent that drives sessions. Claude Code is the built-in runner; any [custom runner](#custom-runners) you add appears here too. |
| **Default model** | _(empty)_     | Optional model id passed to the runner — e.g. `claude-opus-4-7`. Leave blank to let the runner pick its own default.                   |

Resolution order for the runner (at session creation):

1. Project default — the `llm.runner` field in
   [`.argus.json`](./project-settings.md).
2. App default — this setting.

Resolution order for the model (at every agent spawn):

1. Agent override (set in the new-agent picker).
2. Session model (carried on the session, defaulted from project/app at
   create time).
3. Project default — `llm.model` in `.argus.json`.
4. App default — this setting.
5. The runner's own default (custom runners declare one).
6. Whatever the runner picks if none of the above specify a model.

---

## Custom runners

A custom runner reuses an official runner's CLI but points it at a different
endpoint — a gateway like callstack.ai's Apex, a proxy, or a self-hosted
model. Everything else (permissions, MCP, restore-at-turn, the whole agent
experience) is unchanged, because it is still the same CLI underneath.

Pick a template to start from, fill in the fields, and hit **Save**. The
runner then shows up in the runner picker when you create a session, and in
the **LLM** section as an app-wide default.

| Field             | Description                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Name**          | Shown wherever runners are listed. The id (`custom:<slug>`) is derived from it and never changes afterwards.                     |
| **Based on**      | The official runner it delegates to. Claude Code today.                                                                          |
| **Default model** | Used when neither the agent, session, project, nor app default pins a model.                                                     |
| **Environment**   | Variables layered on top of the base runner's environment for every agent and one-shot call. An empty value _unsets_ a variable. |
| **Models**        | Models offered in the model picker. Leave empty to fall back to whatever the base runner advertises.                             |

Values whose name looks like a credential (`token`, `key`, `secret`,
`password`) are masked until you click **Show**. Custom runners are stored in
`~/.argus/custom-runners.json` (readable only by you, since it holds API
tokens) and are never written into the repository — `.argus.json` only
references a runner by id.

### Example: Apex (callstack.ai)

The **Apex (callstack.ai)** template pre-fills everything except your API key:

| Variable                         | Value                      |
| -------------------------------- | -------------------------- |
| `ANTHROPIC_BASE_URL`             | `https://api.callstack.ai` |
| `ANTHROPIC_AUTH_TOKEN`           | your `sk-…` key            |
| `CLAUDE_CODE_ATTRIBUTION_HEADER` | `0`                        |

with `callstack/Apex` as both the listed and the default model.

---

## Open in apps

| Setting            | Default | Description                                                    |
| ------------------ | ------- | -------------------------------------------------------------- |
| **Custom editors** | `[]`    | Extra entries shown in the _Open in…_ menu on repos and files. |

Each entry has a **Name** and a **Command**. The command is either:

- a CLI on `PATH` — e.g. `zed`, `code`, `subl`, `idea`. Argus invokes
  `<command> <path>` with the worktree root.
- an absolute path to a `.app` bundle — e.g. `/Applications/Zed.app`.

---

## MCP servers

| Setting         | Default | Description                                                         |
| --------------- | ------- | ------------------------------------------------------------------- |
| **MCP servers** | `{}`    | Personal MCP servers merged into every Argus agent on this machine. |

Each entry has a **Name** and a JSON config matching the standard
`mcpServers` shape — for example:

```jsonc
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-everything"],
}
```

Use this for servers _you_ want available. For servers the whole team
should get, use the project-level `mcp_servers` in
[`.argus.json`](./project-settings.md).

---

## Privacy

| Setting                      | Default | Description                                                                                                                                                                         |
| ---------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Send anonymous telemetry** | `false` | Sends anonymous usage and crash events to PostHog so we can find bugs and prioritise features. Consent is collected once during onboarding (telemetry step); flip it any time here. |

---

## Tools

Argus's device tooling — recording, control, debug streams, the UI inspector — ships as togglable **tools**. Turn off the ones you don't use to keep the UI focused on what you actually reach for.

| Tool                    | What it does                                                               | Needs                                                         |
| ----------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Device recording**    | Stream iOS Simulator and Android emulator screens into the runtime panel.  | Native sim bridge, Xcode + iOS runtimes, Android SDK + an AVD |
| **Device UI inspector** | Inspect view hierarchy, accessibility, and layout on a connected device.   | Device recording (auto)                                       |
| **Device control**      | Drive devices via `conductor` — taps, keyboard, deep links, navigation.    | Android SDK (for Android), Playwright (for web)               |
| **Device debug**        | Tail device logs, memory, and other conductor probes from the Debug panel. | Device control (auto)                                         |

Pick tools during onboarding (the **Tools** step before Preflight) or at any time from **Settings → Tools**. All tool assets ship bundled with the app — toggling a tool on or off only affects whether its UI surfaces and IPC handlers are active.

Each tool row in Settings runs its declared prereq checks live and surfaces **Install** buttons for the ones we know how to fix. Failed prereqs don't block the toggle, but the surfaces that depend on a missing prereq will error gracefully when used.

The preflight onboarding step is filtered to your enabled tools' prereqs plus the four core checks (`claude_cli`, `claude_auth`, `git_cli`, `git_identity`). A user who picks zero tools sees only the four core checks.

### Conductor version

Argus ships with a bundled version of the `conductor` CLI (the tool agents use to drive iOS/Android/web devices). The **Conductor version** dropdown under Settings → Tools lets you pin a different published version without waiting for an Argus release — useful for picking up a conductor fix or trying a newer build.

- The dropdown lists stable versions published to npm, newest first. Only versions **at or above the bundled one** are offered — older conductors predate APIs the app relies on.
- Pick a version and Argus installs `@houwert/conductor@<version>` on demand into `~/.argus/conductor/<version>/`, then points every agent's `conductor` invocation at it.
- Pick **Bundled** to revert to the version that shipped with the app.
- Installing requires **`npm` on your PATH** (Electron's Node has none) and registry access. If the install fails — npm missing, unknown version, offline — Argus keeps using the bundled version and shows the error.
- The pinned version persists at `~/.argus/conductor.json` and is re-provisioned on next launch if needed. Machine-local; not shared with your team.

---

## Advanced — Update channel

| Setting     | Default  | Description                                                                                                                                                                                                               |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Channel** | `latest` | Auto-updater feed. **Production** (`latest`) tracks the public releases. **Beta** subscribes to in-development builds of upcoming features cut from `main` — should work, but may contain bugs that haven't surfaced yet. |

Production users never see beta builds — they're published under a separate `beta-mac.yml` feed file. Switching channels takes effect on next app restart.

> Alpha builds (one-off cuts from any branch) are not exposed in this dialog. Repo collaborators install them manually by downloading the `.dmg` from the corresponding GitHub release.

What we send (when the toggle is on):

- Anonymous install id (random UUID). Wiping it rotates the id. The id
  isn't linked to a person, account, or email.
- App version, OS, OS version, CPU architecture.
- Standard auto-properties added by PostHog's web SDK in the renderer:
  browser type/version/language, user agent, screen and viewport size,
  timezone, in-app URL (always local — never external sites), and a
  per-SDK-session id.
- Approximate location, derived **server-side at PostHog** from the
  request IP: country, region, city, postal code, and a city-level
  latitude/longitude. We have **Discard client IP data** enabled on the
  PostHog project, so the raw IP is not stored alongside the event —
  but PostHog still uses it at ingestion to derive these GeoIP fields
  before discarding. PostHog doesn't expose a switch to skip
  enrichment entirely. If even city-level geography is unacceptable,
  leave telemetry off.
- Argus-specific events documented in
  [telemetry-events.md](./telemetry-events.md) — feature usage signals
  with the small, named props listed there. Never raw arguments, file
  paths, or project content.
- Errors and crashes. Stack traces are scrubbed of user home directory
  paths.

What we do **not** send:

- Session replays / DOM recordings.
- DOM autocapture — element selectors, click targets, form inputs.
- Prompts, file contents, agent output, project names, branch names,
  repo paths, or any other content of your work.
- A person profile linking the install id to a name, email, or
  account.

Telemetry is hard-disabled in development builds, regardless of the
toggle.

For the full per-event catalogue and exhaustive property list, see
[telemetry-events.md](./telemetry-events.md).

---

## Git

Defaults for the git panel. Each setting also has an inline toggle in
the relevant toolbar — use the dialog when you want to set the
default for every project on this machine.

| Setting                                | Default   | Description                                                                                                   |
| -------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| **Working copy view**                  | `flat`    | `flat` shows changed files as a list; `tree` groups them by directory.                                        |
| **Diff layout**                        | `unified` | `unified` stacks removed/added lines; `split` shows them side-by-side.                                        |
| **Ignore whitespace in diffs**         | `false`   | Hide pure-whitespace changes when comparing files.                                                            |
| **Highlight word-level changes**       | `false`   | Inline word-diff inside changed lines.                                                                        |
| **Conventional Commits picker**        | `false`   | Show a commit-type prefix picker (`feat`, `fix`, `chore`, …) in the commit composer.                          |
| **Default pull strategy**              | `ff-only` | Used by the project-scope pull dialog when you don't pick a strategy. One of `ff-only`, `merge`, or `rebase`. |
| **Show ignored files**                 | `false`   | Include files matched by `.gitignore` in the working copy list.                                               |
| **Show assume-unchanged files**        | `false`   | Include files marked with `git update-index --assume-unchanged`.                                              |
| **Show unmodified files in tree view** | `false`   | Only applies when the working copy view is set to Tree — shows tracked files that aren't currently modified.  |

A few git-panel preferences are intentionally _not_ in this dialog
because they're pure layout state: the source-sidebar collapsed state
and width, which sub-sections are collapsed, and the
"don't-ask-again" map for confirm dialogs. Those persist
automatically as you use the panel.

---

## Git signing

Per-repo commit-signing toggles. Read and written to the local git config of
the currently selected session worktree, so each project keeps its own
preferences.

| Setting            | Git config key    | Description                                                            |
| ------------------ | ----------------- | ---------------------------------------------------------------------- |
| **Enable signing** | `commit.gpgsign`  | When on, every commit is signed (Argus relies on git's own machinery). |
| **Signing format** | `gpg.format`      | `gpg` or `ssh`.                                                        |
| **Signing key**    | `user.signingkey` | GPG key id, fingerprint, or path to an SSH key.                        |

Signing failures are surfaced via `<GitErrorBanner kind="signing-failed">`
with a "Configure signing" recovery action that re-opens this section.

---

## Per-project personal settings

These are machine-local settings _about_ a specific project. They live
in `~/.argus/user-project-settings.json` and never get committed to
your repo.

| Setting           | Default | Description                                                                                                                                                                         |
| ----------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Branch prefix** | `""`    | Prepended to the branch name when creating a session in this project (e.g. `douwe/`, `team/feature-`). Leave empty to disable. Already-prefixed user-typed branches aren't doubled. |

---

## Remote Access

Pair a phone to monitor your projects and agents from anywhere. Argus runs a
local, loopback-only gateway and exposes it through a tunnel — no inbound ports
are opened on your machine. All traffic is end-to-end encrypted (Noise IK); the
tunnel only ever sees ciphertext. Paired devices are **monitor + approve only** —
they can view projects/sessions/agents and approve or deny permission prompts,
but cannot spawn agents, send messages, or run commands.

| Setting                                     | Default | Description                                                                                                                                                                            |
| ------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Enable remote access**                    | Off     | Master kill-switch. Off ⇒ the gateway + every tunnel stay down and pairing is refused.                                                                                                 |
| **Ways in**                                 | All off | **Local network**, **Tailscale** (`tailscale funnel`) and **Cloudflare** (`cloudflared`) toggle independently and run side by side. A tunnel needs that provider's CLI on your `PATH`. |
| **Addresses**                               | —       | Read-only list of every address that's live right now, in the order phones try them. Synced to paired devices on connect.                                                              |
| **Tunnel** (Cloudflare)                     | `quick` | **Quick** = ephemeral `*.trycloudflare.com` URL, no account. **Named** = stable hostname via a connector token + a domain.                                                             |
| **Connector token**                         | `""`    | Cloudflare tunnel token (named mode). From `cloudflared tunnel token <name>` or the dashboard. Stored encrypted.                                                                       |
| **Public URL**                              | `""`    | The hostname mapped to this machine in Cloudflare (named mode). For quick tunnels it's discovered automatically and shown read-only.                                                   |
| **Paired devices**                          | —       | Each shows its label and last-seen time. **Revoke** deletes its pinned key and drops any live session immediately.                                                                     |
| **Background push**                         | Off     | Wake paired phones and browsers with a real notification when they aren't connected. Nothing to configure.                                                                             |
| **Notify my devices while I'm using Argus** | Off     | Mirror notifications to phones and browsers even when the Argus window is focused. Off ⇒ they stay quiet while you're at the desktop.                                                  |

### Choosing ways in

These are not mutually exclusive — enable as many as you like and they run at
the same time, each in its own process. The phone then picks between them (see
[Picking a route](#picking-a-route)), so the usual setup is **Local network +
Tailscale**: fast at home, reachable everywhere else.

- **Local network**: no tunnel and no external process at all — pair over Wi-Fi
  with the web client below. Enabling remote access with only this spawns
  nothing beyond the local gateway. Add a tunnel when you need access from
  _off_ your network.
- **Cloudflare — Quick**: zero setup, just the
  [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
  binary. The URL rotates each run, so you re-pair after a restart. Good for a
  first try.
- **Cloudflare — Named**: stable hostname, survives restarts, but needs a
  (free) Cloudflare account **and a domain on Cloudflare**.
- **Tailscale**: stable `*.ts.net` address with **no domain and no Cloudflare
  account** — just the `tailscale` CLI, signed into a tailnet with
  [Funnel](https://tailscale.com/kb/1223/funnel) enabled. Often the sweet spot
  for a stable URL without owning a domain. Argus checks each prerequisite (CLI,
  service, sign-in, Funnel) in Settings and offers a one-click fix for each.

### Picking a route

A desktop usually has several addresses at once, so the phone doesn't make you
choose. On connect it dials **every** known address in parallel and keeps the
simplest one that completes the pinned-key handshake:

1. Local network
2. Tailscale
3. Cloudflare

The full handshake — not just a socket open — is what counts as success, so a
stale LAN IP that now belongs to another machine, or a captive portal that
accepts any connection, can never win: only the real desktop holds the pinned
key. If a worse-ranked address answers first, the phone waits briefly for a
better one before settling.

The address list is re-synced on every connect and whenever a tunnel comes up or
dies, so **turning on a new way in doesn't require re-pairing** — an existing
phone learns the new address the next time it connects over any route that still
works.

### One phone, several computers

A phone can pair with as many computers as you like — a laptop and a desktop,
say. Each pairing keeps its own key, URL and grant, and the phone's home screen
lists them all with their connection state; tapping one connects to it and shows
its projects. The app talks to a single computer at a time, so switching clears
what the previous one had loaded. Tapping a notification switches to whichever
computer the agent belongs to before opening the chat.

The computer's name (from macOS **Computer Name**) travels in the pairing grant
so the list reads "Douwe's MacBook Pro" rather than a tunnel URL; you can rename
it on the phone. Unpairing there removes the phone's copy of that computer's
key — to cut a lost phone off for good, **Revoke** it under **Paired devices**
on the computer as well.

### Background push notifications

While a client is connected it gets notifications in-band over the gateway
socket. Once the app is backgrounded, killed, or the last browser tab is closed
that socket is gone, so Argus sends a real push instead.

**Browsers** are reached directly. Web Push keys (VAPID) are self-asserted, so
Argus generates its own on first use, encrypts each notification for that
subscription (RFC 8291), and posts it to whatever push service the browser
picked. No third party is involved and there is nothing to configure. It does
need a **secure context**, so it works over a Cloudflare/Tailscale tunnel but
_not_ over a plain `http://<lan-ip>` address — browsers refuse to register a
service worker there. Safari only offers it to a PWA you've added to the Home
Screen / Dock.

**Phones** can't work that way: only the Apple team that owns the app's bundle
id may push to it, so that credential can't live in your copy of Argus. It sits
in the **Argus push relay** instead (a Cloudflare Function at
`houwert.dev/argus/push`), which forwards to APNs and FCM on your behalf.

The relay is deliberately given as little as possible:

- **It can't read your notifications.** Argus encrypts the whole thing — title,
  body, which agent, which project — with AES-256-GCM under a key your _phone_
  minted and shared over the paired, Noise-encrypted gateway. The relay
  forwards a blob; the alert Apple carries is a fixed "Argus — New activity"
  placeholder, and the phone's notification extension swaps in the real text
  before anything is shown. Even the collapse header is a keyed digest, so your
  agent ids never leave your machine.
- **It won't push to you on a stranger's say-so.** Your phone registers a
  second key with the relay, and every send must be signed with it. The
  signature covers the device, the payload, and a timestamp, so it can't be
  replayed elsewhere. A leaked device token on its own buys nothing, and the
  first registration for a token wins — replacing one requires signing with the
  key already on file.

Nothing here needs configuring. The one editable field is the **push service
contact** — a `mailto:` or `https:` address Mozilla, Google, and Apple use to
reach you if a browser notification misbehaves.

### Quick actions

A notification asking for approval carries **Approve** and **Deny** buttons, and
they are the same buttons everywhere: on the macOS banner, on the phone, and in
the browser. The desktop decides the action set once, so no surface can drift
out of step. Answering from the button never opens the app — the decision goes
straight to the agent, and every other surface clears the prompt.

`AskUserQuestion` prompts deliberately get no buttons: picking an option isn't a
yes/no, so those open the app to be answered properly.

Actions survive being offline. Approve a prompt on a locked phone with the app
killed and the answer is queued, then replayed the moment the gateway comes
back (dropped after 30 minutes, on the grounds that a stale answer is worse than
none). The same holds for a browser actioned with every tab closed.

Android buttons now survive a stopped app too: because the payload is
encrypted, Android can't have the system draw it, so a background task decrypts
and posts the notification itself — and gets to attach the buttons while it
does.

**Browsers** need nothing from you. Argus generates its own VAPID signing key
the first time a browser subscribes, encrypts each notification for that
subscription (RFC 8291), and posts it to whatever push service the browser
picked. The only thing worth setting is the **contact** — a `mailto:` or
`https:` address push services use to reach you if your messages misbehave.

Web Push needs a **secure context**, so it works over a Cloudflare/Tailscale
tunnel but _not_ over a plain `http://<lan-ip>` address — browsers refuse to
register a service worker there. Safari only offers it to a PWA you've added to
the Home Screen / Dock.

Phones, on the other hand, need the credentials for the app you installed,
because your desktop is impersonating that app's own server:

**Apple (iOS)** — from Apple Developer → **Keys**, create a key with the _Apple
Push Notifications service (APNs)_ capability and download the `.p8`. Paste the
key contents plus its **Key ID**, your **Team ID**, and the app's **bundle
identifier** (`dev.houwert.argus.remote` unless you rebuilt it). Argus figures
out sandbox vs. production on its own — if the first send is rejected as the
wrong environment it retries the other one and remembers which worked.

**Firebase (Android)** — from Firebase → Project settings → **Service
accounts**, generate a private key and paste the whole JSON blob. The Android
build also needs the matching `google-services.json` at
`clients/argus-remote/google-services.json` plus
`"googleServicesFile": "./google-services.json"` under `android` in
`app.json`, otherwise the app can't obtain an FCM token to register.

Credentials are stored in the same `safeStorage`-encrypted file as the device
keys (`~/.argus/remote-devices.json`), never in plaintext `app-settings.json`,
and are never read back into the UI — the settings screen only shows whether a
key is present. **Test push** next to a paired device sends a real notification
and shows the provider's rejection reason if it fails.

On the phone, **Settings → Background push** turns registration on or off. A
device that has registered shows _push registered_ in the desktop's paired list.

### Notify my devices while I'm using Argus

By default a notification only leaves this machine when the Argus window isn't
focused — otherwise your phone buzzes for an agent you're already watching on
screen. Turn this on to mirror every notification to your devices regardless.
The local banner is unaffected: it is always suppressed while the window has
focus.

### Web client on this network

Toggling **Web client on this network** binds the gateway to your Wi-Fi
interface and serves a browser client from it. Open `http://<your-ip>:47615` on
any device on the same network — no app install, no tunnel. It still pairs and
Noise-authenticates exactly like the phone, so being on the LAN grants no
access on its own. You can also reach it from the Home screen's **Remote access**
button. (Build the bundle once with `pnpm --filter argus-web build`.)

**Pairing** shows a QR code (and a copy-paste code) plus a 6-digit confirmation
number. Scan it on the device, confirm the number matches on both screens, and
the device is enrolled. The pairing secret travels only in the QR/code — never
over the wire — so nothing in the middle (Cloudflare or Tailscale included) can
impersonate your desktop.

The desktop identity key lives in `~/.argus/remote-devices.json` (encrypted via
`safeStorage`); the tunnel settings live in `app-settings.json`.

---

## Where things are stored

Argus keeps everything under `~/.argus/`:

```
~/.argus/
  worktrees/                  ← Session worktrees (one dir per repo)
  sessions/                   ← Session metadata
  app-settings.json           ← MCP servers, remote-access tunnel + kill-switch
  claude-accounts.json        ← Signed-in Claude accounts + the active one
  claude-accounts/            ← Per-account Claude credentials
  remote-devices.json         ← Remote-access identity key, paired devices, push credentials (encrypted)
  user-project-settings.json  ← Per-developer project prefs (branch prefix, …)
  telemetry-id                ← Anonymous install id (only present if telemetry is on)
```

UI preferences (theme, display size, default permission mode, default
LLM runner/model, custom editors) live in the app's `localStorage`.
Delete a file or wipe the
directory at any time — Argus recreates what it needs on next launch.
