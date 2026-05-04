# LLM routing abstraction

## Goal

Stop calling the `claude` CLI directly throughout Argus. Replace every direct
coupling with a thin **LLM router** layer that picks a runner (currently only
"Claude Code", later e.g. Codex CLI, Gemini CLI, OpenAI-compatible bridge,
remote API runners). Two cascades:

- **Runner** — bound at session creation, immutable for the session's
  lifetime. Resolved from project (`.argus.json`) → app default.
- **Model** — re-resolved at every agent spawn within the session.
  Resolved from agent override → session → project → app default.

The shipped behavior must remain bit-for-bit equivalent to today: Claude is
the only registered runner, and the resolver always picks it.

## Non-goals (this branch)

- Adding a second runner. The point is to remove direct coupling, not to ship
  multi-runner support.
- Changing the on-disk JSONL transcript format, the conversation event shape
  (`ClaudeStreamEvent`), or the `.argus.json` schema in incompatible ways.
- Reworking the control protocol, permission UX, MCP wiring, or simulator
  device injection. Those become _runner concerns_ but their behavior is
  unchanged for the Claude runner.
- Touching Claude Code-specific features like `--resume` JSONL forking or
  `restoreAgentAtTurn`. Those stay inside the Claude runner.

## Where Claude is currently coupled

Direct subprocess + protocol coupling (must be hidden behind the abstraction):

- `electron/services/agent/claude.ts` (2044 lines) — `startAgent`,
  `restoreAgentAtTurn`, `stopAgent`, `interruptAgent`, `waitForAgent`,
  `sendAgentMessage`, plus `CLAUDE_BIN`, args, env, JSONL parsing, control
  protocol fast-path.
- `electron/services/agent/controlHandler.ts` + `protocol.ts` — Claude's
  bidirectional control protocol (`can_use_tool`, `initialize`,
  `set_model`, `set_permission_mode`, `interrupt`, `mcp_status`,
  `elicitation`, `hook_callback`).
- `electron/services/agent/models.ts` — `AgentSession` carries
  `controlHandler` and assumes a single child process with a `Writable`
  stdin and stream-json output.
- `electron/services/llm/claudePrint.ts` — one-shot `claude -p` invocations
  for titles/slugs (used by `titleGenerator.ts`).
- `electron/services/session/manager.ts` — `forkClaudeSessionFile` reads
  `~/.claude/projects/<path>/<id>.jsonl` to truncate transcripts.
- `electron/services/session/setup.ts` — `loadArgusConfig`.
- MCP wiring in `electron/services/mcp/` — emits Claude-shaped
  `--mcp-config` JSON.

Type/UI coupling (rename + funnel through the abstraction, but shapes stay):

- `app/lib/types.ts:502` `ClaudeStreamEvent`, `ClaudeContentBlock`,
  `ClaudeToolResult`, `TokenUsage`, `AgentCapabilities`.
- `app/stores/conversationStore.ts` — stores raw `ClaudeStreamEvent`s.
- `app/stores/agentStore.ts` — `claudeSessionId` field.
- `app/components/agent/ModelPicker/ModelPicker.tsx` — model list driven by
  initialize response.
- `app/components/onboarding/ClaudeAuthStep.tsx` — auth onboarding screen.

There is **no app-level default model** in `settingsStore.ts` today, and
`ArgusConfig` has no model field. We are adding both.

## The abstraction

### Runner interface

A new package-internal module `electron/services/llm/runners/`. The runner
**owns the subprocess and the wire protocol**; the agent service treats it
opaquely.

```ts
// electron/services/llm/runners/types.ts
export interface LlmRunnerSpawnArgs {
  agentId: string;
  sessionId: string;
  cwd: string;
  model: string | null; // resolved model id (runner-specific)
  permissionMode: string | null; // resolver translates to runner-native
  resumeRef: string | null; // runner-defined resume token
  systemPrompt: string;
  appendSystemPrompt: string | null;
  mcpServers: Record<string, McpServerConfig>;
  env: NodeJS.ProcessEnv;
}

export interface LlmRunnerHandle {
  readonly runnerId: string; // "claude-code", later "codex", ...
  send(message: UserMessage): void; // user prompt, attachments, etc.
  interrupt(): Promise<void>;
  setModel(model: string): Promise<void>;
  setPermissionMode(mode: string): Promise<void>;
  respondToPermission(req: PermissionDecision): void;
  kill(): Promise<void>;
  capabilities(): RunnerCapabilities | null;

  on(event: "stream-event", cb: (e: NormalizedStreamEvent) => void): void;
  on(event: "permission-request", cb: (r: PermissionRequest) => void): void;
  on(event: "exit", cb: (code: number) => void): void;
  on(event: "stderr", cb: (line: string) => void): void;
}

export interface LlmRunner {
  readonly id: string;
  readonly displayName: string;
  preflight(): Promise<
    { ok: true; binPath: string } | { ok: false; reason: string }
  >;
  spawn(args: LlmRunnerSpawnArgs): Promise<LlmRunnerHandle>;

  // One-shot (replaces claudePrint.ts)
  oneShot(args: OneShotArgs): Promise<string | null>;

  // Resume support (Claude truncates JSONL; others may differ)
  forkTranscript?(args: ForkArgs): Promise<{ resumeRef: string | null }>;
}
```

### Normalized stream-event shape

`ClaudeStreamEvent` is already close to what we want — it's mostly
runner-agnostic except for `subtype: "session_state_changed"` and the JSONL
field names. We promote it to `NormalizedStreamEvent` (rename, keep shape),
and each runner adapts its native wire format to it. The Claude runner's
adapter is a near-identity passthrough; future runners do real translation.

Rename map (mechanical):

- `ClaudeStreamEvent` → `LlmStreamEvent`
- `ClaudeContentBlock` → `LlmContentBlock`
- `ClaudeToolResult` → `LlmToolResult`
- `claudeSessionId` → `runnerSessionId` (with a getter for back-compat in
  persisted state)

The persisted conversation files keep the existing field names; the rename
is at the type level only.

### Registry + resolver

```ts
// electron/services/llm/registry.ts
registerRunner(new ClaudeCodeRunner());

// electron/services/llm/resolve.ts
export function resolveRunnerForSession(repoRoot: string): {
  runner: LlmRunner;
  defaultModel: string | null;
};

export function resolveModelForAgent(args: {
  sessionId: string;
  agentOverride?: { model?: string; permissionMode?: CanonicalPermissionMode };
}): { model: string | null; permissionMode: CanonicalPermissionMode };
```

**Runner is bound at session creation; model can vary per agent.** When
`create_session` runs, the resolver walks project → app default and stamps
`runner_id` onto the new `Session` record. The session's `runner_id` is
immutable for its lifetime — every agent spawned in it inherits exactly
that runner. Subsequent agent spawns may still override the _model_ (and
the permission mode) within what the runner supports, but never the
runner itself.

Cascade for runner selection (at session creation):

1. **Project default** — new `.argus.json` block:
   ```jsonc
   {
     "llm": {
       "runner": "claude-code",
       "model": "claude-opus-4-7",
     },
   }
   ```
2. **App default** — new entry in `settingsStore.ts`:
   `defaultLlm: { runner: "claude-code", model: null }`. Surfaced in the
   Settings dialog under a new "LLM" section.

Cascade for model selection (at agent spawn):

1. **Agent override** — passed to `start_agent` / `spawn_agent` IPC.
2. **Session model** — stored on the `Session`, defaulted from project/app
   at create time but editable later via the Runner+Model picker (model
   field only; runner field is read-only on existing sessions).
3. **Runner default** — whatever model the runner picks if none is
   specified.

If no level specifies a runner at session-create time, fall back to the
single registered runner. If multiple are registered and none chosen,
error with a clear message rather than guessing.

## Phased implementation

The phases below are split so prep work runs in parallel worktrees. Within
each phase, **lettered tasks (A, B, …) are independent and can be spawned
as concurrent worktree agents**. Numbered phases are strictly sequential —
phase N+1 assumes phase N has merged.

### Phase 0 — pre-extraction prep (4 parallel tracks)

Goal: shrink the phase 1 diff by relocating self-contained pieces and
renaming Claude-specific types up front. Every track is behavior-neutral
and lands as its own PR. Conflicts between tracks are import-path-only and
caught immediately by `pnpm lint`.

**Track 0A — type rename.** Find-and-replace across `app/lib/types.ts`,
`app/stores/conversationStore.ts`, `app/stores/agentStore.ts`,
`app/lib/agentEventService.ts`, and any other `app/` consumers:

- `ClaudeStreamEvent` → `LlmStreamEvent`
- `ClaudeContentBlock` → `LlmContentBlock`
- `ClaudeToolResult` → `LlmToolResult`
- `claudeSessionId` (field on agentStore) → `runnerSessionId`

Persisted JSONL field names stay as-is — the rename is type-level only.
This track must NOT touch `electron/services/agent/` so it doesn't collide
with track 0D.

**Track 0B — relocate transcript fork.** Move `forkClaudeSessionFile`
from `electron/services/session/manager.ts` into
`electron/services/llm/runners/claudeCode/transcriptFork.ts`. Update the
single import in `claude.ts` (`restoreAgentAtTurn` does the dynamic
import). Self-contained, no signature changes.

**Track 0C — runner-agnostic one-shot facade.** Move
`electron/services/llm/claudePrint.ts` into
`electron/services/llm/runners/claudeCode/oneShot.ts`. Add a
`electron/services/llm/oneShot.ts` facade that today just delegates to the
Claude runner's one-shot. Update `titleGenerator.ts` and any other callers
to import the facade, not the Claude path.

**Track 0D — relocate control protocol.** Move
`electron/services/agent/controlHandler.ts` and
`electron/services/agent/protocol.ts` into
`electron/services/llm/runners/claudeCode/`. Update the import in
`claude.ts` and in `agent/models.ts` (which references `ControlHandler`
on `AgentSession`). Code unchanged; just relocated.

**Merge order:** any order. After all four merge, `claude.ts` is smaller,
the type surface is runner-neutral, and the Claude-specific pieces live
under `runners/claudeCode/` ready to be wrapped by an `LlmRunner`.

### Phase 1 — extract Claude into a runner, behavior-preserving (sequential)

Goal: zero behavior change. One agent, because every step touches
overlapping symbols in the same files.

1. Create `electron/services/llm/runners/types.ts` with `LlmRunner`,
   `LlmRunnerHandle`, `LlmRunnerSpawnArgs`, `RunnerCapabilities`,
   `CanonicalPermissionMode`.
2. Wrap the relocated pieces from phase 0 into `ClaudeCodeRunner` at
   `electron/services/llm/runners/claudeCode/runner.ts` and a
   `ClaudeCodeHandle` at `handle.ts`. The handle owns the `spawn`,
   readline loop, stderr, exit, and the existing control-handler instance.
3. Create `electron/services/llm/registry.ts` and register
   `ClaudeCodeRunner`.
4. Split `electron/services/agent/claude.ts` into a runner-agnostic
   `electron/services/agent/agentService.ts`. `startAgent` resolves a
   runner via the registry, calls `runner.spawn(...)`, and stores the
   returned handle on `AgentSession`.
5. Replace `AgentSession.controlHandler` / `child` / `stdin` with
   `AgentSession.handle: LlmRunnerHandle`. Re-route `stopAgent`,
   `interruptAgent`, `setAgentModel`, `respondToPermission`,
   `restoreAgentAtTurn`, `sendAgentMessage` through `handle.*`.
6. `restoreAgentAtTurn` becomes runner-conditional:
   `runner.forkTranscript ? do-restore : throw "not supported"`.
   Simulator/browser bookkeeping stays in the agent service.
7. Move the `agent_vitals` tool-use counter logic out of the Claude
   readline loop and into the agent service, listening on
   `handle.on("stream-event", …)`.

Test gate: full app boot, spawn an agent, run a prompt, accept a
permission, stop the agent, restore-at-turn, generate a session title,
prewarm. Behaviorally identical to `main`.

### Phase 2 — configuration cascade (3 parallel tracks + 1 sequential merge)

**Track 2A — app-level default.** Add `defaultLlm: { runner, model }` to
`app/stores/settingsStore.ts`, surface in
`app/components/shared/SettingsDialog/` under a new "LLM" section, document
in `docs/app-settings.md`. Touches only app/settings files.

**Track 2B — project-level default.** Add `llm: { runner, model }` block
to `ArgusConfig` in `electron/services/session/models.ts`, parse in
`electron/services/session/setup.ts`, surface in
`app/components/sidebar/SetupConfigDialog/`, extend onboarding inference in
`electron/services/onboarding/argusJson.ts`, document in
`docs/project-settings.md`. Touches only project-config files.

**Track 2C — session/agent plumbing + resolver.** Add `runner_id`
(immutable post-create) and `model` (editable) to `Session`. Implement
`resolveRunnerForSession` and `resolveModelForAgent` in
`electron/services/llm/resolve.ts`. Wire `create_session` to call the
session resolver and stamp `runner_id`. Add `{ model? }` arg to
`start_agent` / `spawn_agent` IPC and the Argus MCP `spawn_agent` tool;
runner is always the session's `runner_id`. Touches only
session/agent/ipc files.

Tracks 2A and 2B can land before 2C; 2C reads their settings via existing
store/config getters. If 2A/2B haven't merged yet, 2C's resolver falls
back to "single registered runner" — same behavior as today.

### Phase 3 — UI (2 parallel tracks)

**Track 3A — Runner+Model picker.** Rework
`app/components/agent/ModelPicker/ModelPicker.tsx` so the top-level shows
the session's runner (read-only on existing sessions) and the second list
shows that runner's `capabilities().models`. New sessions show a runner
selector wired through `resolveRunnerForSession`. Settings dialog's LLM
section (already added in 2A) lists registered runners.

**Track 3B — Runner-contributed onboarding.** Extract a
`RunnerOnboardingStep` interface; port `app/components/onboarding/ClaudeAuthStep.tsx`
to register itself via the Claude runner. The onboarding flow renders
whichever steps the registered runners contribute. Today the rendered
output is identical to current.

Both tracks ship even with one runner — they're the user-visible contract
for phase 4. Disjoint component trees, no merge conflicts.

### Phase 4 — second runner (out of scope for this branch)

Adding a runner is now purely additive:
`registerRunner(new SomeOtherRunner())` plus its native protocol adapter.
Capabilities (resume, set-model mid-turn, MCP, permission modes) are
expressed on `RunnerCapabilities` so the UI can hide unsupported actions.

## Resolved decisions

1. **Permission modes — canonical enum + per-runner mapping.** Argus defines
   a small canonical vocabulary at the resolver boundary
   (`auto | review | plan | trusted`). Each runner ships a translation table
   to its native names; the Claude runner maps:
   - `auto` → `default`
   - `review` → `acceptEdits`
   - `plan` → `plan`
   - `trusted` → `bypassPermissions`

   Runners that don't support a given canonical mode reject the spawn with a
   clear error. The UI only ever shows canonical names.

2. **MCP — capability flag, gate per-spawn injection.** Add
   `RunnerCapabilities.supportsMcp: boolean`. The agent service skips
   per-spawn MCP wiring (today's `--mcp-config` JSON, plus the
   `ARGUS_RESOLVER_URL` / `ARGUS_RESOLVER_TOKEN` env vars) when the resolved
   runner reports `false`. Argus's own MCP server keeps running; only the
   client-side injection is conditional. Non-MCP runners therefore lose
   `spawn_agent` / `trigger_run` / `wait_for_agent` and the Conductor
   device-resolver path — surface that limitation in the runner's
   `displayName` tooltip in the Runner+Model picker.

3. **Prewarm — runner-aware, discard on mismatch.** `prewarmStore`
   tracks the warmed handle's `runner_id`. Because runner is fixed per
   session (decision 4), in-session mismatches can't happen — but the
   prewarm pool is keyed across sessions and the app-default runner can
   change while a warm handle exists. On any mismatch between the
   warmed handle's runner and what the resolver picks for the next
   spawn, kill the warm handle and spawn fresh. Opportunistic — never
   wrong, occasionally cold.

4. **Runner is fixed at session creation.** A session created with the
   Claude runner stays on the Claude runner for its entire lifetime. The
   resolver therefore reads from session → project → app default at
   `create_session` time and stamps `runner_id` onto the `Session`
   record; subsequent agent spawns within that session inherit it and
   cannot override the runner (model overrides are still allowed if the
   runner supports multiple models). The Runner+Model picker on existing
   sessions only changes the model; the runner field is read-only.
   `restoreAgentAtTurn`, prewarm, and resume all assume the session's
   runner_id is stable.

5. **`agent_vitals` tool-use counters move to the agent service.** The
   runner's normalized `stream-event` emitter is the boundary. The agent
   service subscribes once per spawned handle and bumps
   `toolUsesTotal` / `lastToolUseAt` / `lastToolName` on `AgentSession`
   when it sees a `tool_use` content block in an assistant event. The
   runner stops doing line sniffing for vitals; counter logic lives in
   one place and works for every runner that emits correctly-shaped
   events.

## Risks

- `claude.ts` is 2044 lines and densely intertwined with simulator and
  browser device acquisition. Phase 1 must split runner concerns from
  device concerns cleanly or the diff becomes impossible to review.
- Renaming `ClaudeStreamEvent` touches a lot of files; do it as its own
  commit before the structural changes so review is mechanical.
- `restoreAgentAtTurn` reaches into Claude's on-disk JSONL by absolute
  path. That logic must move into the Claude runner unchanged — no
  attempt to generalize it in this branch.

## Acceptance

- Full grep for `"claude"` in `electron/services/` (excluding
  `runners/claudeCode/`) returns only display-string and onboarding
  references.
- `pnpm lint` and `pnpm build` pass.
- Manual: spawn agent, send message, approve permission, switch model,
  interrupt, restore-at-turn, stop, prewarm — all behave identically to
  `main`.
- Settings dialog shows the new LLM section; `.argus.json` accepts the
  new `llm` block; spawning with an explicit runner+model override flows
  through the resolver.
