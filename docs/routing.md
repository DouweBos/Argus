# Routing

Every Argus client uses the URL as the single source of truth for "which
screen am I on". Every screen has a URL. Back / forward (via `Cmd+[` /
`Cmd+]`, the mouse back/forward buttons, or the title bar navigation buttons)
always returns to the previous URL.

One codec per language implements this inventory:

- **Swift** — `ArgusRoute` in ArgusCore
  (`clients/apple/ArgusCore/Sources/ArgusCore/Routing/`), shared by Argus for
  Mac and the iOS app. The Mac window's route is `DesktopRoute`, an alias of
  it; views read it and every change of screen goes through
  `DesktopModel.navigate`.
- **TypeScript** — `packages/client-core/src/routes/route.ts`
  (`parseRoute`, `routeToPath`, `routePattern`), used by the web client.

Every URL may also carry `?host=<hostId>`, naming the machine the screen reads
from. Several hosts can be attached at once (this Mac plus any paired host), so
"whose projects am I looking at" is part of what you are looking at, not
transport state. Omitted for this Mac (`hostId: "local"`).

The window is tabbed: each tab holds one saved route, and **the active tab's
route is the window URL**. There is still exactly one live route at a time —
switching tabs is a navigation, not a second source of truth. See
[Window tabs](#window-tabs).

## URL inventory

| URL                                                | Screen                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                | Home / project picker                   | Default route on launch (see `launch_route` in [App settings](./app-settings.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/agents`                                          | Agents overview                         | All agents across all sessions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/automations`                                     | Automations                             | Every automation on the focused host: trigger, last run, next run, enable switch.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/automations/quick`                               | Quick run                               | Compose a one-off run — playbook and scope — and every ad-hoc run's history. No automation is created.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/automations/quick/runs/:runId`                   | Quick run detail                        | One ad-hoc run: its report, and the button that turns it into a real automation.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `/automations/describe`                            | Describe an automation                  | Argus for Mac and iOS: draft an automation from a sentence, review it, then create it. On the Mac it opens Automations with the describe sheet showing.                                                                                                                                                                                                                                                                                                                                                                                  |
| `/automations/:automationId`                       | Automation config + run history         | Name, playbook, trigger, model, the memories runs carry forward and the list of past runs.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `/automations/:automationId/runs/:runId`           | Automation run                          | Status, cost, duration, the run's markdown report and a link to its host session.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/design?url=&session=&tab=&compare=1`             | Design viewer (web client)              | A Figma frame to fit, zoom and pan; `tab` picks the side panel (`layers` by default, `comments`, `pages` — a page's frame opens in place). With `session`, it flags a design changed since the session started, and `compare=1` diffs it against the session's simulator or emulator: the share that differs, slider, side by side and heatmap. Figma links in issues, session chips and composer chips open here.                                                                                                                       |
| `/design?url=&session=`                            | Design viewer (Mac app)                 | The same viewer, with the layers, comments and pages side by side. Reads `url` and `session` and ignores `tab` and `compare`, so web links open; compare is a button, not part of the URL.                                                                                                                                                                                                                                                                                                                                               |
| `/devices`                                         | Devices                                 | iOS simulators + Android emulators.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/devices/:platform/:deviceKey`                    | Devices, with one device's details open | `platform` is `ios`, `android` or `web`; closing the details goes back to `/devices`.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/inbox`                                           | Inbox — the briefing                    | What Argus wants from you: pending proposals to decide on, work it started that is waiting for review, and automation runs that failed. Grouped by what you would do, not by which automation produced it. Can be made the launch screen (**Settings → Appearance → Launch screen**).                                                                                                                                                                                                                                                    |
| `/inbox/proposals/:proposalId`                     | Proposal detail                         | One proposal in full: summary, rationale, confidence, and the decision itself. Home and the inbox link here rather than asking for a decision on a clamped summary.                                                                                                                                                                                                                                                                                                                                                                      |
| `/notifications`                                   | Notifications                           | Warnings & errors.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/issues`, `/issues/created`, `/issues/subscribed` | Issues                                  | Open Linear issues assigned to, created by or subscribed to by you, as a board (a column per status, a swimlane per priority) or a list. Only in the sidebar while Linear is connected.                                                                                                                                                                                                                                                                                                                                                  |
| `/issues[/<scope>]/<IDENTIFIER>`                   | Issues → issue                          | The issue as a full page, like Linear's: description, sub-issues, related issues, resources, activity (history and comment threads with replies), properties with editable status and priority, copy link / ID / branch, previous / next (`j` / `k`), Start agent.                                                                                                                                                                                                                                                                       |
| `/issues/search?q=<term>`                          | Issues → search                         | Every issue in the Linear workspace matching the term, in the same board or list with the same filters; the term is the field in the Issues toolbar. `/issues/search/<IDENTIFIER>?q=` opens one, and Back returns to the results.                                                                                                                                                                                                                                                                                                        |
| `/pull-requests`                                   | Pull requests                           | GitHub PRs of interest across open projects.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/pull-requests/:owner/:repo/:number`              | Pull request detail                     | Single PR view: description, checks, files, comments.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/runtimes`                                        | Runtimes overview                       | All running dev servers / terminals.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `/usage`                                           | Usage → Limits                          | How much of each Claude plan limit is left — the 5-hour session, the weekly caps and monthly spend — per signed-in account, with reset countdowns and pace. Tabs are part of the URL; Limits owns the bare `/usage`; Cost and Tokens get `/usage/:tab`.                                                                                                                                                                                                                                                                                  |
| `/usage/cost`                                      | Usage → Cost                            | Estimated API cost of this machine's Claude Code sessions: total, a daily (hourly for 24h) chart, totals, cost by type and per model. `?range=` (`24h`, `7d`, `30d` or `90d`) picks the window; 30d is the default and stays off the URL. The range carries across the Cost and Tokens tabs.                                                                                                                                                                                                                                             |
| `/usage/tokens`                                    | Usage → Tokens                          | The same view keyed on processed tokens; same `?range=`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `/sessions/:sessionId`                             | Session (defaults to home)              | Equivalent to `/sessions/:sessionId/home`. The Mac app has no session home and opens the agents panel.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/sessions/:sessionId/agents`                      | Session → Agents panel                  | Claude Code agents for this session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `/sessions/:sessionId/code`                        | Session → Code panel (Mac app)          | `?path=` the worktree-relative file on screen, `?line=` the 1-based line to reveal. Opening a file at a line from anywhere (chat links, diffs, blame, search) is one navigation to this route. The tab list itself is per-session view state, not a route.                                                                                                                                                                                                                                                                               |
| `/sessions/:sessionId/git`                         | Session → Git panel                     | Commit log, stashes, diffs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `/sessions/:sessionId/git/:gitView`                | Session → Git sub-view                  | `working`, `branch`, `history`, `stashes`, `reflog`, `conflicts`, `branches`, `submodules`, `bisect`, `hooks`, `compare` (?left=&right=), `blame` (?path=&ref=), `settings`, `pull-requests`, `branches-review`, `interactive-rebase` (?from=). Also `tags` as a ref-route prefix (`/git/tags/:name`). Project-scope sub-views (`branches`, `submodules`, `bisect`, `hooks`, `compare`, `blame`, `settings`, `pull-requests`, `branches-review`) only render when the session is `kind === "project_root"` or are universally available. |
| `/sessions/:sessionId/git/branches/:branchName`    | Session → Git, focused on a branch      | Renders the history view filtered to `:branchName`. The sidebar highlights the matching branch row; top-nav items stay deselected.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/sessions/:sessionId/git/tags/:tagName`           | Session → Git, focused on a tag         | Renders the history view filtered to `:tagName`. The sidebar highlights the matching tag row.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/sessions/:sessionId/home`                        | Session → Home panel                    | Per-session overview. The Mac app reads it as `/sessions/:sessionId/agents`, so old links keep working.                                                                                                                                                                                                                                                                                                                                                                                                                                  |

On the Mac `/settings` is not a route — Settings is its own window, beside the
current URL. Its pages are tabs, not routes; the Accounts tab (formerly Claude Accounts)
keeps its `accounts` id, so links and scripts that opened it still do.

## Parsed-route descriptor

Every URL parses into a `ParsedRoute` (TypeScript) or an `ArgusLocation` — an
`ArgusRoute` plus its host (Swift): the view, the session and its panel, the
git sub-view and ref name, and the ids and query parameters the rows above
name. Unknown paths fall back to home.

## Navigating

One navigation per user action makes one history step. On the Mac a second
navigation in the same run-loop pass (a selection that then picks a panel)
replaces the first rather than stacking a second entry.

Navigating carries the current `?host=` forward unless the route names a
different one, so moving between screens never silently drops you back onto
this Mac. Selecting a session names the session's own host: selecting a
session that lives on the mini moves the view there. Detaching a host falls
the view back to this Mac.

## Window tabs

The Mac window is tabbed (`DesktopModel+Tabs.swift`). A tab is a _saved
location plus identity_, with its own back / forward — never a mirror of the
live route:

- The pinned "This Mac" tab is always leftmost and cannot be closed. Every
  other tab can be closed.
- A tab's host is **derived from its path** (`?host=`), never stored twice.
- Tabs persist as paths and are restored at launch; a launch always lands the
  pinned tab on the launch screen. A tab whose host is not attached restores
  anyway, marked disconnected — it shows its last snapshot rather than
  silently moving to another machine.
- Closing a tab is a view change only: the host stays attached and its agents
  keep running.

Keyboard: `Cmd+Option+T` new tab, `Cmd+W` close tab, `Ctrl+Tab` /
`Ctrl+Shift+Tab` cycle. `Cmd+1…3` switch a session's panel and
`Cmd+Option+1…` jump to a screen.

## Back / forward

**Back / forward is per tab.** A shared history would interleave two
machines' screens into one stack, so each tab keeps its own back / forward
list. `Cmd+[` / `Cmd+]` (the Go menu), the mouse's side buttons and the title
bar buttons all step through it.

## Deep links

`argus://<path>` reads the path from the URL's host on: `argus://sessions/abc/agents`
is `/sessions/abc/agents`. The Mac app and the iOS app parse it with the same
code (`ArgusRoute` in ArgusCore), so a link opens the same screen everywhere
it can:

- **Mac app** — every route above, `?host=` included.
- **iOS app** — `/sessions/:id/agents` opens the session screen (its agents as
  tabs, its tools in a details sheet), `/sessions/:id/agents/:agentId` the same
  screen on that agent's tab, and `/git/*` and `/code` open the
  phone's changes, stashes, branches, compare or file screens. A screen the
  phone doesn't have opens its nearest parent (`/runtimes` → Home, an
  unknown device → devices). `?host=` selects that paired computer when the
  phone knows it by that id; otherwise the link reads from the current one.
  A link opened right after launch waits (up to a few seconds) for the
  computer's first project list before it falls back. Handoff from the
  desktop goes through the same mapping.
  `/sessions/new`, which the Control Center control opens, shows the
  new-agent composer on the last active project. Links from widgets and the
  control carry `?src=widget` / `?src=control`.

  The phone's tabs are the Mac's top-level destinations that fit five:
  Home (`/`), Inbox (`/inbox`), Agents (`/agents`), Automations
  (`/automations`) and More (`/more`, phone-only). More lists Pull Requests,
  Issues (with Linear connected), Devices, Usage, Notifications and Settings;
  a link to one of those opens it inside More. The iPad sidebar lists every
  destination instead, the Mac's primary rows then its footer ones, and
  highlights the session a link opened. On iPad the session screen's details
  are a side panel beside the chat (Details, Changes, Files, Terminals,
  Device), as on the Mac; it isn't part of the link.

- **Web client** — the browser app the computer serves on its own address
  (the network bundle) and the hosted app at `/argus/app/` use real paths on
  the History API, read with the same codec as the desktop
  (`@argus/client-core`), so `<web address>/sessions/abc/agents/def` opens
  the same chat as `argus://sessions/abc/agents/def`. Back, forward, reload
  and shared links all work; the computer and the hosted site serve
  `index.html` for every path. What it shows today:

  | URL                                             | Screen                                                                                                                                                                                                                                                                            |
  | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `/`                                             | Projects and recent agents                                                                                                                                                                                                                                                        |
  | `/projects/:projectKey`                         | One project's sessions and agents (web and iOS only). The key is a hash of the repo root, never the path, so no path reaches a server                                                                                                                                             |
  | `/sessions/:sessionId`                          | The session's home: start an agent (here, in a new worktree or on an existing branch), its agents, and its recent chats                                                                                                                                                           |
  | `/sessions/:sessionId/agents/:agentId`          | An agent's chat. Without `:agentId` it opens the session's newest agent, or the session's home when it has none                                                                                                                                                                   |
  | `/sessions/:sessionId/chats/:historyId`         | One of the session's saved chats, to read, resume or pin (web only)                                                                                                                                                                                                               |
  | `/sessions/:sessionId/git/branch`               | The session's changes against its base branch, and with control the land-work card: commit (summary, description, amend, sign-off, sign), push, merge into the base, change the base, open a pull request. A `/git/*` sub-view not listed here opens this                         |
  | `/sessions/:sessionId/git/working`              | The session's uncommitted changes, with the same card                                                                                                                                                                                                                             |
  | `/sessions/:sessionId/git/:mode/diff`           | One file's diff from Changes, `?path=` the file; `:mode` is `branch`, `working` or `turn:<checkpoint>` (one agent turn)                                                                                                                                                           |
  | `/sessions/:sessionId/git/branches`             | The repository's branches; on a project root each one's menu switches (offering to stash), branches from it, merges, rebases, pushes, pulls, pins, renames, deletes and compares                                                                                                  |
  | `/sessions/:sessionId/git/branches/:branchName` | One branch: where it stands, its actions and its history; `:branchName` is `origin/x` for a remote-only branch                                                                                                                                                                    |
  | `/sessions/:sessionId/git/compare`              | `?left=&right=`: the commits only one side has, the merge base and whether a merge would conflict                                                                                                                                                                                 |
  | `/sessions/:sessionId/git/stashes`              | The session's stashes (apply, pop, drop) and tags                                                                                                                                                                                                                                 |
  | `/sessions/:sessionId/git/history`              | `?commit=` one commit's diff                                                                                                                                                                                                                                                      |
  | `/pull-requests`                                | Pull requests across the computer's projects, bucketed by what they need from you                                                                                                                                                                                                 |
  | `/pull-requests/:owner/:repo/:number`           | One pull request: conversation and checks, and with control comment and merge (the strategy is remembered)                                                                                                                                                                        |
  | `/sessions/:sessionId/code`                     | `?path=&line=` a file, read-only and highlighted, at a line. Without `?path=` it opens the file list below                                                                                                                                                                        |
  | `/sessions/:sessionId/code/quick-open`          | The session's files, fuzzy-matched by name, changed files first (Cmd/Ctrl+P opens the same list over any session screen)                                                                                                                                                          |
  | `/sessions/:sessionId/code/search`              | Search across the worktree, with case, word and regex toggles (Cmd/Ctrl+Shift+F)                                                                                                                                                                                                  |
  | `/sessions/:sessionId/terminals`                | The session's terminals, read-only and live; `/terminals/:terminalId` puts one in front                                                                                                                                                                                           |
  | `/devices`, `/devices/:platform/:key`           | Devices, and one device's live screen; an unknown device opens `/devices`                                                                                                                                                                                                         |
  | `/settings`                                     | Settings (web and iOS only): this browser's pages, then the connected computer's                                                                                                                                                                                                  |
  | `/settings/:page`                               | One settings page, the phone's names: `name`, `appearance`, `alerts`, `privacy`, `connection`, `agents`, `automations`, `accounts` (every runner's sign-in; the web client still calls its Claude-only page `claude-accounts`), `device-hosts`; an unknown page opens `/settings` |
  | `/usage`, `/usage/:tab`                         | Plan limits per Claude account (`/usage`), or cost or tokens (`/usage/cost`, `/usage/tokens`) over `?range=` (`24h`, `7d`, `30d` or `90d`), as on the Mac                                                                                                                         |
  | `/notifications`                                | This visit's warnings and errors, a repeat folded into one entry with a count                                                                                                                                                                                                     |
  | `/inbox`, `/inbox/proposals/:id`                | The inbox in the Mac's groups, and one proposal in full with its decision                                                                                                                                                                                                         |
  | `/automations`, `/automations/:id`              | Automations, and one automation: its editor, memories and run history                                                                                                                                                                                                             |
  | `/automations/:id/runs/:runId`                  | One run: its report, feedback and the agent that did it                                                                                                                                                                                                                           |
  | `/automations/quick[/runs/:runId]`              | Quick Run and one quick run                                                                                                                                                                                                                                                       |
  | `/automations/describe`                         | Describe an automation (web and iOS)                                                                                                                                                                                                                                              |
  | `/design`                                       | `?url=` a Figma frame, its layers, comments and pages (`&tab=`); `&session=` adds comparing it with a device (`&compare=1`)                                                                                                                                                       |
  | `/sessions/:sessionId/browser`                  | The session's embedded browser, view-only and live (web only)                                                                                                                                                                                                                     |
  | `/issues[/<scope>][/<ID>]`                      | Linear issues (assigned, created, subscribed; `/issues/search?q=`) as a board or list with filters, and one issue as a page                                                                                                                                                       |

  Any other route opens its nearest parent, as on iOS, which today is Home.
  From tablet width the project list (or the project an agent belongs to)
  stays beside the screen the URL names, the inbox and automations included;
  browsing it while something is open moves that pane only, and Close returns to it. Back from a screen a link
  opened goes to its parent rather than out of the app.

  In the hosted app `?host=<hostId>` names the account computer, survives
  every navigation and is dropped by "Computers"; an id the account can't
  reach shows as unavailable and never falls back to another computer. The
  network bundle is always its own computer and ignores `?host=`. Secrets
  stay in the fragment, which never reaches a server: huddle links
  (`#/huddle/<token>`) and pairing codes (`#/pair/<code>`, read once and
  removed from the address bar). A notification opened with no tab still
  launches at `/?agent=<id>` (plus `&decide=&tool=` for Approve/Deny); the
  client replays it and strips the parameters.

## Invariants

1. **Every screen change pushes exactly one history entry.** If you find
   yourself navigating twice for one action, collapse it into one — the back
   button's usefulness depends on this.
2. **Nothing mirrors the URL.** If a view needs to know which session or
   screen is active, it reads the route.
3. **State that is not in the URL is not routable.** If a "screen" is worth a
   back-button entry, add it to the URL inventory above.
4. **Tab identity is window state; which screen is showing is not.** The tab
   list, its order and the active tab are the window's. What that tab is
   _showing_ is the URL, as always — never add a `selectedX` field for a
   screen a route segment can carry.
5. **The focused host is route state; the connections are not.** `?host=`
   says which machine a screen reads from. Which hosts are _attached_ is
   connection state — they keep streaming whether or not you are looking at
   them, and a shared link must not try to attach anything.
