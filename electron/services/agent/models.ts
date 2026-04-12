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
}
