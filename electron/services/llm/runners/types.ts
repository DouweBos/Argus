/**
 * Runner-agnostic LLM types.
 *
 * The {@link LlmRunner} interface lets the agent service treat any LLM
 * subprocess (Claude Code, Codex, Gemini, ...) opaquely. Each runner owns its
 * own subprocess, wire protocol, transcript format, and capability set; the
 * agent service only sees the normalized handle.
 *
 * Today only the Claude Code runner is registered; this file's shapes are
 * the seam against which future runners will be implemented.
 */

import type { InitializeResponse } from "./claudeCode/protocol";
import type { McpServers } from "../../mcp/userConfig";

// ---------------------------------------------------------------------------
// Permission modes
// ---------------------------------------------------------------------------

/**
 * Argus-canonical permission mode names. Each runner ships a translation
 * table to its native vocabulary; the Claude Code runner maps:
 *
 * - `auto` → `auto` (smart classifier)
 * - `ask` → `default`
 * - `review` → `acceptEdits`
 * - `plan` → `plan`
 * - `trusted` → `bypassPermissions`
 */
export type CanonicalPermissionMode =
  | "ask"
  | "auto"
  | "plan"
  | "review"
  | "trusted";

// ---------------------------------------------------------------------------
// Spawn args
// ---------------------------------------------------------------------------

/**
 * Image attachment to include in a user message. Mirrors the wire-format
 * used by Claude Code today; future runners may need to translate.
 */
export interface ImageAttachment {
  /** Base64-encoded image data (no data-URL prefix). */
  data: string;
  /** MIME type, e.g. `image/png`, `image/jpeg`. */
  media_type: string;
}

/**
 * Pre-decision hook invoked when the runner receives a tool-use permission
 * request. The agent service uses this to inject device-acquisition logic
 * into Bash invocations (e.g. `conductor` with no `--device`).
 *
 * Returning a plain `null` value tells the runner to continue with the
 * normal auto-approval / forward-to-renderer flow. Returning an object
 * means the agent service has *already* handled the request — the runner
 * must not auto-approve or forward it. The agent service is responsible
 * for eventually writing the response back via `respondToPermission` (or
 * a similar mechanism).
 *
 * Returning `{ rewriteInput }` tells the runner to mutate the request's
 * `input` payload (e.g. splice `--device <UDID>` into the Bash command)
 * and then continue the normal auto-approval / forward flow.
 */
export type PermissionPreHook = (req: {
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
  rawRequest: unknown;
  /** Send the auto-approval JSON to the runner's stdin. */
  approveRaw: (jsonLine: string) => void;
}) =>
  | { kind: "handled" }
  | { kind: "rewrite-input"; input: Record<string, unknown> }
  | null;

export interface LlmRunnerSpawnArgs {
  agentId: string;
  sessionId: string;
  cwd: string;
  /** Resolved model id (runner-specific). `null` = let runner pick. */
  model: string | null;
  /**
   * Permission mode. For Phase 1 we accept either canonical names or
   * runner-native names — the Claude runner translates canonical and passes
   * native through as-is. Callers above the runner should migrate to
   * canonical over time.
   */
  permissionMode: CanonicalPermissionMode | string | null;
  /** Runner-defined resume token (Claude Code: a session UUID). */
  resumeRef: string | null;
  /** Combined system prompt (runner-agnostic; renderer-side instructions). */
  systemPrompt: string;
  /** MCP server map. Runner ignores when capabilities.supportsMcp is false. */
  mcpServers: McpServers;
  /** Path to the per-agent debug log file the runner should write to. */
  debugLogPath: string;
  /** Environment variables to pass to the child. */
  env: NodeJS.ProcessEnv;
  /**
   * Optional pre-decision hook for tool-use permission requests. See the
   * {@link PermissionPreHook} doc.
   */
  permissionPreHook?: PermissionPreHook;
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export interface RunnerCapabilities {
  /** Whether the runner accepts an `--mcp-config` style server map. */
  supportsMcp: boolean;
  /** Whether the runner supports forking a transcript at a turn (resume). */
  supportsTranscriptFork: boolean;
  /** Whether the runner supports mid-session model switching. */
  supportsSetModel: boolean;
  /** Whether the runner supports mid-session permission-mode switching. */
  supportsSetPermissionMode: boolean;
  /** Whether the runner supports a graceful interrupt without killing. */
  supportsInterrupt: boolean;
}

// ---------------------------------------------------------------------------
// Runner handle (one per spawned agent)
// ---------------------------------------------------------------------------

/**
 * Permission decision passed from the agent service back to the runner.
 */
export interface PermissionDecisionInput {
  toolUseId: string;
  decision: "allow" | "deny";
  allowRule?: string;
  allowAll?: boolean;
  denyMessage?: string;
}

/**
 * Events emitted by a runner handle. Phase 1 keeps the underlying readline
 * loop's "raw JSON line forwarded to renderer" behavior — `stream-event`
 * fires once per non-control line as a string.
 */
export interface LlmRunnerHandleEvents {
  /** Raw JSON line emitted by the underlying CLI (one per stream-json event). */
  "stream-event": [line: string];
  /** Process stderr line. */
  stderr: [line: string];
  /** Process exited; payload is the exit code (0 on clean exit). */
  exit: [code: number];
}

export interface LlmRunnerHandle {
  readonly runnerId: string;
  /** Listen for runner events. */
  on: ((event: "capabilities", cb: (payload: unknown) => void) => void) &
    ((event: "exit", cb: (code: number) => void) => void) &
    ((event: "permission-cancel", cb: (payload: unknown) => void) => void) &
    ((event: "permission-request", cb: (payload: unknown) => void) => void) &
    ((event: "stderr", cb: (line: string) => void) => void) &
    ((event: "stream-event", cb: (line: string) => void) => void);
  /** Send a user prompt + optional image attachments. */
  send: (message: string, images?: ImageAttachment[]) => void;
  /** Gracefully interrupt the in-flight turn (process stays alive). */
  interrupt: () => Promise<void>;
  /** Switch the active model mid-session. */
  setModel: (model: string) => Promise<void>;
  /** Switch the permission mode mid-session. */
  setPermissionMode: (mode: CanonicalPermissionMode | string) => Promise<void>;
  /** Respond to a previously-emitted permission request. */
  respondToPermission: (decision: PermissionDecisionInput) => void;
  /** Kill the underlying child process; resolves once it exits. */
  kill: () => Promise<void>;
  /** Capabilities snapshot (post-initialize, may be null until handshake). */
  initializeResponse: () => InitializeResponse | null;
  /** Wait for the runner's initialize handshake to complete. */
  waitForInit: () => Promise<void>;
  /** Dispose any handler-side state (does not kill the child). */
  cleanup: () => void;
}

// ---------------------------------------------------------------------------
// Runner (singleton, one per registered LLM CLI)
// ---------------------------------------------------------------------------

export interface PreflightOk {
  ok: true;
  binPath: string;
}
export interface PreflightFail {
  ok: false;
  reason: string;
}
export type PreflightResult = PreflightFail | PreflightOk;

export interface OneShotArgs {
  prompt: string;
  timeoutMs?: number;
  cwd?: string;
  source: string;
}

/**
 * Onboarding step contributed by a runner.
 *
 * Runners declare any first-run UI they need (auth, install, key entry, ...) as
 * a list of these steps. The electron side only knows the metadata; the
 * renderer maps {@link kind} to a concrete React component via a small
 * registry. Adding a new runner with its own auth step is therefore purely
 * additive: the runner ships the step metadata, the renderer ships the
 * component, and the onboarding flow stitches them together by `kind`.
 */
export interface RunnerOnboardingStep {
  /** Stable id, also used as the onboarding "skip" key. e.g. `"claude_auth"`. */
  id: string;
  /** Owning runner id, e.g. `"claude-code"`. */
  runnerId: string;
  /** Human-readable title shown in the stepper / layout header. */
  title: string;
  /**
   * Discriminator the renderer maps to a component. Must match a key in the
   * renderer-side runner-onboarding registry.
   */
  kind: string;
}

export interface ForkTranscriptArgs {
  /** Source agent's resume ref (e.g. Claude Code session UUID). */
  sourceRef: string;
  /** Source cwd that owns the transcript on disk. */
  sourceCwd: string;
  /** Destination cwd (often same as source for in-place fork). */
  destCwd: string;
  /** Branch label propagated into the new transcript. */
  destBranch: string;
  /** Cutoff timestamp (ms since epoch) within the transcript. */
  cutoffTimestampMs: number;
  /** Real user-turn index to keep through (inclusive). */
  keepTurnNumber: number;
}

export interface LlmRunner {
  readonly id: string;
  readonly displayName: string;
  capabilities: () => RunnerCapabilities;
  preflight: () => Promise<PreflightResult>;
  spawn: (args: LlmRunnerSpawnArgs) => Promise<LlmRunnerHandle>;
  /** One-shot title/slug invocation (replaces direct claudePrint). */
  oneShot: (args: OneShotArgs) => Promise<string | null>;
  /** Optional: fork transcript at turn boundary. */
  forkTranscript?: (
    args: ForkTranscriptArgs,
  ) => Promise<{ resumeRef: string | null }>;
  /**
   * Optional: onboarding steps the runner contributes to the first-run flow.
   * Returning an empty array (or omitting the method) means the runner needs
   * no first-run UI of its own.
   */
  getOnboardingSteps?: () => RunnerOnboardingStep[];
}
