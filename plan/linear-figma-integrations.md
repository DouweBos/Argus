# Linear & Figma integrations

## Context

Today Linear and Figma reach Argus only as remote MCP servers that the agents call, signed in through Argus's generic MCP OAuth (`packages/host/src/services/mcp/oauth.ts`). In practice that sign-in breaks often (Figma rejects unknown clients, refresh is unreliable, tokens are keyed to a server URL). And Argus itself knows nothing about issues or designs: you can't start work from an issue, see a frame next to the simulator, or keep an issue in sync with its session.

Goal: make Linear and Figma **first-class integrations that Argus owns**: its own OAuth app per service, a long-lived token in `secretStorage`, typed API clients in the host, product features built on those clients, and the same capabilities re-exposed to agents through Argus's own MCP server. Agents then never depend on the fragile third-party MCP sign-in.

## The pitch

> **Hand Argus an issue. Get back a PR that matches the design, with proof from the simulator, and Linear already knows about it.**

Linear and Figma are where the work is _described_. Argus is where it gets _done_: parallel agents, real simulators. Today the developer is the copy-paste glue between them: they copy the issue text into a prompt, screenshot the Figma frame, eyeball the simulator against it, then go back to Linear to move the ticket and paste the PR link. The integration removes that glue. **We don't build a Linear board or a Figma viewer.** Every touchpoint sits inside a step the developer already takes in Argus.

### Where it shows up in the developer's day

| Step                          | Today                                                                                             | With the integration                                                                                                                                                                                                                                            | Where in the app                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Pick up**                   | Open Linear, copy the title and description, paste them into the composer, think up a branch name | Type `ENG-123` or paste the link into the composer. The issue's description, comments, attached screenshots and **linked Figma frames** become the agent's context. The branch gets Linear's name and the issue moves to In Progress                            | A chip in `StartComposer`. No new screen     |
| **Fan out**                   | One issue at a time                                                                               | Multi-select issues in the picker to start one agent per issue, in parallel worktrees. That's Argus's core strength applied to the backlog                                                                                                                      | Same picker, with a "Start N agents" button  |
| **Build**                     | The agent guesses the UI from a text description                                                  | The agent gets the frame image + node data (spacing, colors, text) via `figma_get_frame`, and the designer's Figma comments                                                                                                                                     | Invisible: prompt preamble + Argus MCP tools |
| **Verify**                    | Alt-tab between Figma and the simulator                                                           | A **Design** view in the runtime panel puts the frame next to the live simulator at the same device size, with an overlay/opacity slider. The agent self-checks: it screenshots the simulator, compares it with the frame, and iterates before saying it's done | A runtime panel tab beside the simulator     |
| **Review**                    | The reviewer reads the diff and doesn't know what the screen should look like                     | The session's review view shows the issue, the design frame and the agent's final simulator screenshot together with the diff                                                                                                                                   | The session header chip + review panel       |
| **Ship / report**             | Paste the PR link into Linear, take a screenshot for the PM/QA                                    | On PR/merge, Argus comments on the issue with a short summary, the PR link and the **before/after simulator screenshots**. Status follows via Linear's GitHub integration (branch name)                                                                         | Automatic, toggle in Settings                |
| **Found a bug while testing** | Screenshot, open Linear, file it, come back                                                       | "File in Linear" from the simulator toolbar. The screenshot, device/OS and current session are pre-filled, then either file it or **hand it straight to a new agent**                                                                                           | A simulator toolbar button                   |
| **On the go**                 | Nothing                                                                                           | On the phone: your issues, tap to start an agent, get the screenshot report when it's done                                                                                                                                                                      | iOS start sheet + push                       |
| **Autopilot**                 | Nothing                                                                                           | An automation picks up issues with a label (e.g. `argus`), drafts a plan or PR, and lands it in the inbox for approval                                                                                                                                          | Automations, via the native signal source    |

What makes it more than "Linear in another window": the Linear and Figma context goes **into the agent** and the simulator evidence goes **back to Linear**. Only an IDE with agents + simulators can close that loop.

## Architecture

### Integration framework (`packages/host/src/services/integrations/`)

- `types.ts`: `Integration { id: "linear" | "figma", status(), connect(), disconnect() }`, `IntegrationStatus { connected, account?: {name, email, workspace}, error? }`.
- `auth.ts`: a generic OAuth 2 authorization-code + PKCE flow with a loopback callback. Reuse the loopback/PKCE pieces from `mcp/oauth.ts`, but not its dynamic client registration: the clients here are registered apps with fixed client IDs. Tokens are stored via `HostPlatform.secretStorage` (same as `deviceHosts/eas/tokens.ts`). A single `getToken(id)` refreshes ahead of expiry and serializes concurrent refreshes; a failed refresh flips the status to `needs_reauth` and emits a host event instead of failing silently.
- **Personal API key fallback** per service. Linear personal keys don't expire, so they're the most robust option for power users and headless hosts (`pnpm start:host` can't open a browser).
- Commands (`remote-protocol/src/commands/integrations.ts`): `integration_status`, `integration_connect`, `integration_connect_with_key`, `integration_disconnect`; event `integration_status_changed`.

### Linear client (`integrations/linear/`): built on `@linear/sdk`

- `@linear/sdk` (official, MIT, ESM-only like `packages/host`, one dependency, ~3 MB unpacked, still maintained, v99) covers everything we need. I checked the typings and runtime:
  - `new LinearClient({ accessToken })` or `{ apiKey }`, which matches OAuth + key fallback
  - `viewer.assignedIssues`, `searchIssues`, `issue("ENG-123")` with `branchName`, `issueVcsBranchSearch` (branch → issue, which gives us the issue for an existing session's branch), workflow states
  - `updateIssue`, `createComment`, `createAttachment` / `attachmentLinkURL` (link a PR or session to an issue)
  - typed errors, including rate limiting
- What the SDK does not do: OAuth itself (that's still our `auth.ts`), and efficient reads. Its models lazy-load relations, so one fetch per issue's `state`/`team`/`assignee` leads to N+1 requests and rate limits. For list views (issue picker, signal source), use one hand-written GraphQL query through the SDK's underlying GraphQL client, which returns typed results. Use the model API for single-issue reads and mutations.
- Thin facade `linear/client.ts`: `myIssues`, `searchIssues`, `getIssue`, `issueForBranch`, `setState`, `comment`, `linkUrl`. The rest of the host never imports the SDK directly, which keeps it swappable and easy to fake in tests.
- Normalize to the existing `WorkItem` (`signals/types.ts`).

### Figma client (`integrations/figma/`)

- Figma has no official REST client SDK. It publishes only the OpenAPI spec and types (`@figma/rest-api-spec`). Plan: a small `fetch` client typed with those types, against `api.figma.com/v1`.
- Operations: `me`, `parseFigmaUrl(url) → {fileKey, nodeId}`, `getNode(fileKey, nodeId)` (node tree, trimmed), `renderImage(fileKey, nodeId, scale)` (PNG URL, downloaded and cached under the session), `fileMeta`.
- Variables/Dev Resources APIs are plan-gated; treat them as optional.

### Agent access through the Argus MCP server

Agents already get the `argus` MCP server injected (`agentService.ts` → `buildMergedMcpServers`). Add tools there (`services/mcp/integrationTools.ts`, registered in `server.ts`): `linear_get_issue`, `linear_search_issues`, `linear_comment`, `linear_set_state`, `figma_get_frame` (image + trimmed node JSON), `figma_get_node`. They only show up when the integration is connected. One sign-in now covers the UI, automations and agents. The official Figma MCP stays an optional extra for users who want its design-to-code output.

## Features (each milestone delivers part of the pitch on its own)

**M1: Issue → agent (Pick up + Fan out).**

- Settings → a new "Integrations" section: Connect Linear (OAuth, or an API key), the connected account, a reauth banner on `needs_reauth`.
- `StartComposer`:
  - An issue chip: type `ENG-123`, paste a Linear URL, or open the picker (search, multi-select → "Start N agents").
  - Picking an issue builds the context: title, description, comments, and the images the issue embeds (downloaded with the token and passed as image attachments).
  - The branch is Linear's `branchName` instead of `generateBranchAndTitle` (`session/manager.ts:594`), and the issue moves to In Progress (setting, default on).
- `linkedIssue` on the session; a header chip opens the issue. For a session started by hand, `issueVcsBranchSearch` links it by branch name anyway.
- Agent tools on the Argus MCP server (`linear_get_issue`, `linear_comment`, …).
- iOS: the same picker in `StartAgentSheet.swift`.

**M2: Proof back to Linear (Ship / report).**

- When a session opens a PR or merges, comment on the linked issue with a 2–3 line summary, the PR link and before/after simulator screenshots, uploaded via the SDK's `fileUpload` and attached.
- The "before" screenshot is taken at session start if a simulator is running.
- Setting: off / on PR / on merge.

**M3: Design in the loop (Build + Verify + Review).**

- Figma connect. Figma links in the linked issue, or pasted into the composer, become `designRefs[]` with thumbnail chips.
- The agent gets `figma_get_frame` (rendered PNG + trimmed node data + frame comments), plus a preamble telling it to compare a simulator screenshot to the frame and iterate before finishing.
- A **Design** tab in the runtime panel: the frame beside the live simulator at device size, with an overlay/opacity slider. New Peacock component + story.
- The review panel shows frame, final screenshot and diff together.

**M4: Capture & autopilot.**

- A "File in Linear" button in the simulator toolbar, pre-filled with the screenshot, device/OS and session. Choose either "File" or "File & start agent".
- Native Linear signal source (`fetchAssigned` in `signals/sources/linear.ts`), with label-based pickup in automations.

## Deliberately not building

A Linear board, issue list screen, or issue editor; a Figma file browser; two-way status sync code (Linear's GitHub integration does that from the branch name); pushing code to Figma.

## Open decision: OAuth app credentials

Both services need a registered OAuth app. Linear supports PKCE, so a desktop public client works without a secret. Figma's token exchange requires a `client_secret`. Options: ship it in the app, which many desktop tools do but it's extractable, or do the exchange through the Argus account backend if that service can host it. Until that's decided, Figma connects via a personal access token, while Linear gets OAuth + PKCE from day one. Verify the current Linear and Figma OAuth docs (refresh token lifetimes, PKCE support) before building `auth.ts`.

## Critical files

- New: `packages/host/src/services/integrations/{types,auth,registry}.ts`, `integrations/linear/*`, `integrations/figma/*`, `services/mcp/integrationTools.ts`, `remote-protocol/src/commands/integrations.ts` + models, `docs/integrations.md`
- Reuse: loopback/PKCE helpers in `services/mcp/oauth.ts`, `HostPlatform.secretStorage` (`lib/nodeSecretStorage.ts`), `WorkItem` in `signals/types.ts`, `startDraftStore.openStartDraft`, `linkedProjectsPreamble.ts`
- Modify: `services/mcp/server.ts`, `signals/sources/linear.ts`, `session/manager.ts`, `app/components/agent/StartComposer/`, `app/lib/startAgent.ts`, `SettingsDialog/`, runtime panel, `clients/apple/ArgusUI/.../StartAgentSheet.swift` + settings
- Telemetry (`telemetryEvents.ts` + `docs/telemetry-events.md`): `integration_connected { service, method: oauth|key, success }`, `integration_reauth_needed { service }`, `session_started_from_issue { count_bucket, from: picker|id|url }`, `issue_report_posted { trigger: pr|merge, has_screenshots }`, `design_ref_added { from: issue|paste }`, `design_compare_opened`, `issue_filed_from_simulator { started_agent }`. These answer "is the loop used end to end?"

## Verification

- Unit: token refresh (expiry, concurrent refresh, failure → `needs_reauth`), URL parsers, GraphQL/REST response → model mapping with recorded fixtures, MCP tool gating when disconnected.
- Manual on a dev host (`/tmp` ARGUS_HOME):
  - Connect Linear via OAuth and Figma via token, then restart the host and confirm both are still connected.
  - Start from a real issue: check the branch name, the issue state and that Linear links the PR after push.
  - Paste a Figma frame and check the thumbnail and the Design view next to the simulator.
  - An agent calls `linear_get_issue`/`figma_get_frame` with no third-party MCP configured.
- `pnpm lint`, `pnpm gen:protocol --check`, `xcodebuild` for ArgusRemote and ArgusDesktop.

Ship milestone by milestone, one commit per feature. M1 alone is shippable and is the minimum worthwhile slice.
