# Routing

Argus uses **react-router-dom**'s `MemoryRouter` with the URL as the single
source of truth for "which screen am I on". Every screen has a URL. Back /
forward (via `Cmd+[` / `Cmd+]`, the mouse back/forward buttons, or the title
bar navigation buttons) always returns to the previous URL.

No Zustand store mirrors the route. Reads go through URL-derived hooks
(`useCurrentRoute` and friends); writes go through `appNavigate(route)`.

## URL inventory

| URL                                   | Screen                       | Notes                                                 |
| ------------------------------------- | ---------------------------- | ----------------------------------------------------- |
| `/`                                   | Home / project picker        | Default route on launch.                              |
| `/activity`                           | Activity                     | Cross-session activity feed.                          |
| `/agents`                             | Agents overview              | All agents across all sessions.                       |
| `/devices`                            | Devices                      | iOS simulators + Android emulators.                   |
| `/notifications`                      | Notifications                | Warnings & errors.                                    |
| `/organizations`                      | Organizations list           | All organizations.                                    |
| `/organizations/:organizationId`      | Single organization          | Org detail + tasks.                                   |
| `/pull-requests`                      | Pull requests                | GitHub PRs of interest across open projects.          |
| `/pull-requests/:owner/:repo/:number` | Pull request detail          | Single PR view: description, checks, files, comments. |
| `/review-queue`                       | Review queue                 | Sessions ready to merge.                              |
| `/runtimes`                           | Runtimes overview            | All running dev servers / terminals.                  |
| `/sessions/:sessionId`                | Session (defaults to agents) | Equivalent to `/sessions/:sessionId/agents`.          |
| `/sessions/:sessionId/agents`         | Session → Agents panel       | Claude Code agents for this session.                  |
| `/sessions/:sessionId/editor`         | Session → Editor panel       | Monaco / VS Code editor.                              |
| `/sessions/:sessionId/git`            | Session → Git panel          | Commit log, stashes, diffs.                           |
| `/sessions/:sessionId/home`           | Session → Home panel         | Per-session overview.                                 |

`/settings` is not a route — the settings dialog is overlaid on top of the
current URL.

## Parsed-route descriptor

Every URL parses into a `ParsedRoute`:

```ts
interface ParsedRoute {
  view:
    | "activity"
    | "agents"
    | "devices"
    | "home"
    | "notifications"
    | "organizations"
    | "pull-request-detail"
    | "pull-requests"
    | "review-queue"
    | "runtimes"
    | "session";
  sessionId: string | null; // set when view === "session"
  organizationId: string | null; // set on /organizations/:organizationId
  panel: "agents" | "editor" | "git" | "home"; // only meaningful when view === "session"
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
  useRouteOrganizationId,
  useRouteSessionPanel,
} from "app/lib/routeHooks";
```

Or the semantic aliases exposed by the stores — they read the URL under the
hood:

- `useSelectedSessionId()` (in `sessionStore`)
- `useCenterView()` / `useSelectedOrganizationId()` (in `centerViewStore`)
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

appNavigate({ view: "session", sessionId: "abc", panel: "editor" });
appNavigate({ view: "notifications" });
appNavigate({ view: "organizations", organizationId: "org-1" });
appNavigate({ view: "home" }, { replace: true });
```

The following store helpers are thin wrappers around `appNavigate` — use
whichever reads best:

| Helper                       | Effect                                                   |
| ---------------------------- | -------------------------------------------------------- |
| `selectSession(id)`          | `/sessions/{id}/{currentPanel}`                          |
| `selectSession(null)`        | `/`                                                      |
| `setCenterView(view)`        | `/{view}`                                                |
| `openOrganization(id)`       | `/organizations/{id}`                                    |
| `setActiveCenterView(panel)` | `/sessions/{currentSessionId}/{panel}` (no-op off-route) |
| `navigateToPath(path)`       | Raw path (used by deep-link IPC handler)                 |

## Building paths

`routeToPath(route)` converts a `Partial<ParsedRoute>` into a pathname.
Prefer `appNavigate(route)` in callers; use `routeToPath` only when you need
the raw string (e.g. for an `<a href>` or to compare to another path).

## Back / forward

Wired in `app/components/layout/NavigationDeepLinkBridge.tsx`:

- `Cmd+[` / `Cmd+]` keyboard shortcuts
- Mouse button 3 / 4 (back / forward)
- `navigation:goto` IPC events from the main process (deep links)

Title-bar buttons listen to the `router:historychange` event dispatched from
`useRegisterNavigator` to know when they should enable / disable.

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
