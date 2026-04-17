/**
 * Data types for the Claude Code agent lifecycle.
 */

import type { ControlHandler } from "./controlHandler";
import type { ChildProcess } from "node:child_process";
import type { Writable } from "node:stream";

// ---------------------------------------------------------------------------
// AgentStatus
// ---------------------------------------------------------------------------

/** Lifecycle state of a Claude Code agent process. */
export type AgentStatusValue = "error" | "idle" | "running" | "stopped";

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
  /** Workspace this agent is attached to. */
  workspaceId: string;
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
  /** Captured when the agent emits its final `type: "result"` event. */
  resultSummary: AgentResult | null;
  /**
   * Resolvers for callers waiting on this agent to exit (e.g. `wait_for_agent`).
   * Each entry is called with the exit code when the process closes.
   */
  exitWaiters: ((exitCode: number) => void)[];
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
  workspace_id: string;
  status: AgentStatusValue;
  parent_agent_id: string | null;
}
