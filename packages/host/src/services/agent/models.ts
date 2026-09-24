/**
 * Data types for the LLM agent lifecycle.
 */

import type { InitializeResponse } from "../llm/runners/claudeCode/protocol";
import type { LlmRunner, LlmRunnerHandle } from "../llm/runners/types";

// ---------------------------------------------------------------------------
// AgentStatus
// ---------------------------------------------------------------------------

/** Lifecycle state of a Claude Code agent process. */
export type AgentStatusValue =
  | "error"
  | "idle"
  | "requires_action"
  | "running"
  | "stopped";

// ---------------------------------------------------------------------------
// AgentSession
// ---------------------------------------------------------------------------

/** Captured result from the final `type: "result"` stream-json event. */
export interface AgentResult {
  subtype: "error" | "success";
  result?: string;
  total_cost_usd: number;
  duration_ms: number;
}

/**
 * A live session wrapping an LLM runner subprocess (Claude Code today).
 *
 * The runner-specific child process, stdin pipe, and control protocol live
 * behind {@link LlmRunnerHandle}. Because Node.js IPC handlers are
 * single-threaded there is no need for a Mutex wrapper around the handle.
 */
export interface AgentSession {
  /** Unique identifier for this agent instance. */
  agentId: string;
  /** Session this agent is attached to. */
  sessionId: string;
  /** The runner that spawned this agent. */
  runner: LlmRunner;
  /** Runtime handle owning the subprocess + wire protocol. */
  handle: LlmRunnerHandle;
  /** Current status, updated when the process exits. */
  status: AgentStatusValue;
  /** Agent that spawned this one via MCP `spawn_agent` (null for user-initiated). */
  parentAgentId: string | null;
  /**
   * Unix ms timestamp captured when this agent session was first created.
   * Preserved across restore-at-turn respawns so the agent's creation time
   * is stable through the agent's lifetime.
   */
  createdAt: number;
  /**
   * Unix ms timestamp of the most recent stdout line received from the CLI
   * subprocess. Bumped on every event regardless of type (assistant message,
   * tool use, tool result, system event, etc.). Used by `agent_vitals` to
   * surface "time since last activity" so an orchestrator can spot a stuck
   * child without scanning its transcript.
   */
  lastEventAt: number;
  /**
   * Total number of tool-use blocks observed in assistant stream events for
   * this agent's lifetime. Independent of `turnsCompleted` — a single turn
   * can fan out into many tool calls. Lets `agent_vitals` distinguish a
   * model that's actively iterating (idle status, but tool count climbing
   * across calls) from one that has truly parked.
   */
  toolUsesTotal: number;
  /**
   * Cumulative USD spend across this agent's turns. `AgentResult` carries one
   * turn; this is what an automation's cost ceiling is measured against.
   */
  costUsd: number;
  /**
   * Unix ms timestamp of the most recent observed tool-use block, or null if
   * the agent has not made any tool calls yet. Reads better than
   * `lastEventAt` for "is this child making forward progress" because it
   * filters out chatty system/control events that don't represent work.
   */
  lastToolUseAt: number | null;
  /**
   * Name of the most recently observed tool (e.g. `Edit`, `Bash`, `Read`)
   * or null if no tool has been used yet. Captured opportunistically from
   * the assistant stream — not authoritative beyond the most recent event.
   */
  lastToolName: string | null;
  /** Captured when the agent emits its final `type: "result"` event. */
  resultSummary: AgentResult | null;
  /**
   * Resolvers for callers waiting on this agent to exit (e.g. `wait_for_agent`).
   * Each entry is called with the exit code when the process closes.
   */
  exitWaiters: ((exitCode: number) => void)[];
  /**
   * Resolvers for callers waiting on the current turn to finish (status
   * transitioning to `idle`). Fired when the CLI emits a
   * `session_state_changed` event with `state: "idle"`.
   */
  turnWaiters: ((status: AgentStatusValue) => void)[];
  /**
   * Number of turns that have transitioned running → idle. Used by
   * `wait_for_agent` to distinguish a freshly spawned agent (idle but
   * never ran) from one that has finished a turn.
   */
  turnsCompleted: number;
  /**
   * Number of prompts sent to the CLI that have not yet emitted a final
   * `result` event. The CLI can briefly flip `session_state_changed` to
   * `idle` between tool calls within a single turn, so process status alone
   * understates "is this agent currently doing work". Anything that observes
   * activity from outside the renderer (tray, vitals) should treat
   * `inflightPrompts > 0` as live work in addition to `running` /
   * `requires_action` statuses.
   */
  inflightPrompts: number;
  /**
   * When true, suppresses `agent:status` emissions to the renderer. Used
   * during restore-at-turn: between kill and new-child-ready, we don't want
   * transient idle/stopped signals to flicker the UI's activity indicator.
   * Cleared once the respawn is complete and pending work is queued.
   */
  suppressStatus?: boolean;
  /**
   * Model id that this agent was spawned with (e.g. `claude-opus-4-7` or
   * `claude-opus-4-7[1m]`), or null if the CLI default was used. Persisted
   * across `restoreAgentAtTurn` respawns and updated by `setAgentModel` so
   * any restart re-passes `--model` and we don't accidentally drop variant
   * suffixes (notably `[1m]`) that aren't preserved in the JSONL transcript.
   */
  model: string | null;
  /**
   * When true, this agent was eagerly spawned by the renderer to warm up
   * the CLI subprocess + initialize handshake before the user actually
   * needs it. Prewarmed agents are hidden from `listAgents` (so MCP tools
   * and child-counters don't see them) and stay invisible to the UI until
   * the renderer "claims" them by calling `claim_prewarm_agent`. On claim
   * the flag flips to false and the slot becomes a normal agent.
   */
  prewarmed?: boolean;
  /**
   * Permission mode the agent was last spawned with (canonical name, e.g.
   * `auto` / `ask` / `plan` / `review` / `trusted`). Recorded so the prewarm
   * claim path can skip a redundant runtime `set_permission_mode` when the
   * claimed mode matches the spawn-time mode. Most modes (including `auto`)
   * can be switched at runtime via the control protocol; `trusted`
   * (`bypassPermissions`) is still spawn-only.
   */
  permissionMode?: string | null;
  /**
   * Mode the agent was in immediately before transitioning into `plan` —
   * stashed so that approving `ExitPlanMode` can restore the pre-plan mode
   * (e.g. `auto`) instead of leaving the agent stuck in the CLI's post-plan
   * default ("ask"). Cleared when the agent leaves plan mode by any path.
   * Null when the agent was spawned directly in `plan`, in which case
   * exit-plan-restore falls back to the system default.
   */
  prePlanPermissionMode?: string | null;
}

// ---------------------------------------------------------------------------
// AgentInfo
// ---------------------------------------------------------------------------

/**
 * Serialisable agent info returned to the frontend via IPC.
 *
 * Uses snake_case field names to match the frontend types.
 */
export interface AgentInfo {
  agent_id: string;
  session_id: string;
  status: AgentStatusValue;
  parent_agent_id: string | null;
  /** Unix ms timestamp when the agent session was created. */
  created_at: number;
  /**
   * Initialize-response capabilities (commands, models, agents) captured during
   * the CLI handshake. Returned inline so the renderer has them immediately
   * on `start_agent` resolution — the async `agent:capabilities` event fires
   * before renderer listeners are wired up and would otherwise be missed.
   */
  capabilities?: InitializeResponse | null;
  /**
   * Model id the agent is running with (variant suffixes like `[1m]` preserved),
   * or null if the CLI default was used.
   */
  model: string | null;
  /**
   * Runner this agent is bound to. Inherited from the session at spawn, then
   * switchable per agent until its first prompt.
   */
  runner_id: string;
}
