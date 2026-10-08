# Routing

Argus uses **react-router-dom**'s `MemoryRouter` with the URL as the single
source of truth for "which screen am I on". Every screen has a URL. Back /
forward (via `Cmd+[` / `Cmd+]`, the mouse back/forward buttons, or the title
bar navigation buttons) always returns to the previous URL.

No Zustand store mirrors the route. Reads go through URL-derived hooks
(`useCurrentRoute` and friends); writes go through `appNavigate(route)`.

Every URL may also carry `?host=<hostId>`, naming the machine the screen reads
from. Several hosts can be attached at once (this Mac plus any paired host), so
"whose projects am I looking at" is part of what you are looking at, not
transport state. Omitted for this Mac (`hostId: "local"`).

The window is tabbed: each tab holds one saved route, and **the active tab's
route is the window URL**. There is still exactly one live route at a time —
switching tabs is a navigation, not a second source of truth. See
[Window tabs](#window-tabs).

## URL inventory

| URL                                             | Screen                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                             | Home / project picker                   | Default route on launch (see `launch_route` in [App settings](./app-settings.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/agents`                                       | Agents overview                         | All agents across all sessions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/automations`                                  | Automations                             | Every automation on the focused host: trigger, last run, next run, enable switch.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/automations/quick`                            | Quick run                               | Compose a one-off run — playbook and scope — and every ad-hoc run's history. No automation is created.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/automations/quick/runs/:runId`                | Quick run detail                        | One ad-hoc run: its report, and the button that turns it into a real automation.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `/automations/:automationId`                    | Automation config + run history         | Name, playbook, trigger, model, the memories runs carry forward and the list of past runs.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `/automations/:automationId/runs/:runId`        | Automation run                          | Status, cost, duration, the run's markdown report and a link to its host session.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/devices`                                      | Devices                                 | iOS simulators + Android emulators.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/devices/:platform/:deviceKey`                 | Devices, with one device's details open | `platform` is `ios`, `android` or `web`; closing the details goes back to `/devices`.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/inbox`                                        | Inbox — the briefing                    | What Argus wants from you: pending proposals to decide on, work it started that is waiting for review, and automation runs that failed. Grouped by what you would do, not by which automation produced it. Can be made the launch screen (**Settings → Appearance → Launch screen**).                                                                                                                                                                                                                                                    |
| `/inbox/proposals/:proposalId`                  | Proposal detail                         | One proposal in full: summary, rationale, confidence, and the decision itself. Home and the inbox link here rather than asking for a decision on a clamped summary.                                                                                                                                                                                                                                                                                                                                                                      |
| `/notifications`                                | Notifications                           | Warnings & errors.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/pull-requests`                                | Pull requests                           | GitHub PRs of interest across open projects.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/pull-requests/:owner/:repo/:number`           | Pull request detail                     | Single PR view: description, checks, files, comments.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/runtimes`                                     | Runtimes overview                       | All running dev servers / terminals.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `/sessions/:sessionId`                          | Session (defaults to home)              | Equivalent to `/sessions/:sessionId/home`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `/sessions/:sessionId/agents`                   | Session → Agents panel                  | Claude Code agents for this session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `/sessions/:sessionId/code`                     | Session → Code panel (Mac app)          | `?path=` the worktree-relative file on screen, `?line=` the 1-based line to reveal. Opening a file at a line from anywhere (chat links, diffs, blame, search) is one navigation to this route. The tab list itself is per-session view state, not a route.                                                                                                                                                                                                                                                                               |
| `/sessions/:sessionId/git`                      | Session → Git panel                     | Commit log, stashes, diffs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `/sessions/:sessionId/git/:gitView`             | Session → Git sub-view                  | `working`, `branch`, `history`, `stashes`, `reflog`, `conflicts`, `branches`, `submodules`, `bisect`, `hooks`, `compare` (?left=&right=), `blame` (?path=&ref=), `settings`, `pull-requests`, `branches-review`, `interactive-rebase` (?from=). Also `tags` as a ref-route prefix (`/git/tags/:name`). Project-scope sub-views (`branches`, `submodules`, `bisect`, `hooks`, `compare`, `blame`, `settings`, `pull-requests`, `branches-review`) only render when the session is `kind === "project_root"` or are universally available. |
| `/sessions/:sessionId/git/branches/:branchName` | Session → Git, focused on a branch      | Renders the history view filtered to `:branchName`. The sidebar highlights the matching branch row; top-nav items stay deselected. Use `setGitRef("branches", name)`.                                                                                                                                                                                                                                                                                                                                                                    |
| `/sessions/:sessionId/git/tags/:tagName`        | Session → Git, focused on a tag         | Renders the history view filtered to `:tagName`. The sidebar highlights the matching tag row. Use `setGitRef("tags", name)`.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/sessions/:sessionId/home`                     | Session → Home panel                    | Per-session overview.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

`/settings` is not a route — the settings dialog is overlaid on top of the
current URL.

## Parsed-route descriptor

Every URL parses into a `ParsedRoute`:

```ts
interface ParsedRoute {
  view:
    | "agents"
    | "automations"
    | "devices"
    | "home"
    | "inbox"
    | "notifications"
    | "pull-request-detail"
    | "pull-requests"
    | "runtimes"
    | "session";
  sessionId: string | null; // set when view === "session"
  panel: "agents" | "git" | "home"; // only meaningful when view === "session"
  gitView:
    | "working"
    | "branch"
    | "history"
    | "stashes"
    | "reflog"
    | "conflicts"
    | "branches"
    | "tags"
    | "submodules"
    | "bisect"
    | "blame"
    | "compare"
    | "hooks"
    | "pull-requests"
    | "branches-review"
    | "settings"
    | null; // only meaningful when panel === "git"
  gitRefName: string | null; // set when gitView is "branches"/"tags" and a name segment follows
  proposalId: string | null; // set on /inbox/proposals/:proposalId
  automationId: string | null; // set on /automations/:automationId and below
  automationQuick: boolean; // true on /automations/quick and below
  automationRunId: string | null; // set on either …/runs/:runId
  hostId: string; // "?host=" — the attached host this screen reads from; "local" for this Mac
}
```

Unknown paths fall back to `{ view: "home", ... }`.

## Reading the current route

In React components, use a URL-derived hook from `app/lib/routeHooks.ts`:

```ts
import {
  useCurrentRoute,
  useRouteView,
  useRouteSessionId,
  useRouteSessionPanel,
} from "app/lib/routeHooks";
```

Or the semantic aliases exposed by the stores — they read the URL under the
hood:

- `useSelectedSessionId()` (in `sessionStore`)
- `useCenterView()` (in `centerViewStore`)
- `useActiveCenterView()` (in `editorStore`) — the session panel

For non-hook callers (event handlers, async helpers, services), use the
imperative accessors:

- `getCurrentRoute()` / `getCurrentPath()` from `app/lib/router.ts`
- `getSelectedSessionId()` from `sessionStore`
- `getActiveCenterView()` from `editorStore`
- `getCenterView()` from `centerViewStore`

## Navigating

There is exactly one write primitive:

```ts
import { appNavigate } from "app/lib/router";

appNavigate({ view: "session", sessionId: "abc", panel: "git" });
appNavigate({ view: "notifications" });
appNavigate({ view: "home" }, { replace: true });
```

The following store helpers are thin wrappers around `appNavigate` — use
whichever reads best:

| Helper                       | Effect                                                      |
| ---------------------------- | ----------------------------------------------------------- |
| `selectSession(id)`          | `/sessions/{id}/{currentPanel}`                             |
| `selectSession(null)`        | `/`                                                         |
| `setCenterView(view)`        | `/{view}`                                                   |
| `openInbox()`                | `/inbox`                                                    |
| `openProposal(id)`           | `/inbox/proposals/{id}`                                     |
| `openAutomations()`          | `/automations`                                              |
| `openAutomation(id)`         | `/automations/{id}`                                         |
| `openAutomationRun(id, run)` | `/automations/{id}/runs/{run}`                              |
| `openQuickRuns()`            | `/automations/quick`                                        |
| `openQuickRun(run)`          | `/automations/quick/runs/{run}`                             |
| `setActiveCenterView(panel)` | `/sessions/{currentSessionId}/{panel}` (no-op off-route)    |
| `navigateToPath(path)`       | Raw path (used by deep-link IPC handler)                    |
| `setFocusedHost(hostId)`     | `?host={hostId}` — points the view at another attached host |

`appNavigate` carries the current `?host=` forward unless the descriptor names
a different one, so moving between screens never silently drops you back onto
this Mac. `selectSession(id)` names the session's own host: selecting a session
that lives on the mini moves the view there. Detaching a host falls the view
back to this Mac.

## Building paths

`routeToPath(route)` converts a `Partial<ParsedRoute>` into a pathname.
Prefer `appNavigate(route)` in callers; use `routeToPath` only when you need
the raw string (e.g. for an `<a href>` or to compare to another path).

## Window tabs

`app/stores/tabStore.ts` holds the tab list, the active tab, and each tab's
back / forward stacks. A tab is a _saved route plus identity_ —
`{ id, path, title, pinned }` — never a mirror of the live route:

- The pinned `tab-local` tab ("This Mac") is always leftmost and cannot be
  closed. Every other tab can be closed, dragged, and reordered after it.
- A tab's host is **derived from its path** (`?host=`), never stored twice.
- Switching tabs calls `navigateToPath(tab.path)`; navigating inside a tab
  updates that tab's saved path via `recordNavigation()`
  (`app/hooks/useTabRouteSync.ts`, mounted in `RouterGlue`).
- Tabs and the active tab persist to `localStorage` (`argus:window-tabs`) and
  are restored at launch. A tab whose host is not attached restores anyway,
  marked disconnected — it shows its last snapshot rather than silently moving
  to another machine.
- Closing a tab is a view change only: the host stays attached and its agents
  keep running.

Openers: `app/lib/tabActions.ts` (`openHostTab`, `openSessionTab`), the "+" in
the strip, `Cmd+T`, the session context menu ("Open in New Tab") and
Cmd-clicking a session row.

Keyboard: `Cmd+T` new tab, `Cmd+W` close tab (falls through to closing the
window when only the pinned tab is left), `Cmd+1…9` jump to a tab,
`Ctrl+Tab` / `Ctrl+Shift+Tab` cycle. Screen shortcuts that used to be
`Cmd+1…6` moved to `Cmd+Alt+1…6`.

## Back / forward

**Back / forward is per tab.** React Router's history is global and would
interleave two machines' screens into one stack, so each tab keeps its own
back / forward list in `tabStore` and `goBackInTab()` / `goForwardInTab()`
navigate to the saved path. The router's own history is only ever pushed
forward; nothing calls `navigate(-1)` any more.

Wired in `app/components/layout/NavigationDeepLinkBridge.tsx`:

- `Cmd+[` / `Cmd+]` keyboard shortcuts
- Mouse button 3 / 4 (back / forward)
- `navigation:goto` IPC events from the main process (deep links)

Title-bar buttons read `useCanGoBack()` / `useCanGoForward()` from `tabStore`.
The `router:historychange` event dispatched from `useRegisterNavigator` is now
only a "the route changed" ping (the prewarm service listens to it).

## Deep links

The main process can dispatch a navigation by sending a
`navigation:goto` IPC event with `{ path: "/sessions/abc" }`. The bridge
forwards it to `navigate(path)`.

## Invariants

1. **Every screen change pushes exactly one history entry.** If you find
   yourself calling two navigation helpers back-to-back, collapse them into
   one `appNavigate` — the back button's usefulness depends on this.
2. **No Zustand state mirrors the URL.** If a component needs to know which
   session / view is active, it reads it from the URL.
3. **State that is not in the URL is not routable.** If a "screen" is worth a
   back-button entry, add it to the URL inventory above.
4. **Tab identity is store state; which screen is showing is not.** The tab
   list, its order and the active tab live in `tabStore`. What that tab is
   _showing_ is the URL, as always — never add a `selectedX` slice for a
   screen a route segment can carry.
5. **The focused host is route state; the connections are not.** `?host=`
   says which machine a screen reads from. Which hosts are _attached_ lives in
   `connectionStore` + app settings — they keep streaming whether or not you
   are looking at them, and a shared link must not try to attach anything.
