/**
 * Data types for the Claude Code agent lifecycle.
 */

import type { ControlHandler } from "./controlHandler";
import type { InitializeResponse } from "./protocol";
import type { ChildProcess } from "node:child_process";
import type { Writable } from "node:stream";

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
 * A live session wrapping a `claude --output-format stream-json` subprocess.
 *
 * `stdin` is kept as a plain `Writable` reference. Because Node.js IPC
 * handlers are single-threaded there is no need for a Mutex wrapper.
 */
export interface AgentSession {
  /** Unique identifier for this agent instance. */
  agentId: string;
  /** Session this agent is attached to. */
  sessionId: string;
  /** Write end of the child's stdin pipe. */
  stdin: Writable;
  /** The child process; used for `kill()` on stop. */
  child: ChildProcess;
  /** Current status, updated when the process exits. */
  status: AgentStatusValue;
  /** Handles the control protocol for interactive permission prompts. */
  controlHandler: ControlHandler | null;
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
   * When true, suppresses `agent:status` emissions to the renderer. Used
   * during restore-at-turn: between kill and new-child-ready, we don't want
   * transient idle/stopped signals to flicker the UI's activity indicator.
   * Cleared once the respawn is complete and pending work is queued.
   */
  suppressStatus?: boolean;
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
}
