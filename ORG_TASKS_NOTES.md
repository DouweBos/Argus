# Cross-Repo Org Tasks — implementation notes

## Shipped

- **OrgTask data model & persistence.** New service `electron/services/organizationTask/`
  (`models.ts`, `store.ts` at `~/.argus/organization-tasks.json`, `manager.ts` emitting
  `organization_tasks:changed`). Wired into `AppState.organizationTasks` and
  bootstrapped in `electron/main.ts` via `initOrgTasks`.
- **Orchestrator (`orchestrator.ts`).** `startOrgTask` validates the org + members,
  creates one workspace per member in parallel on branch
  `org-task/<slug>-<shortId>`, spawns a Claude agent in each and delivers the
  shared prompt (+ optional per-member addendum) as the first user message.
  `cancelOrgTask` stops running child agents and marks the task `cancelled`.
- **IPC surface.** `list_org_tasks`, `get_org_task`, `start_org_task`,
  `cancel_org_task`, `delete_org_task`. Frontend wrappers in `app/lib/ipc.ts`
  with matching types in `app/lib/types.ts`.
- **Org context extension.** `buildOrganizationContext` (in
  `electron/services/agent/claude.ts`) now detects when a workspace is part of
  a running OrgTask and appends a "Current Cross-Repo Task" section to the
  system prompt with the task title, shared prompt, and the _absolute worktree
  paths_ of sibling agents so the agent can read sibling files directly or
  coordinate via `spawn_agent` / `wait_for_agent` / `send_agent_message`.
- **Workspace ↔ task linkage.** `Workspace.organization_task_id` added to both
  backend and renderer models, persisted in `WorkspaceMeta`
  (`.argus-workspaces.json`) and reloaded on `listWorkspaces`.
- **Frontend:**
  - `StartTaskDialog` (Peacock `Dialog` + `Input` + `TextArea`) — title/prompt/
    checkbox-per-member with collapsible per-member addendum.
  - Extended `OrganizationsPanel`: each org row now shows a "Start task"
    button, an expandable task list with status chips and per-member mini
    chips, and total/running counts.
  - `OrgTaskScreen` (mounted as a full-cover overlay inside the center panel,
    controlled by `activeOrgTaskStore` on `orgTaskStore`). Shows header, shared
    prompt, per-member cards with "Open workspace" / "Follow-up" buttons, a
    bulk "Send follow-up to all" bar, and a "Cancel task" action.
  - Sidebar `WorkspaceCard` now renders a subtle accent-bordered "task: {title}"
    pill on workspaces that belong to an OrgTask; clicking it opens the
    OrgTaskScreen.
- **Store + sync.** `app/stores/orgTaskStore.ts` with `useOrgTasks`,
  `useActiveOrgTask`, `setActiveOrgTask`, `startOrgTask`, `cancelOrgTask`,
  `deleteOrgTask`, and `useOrgTaskSync` (mounted in `AppShell` so any consumer
  stays fresh across `organization_tasks:changed` events).

## Deferred / cut

- **Sidebar "Organizations" count hint.** The spec suggested morphing a
  sidebar-level Organizations count into a running-tasks badge, but the current
  sidebar has no Organizations nav item (organizations live on the Home
  screen). I did not add a brand-new sidebar entry for this; the running count
  surfaces on the Home `OrganizationsPanel` instead. Adding a dedicated
  sidebar item is a one-line follow-up if desired.
- **Overall task status transitions.** The orchestrator sets `failed` when
  every member fails to spawn, and `cancelled` on explicit cancel, but never
  flips to `completed` automatically — we don't currently have a clean signal
  for "all member agents reached a stable done-state with committed work." The
  per-member status also stays `running` until cancellation. A future pass
  could hook into agent exit / commit events to drive auto-completion.
- **Peacock primitives.** I reused existing Peacock primitives (`Button`,
  `Dialog`, `Input`, `TextArea`, `Icons`). No new icons were needed for this
  pass — if you want a dedicated `OrgTaskIcon`, add it to
  `packages/peacock/src/icons/Icons.tsx`. No inline SVGs were introduced in
  `app/`.
- **Build/lint status.** `tsc --noEmit` passes cleanly for all our code. There
  are 4 **pre-existing** TS errors in test files (`useDiffFiles.test.ts`,
  `useMergeStatus.test.ts`, `ChangesSummary.test.tsx`) caused by a
  `@testing-library/react` version mismatch on this branch — unrelated to this
  change. ESLint fails to start because its `@humanfs/node` dep is missing in
  `node_modules` on this worktree (also unrelated — a `pnpm install` should
  resolve it). Prettier is clean on every file we touched.

## Follow-ups for the user

1. Verify the orchestrator's workspace-creation path in your environment:
   `createWorkspace` is async and kicks off a setup pipeline that completes in
   the background. The agent is spawned immediately after `createWorkspace`
   resolves, so if your setup pipeline blocks on `pnpm install` the agent will
   already be running while deps install. That matches existing Argus
   behavior, but worth sanity-checking on a real org.
2. Decide whether the Home `OrganizationsPanel` is the right host for
   "OrganizationsScreen" going forward, or whether to promote it to its own
   sidebar view. The spec used both names; I extended the existing panel.
3. Consider how delete interacts with running tasks — `delete_org_task` does
   **not** clean up workspaces. That's intentional (the user may want to keep
   the branches) but you may want a "delete task + cleanup" variant.
4. The shared prompt is delivered as the first user message rather than being
   appended to the system prompt; this gives the agent a proper turn and
   mirrors how the UI otherwise starts a session. If you'd rather have it in
   the system prompt itself, swap to the `appendSystemPrompt` param on
   `startAgent` (also plumbed through the org-context injection).
