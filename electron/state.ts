/**
 * Global application state — singleton Maps.
 *
 * Node.js is single-threaded for IPC handlers, so no Mutex is needed.
 */

import type { Workspace } from "./services/workspace/models";
import type { AgentSession } from "./services/agent/models";
import type { TerminalSession } from "./services/terminal/multiplexer";
import type { WatcherHandle } from "./services/workspace/watcher";

export interface SimulatorSession {
  udid: string;
  deviceName: string;
  captureActive: boolean;
  mjpegPort: number | null;
}

export interface AndroidDeviceSession {
  serial: string;
  deviceName: string;
  type: "emulator" | "physical";
  captureActive: boolean;
}

/** A simulator reserved for exclusive use by a single agent. */
export interface SimulatorReservation {
  agentId: string;
  udid: string;
  deviceName: string; // e.g. "MyApp-1"
  repoRoot: string;
}

class AppState {
  /** Set of absolute paths to all open repository roots. */
  repoRoots = new Set<string>();

  /** All managed workspaces, keyed by their UUID. */
  workspaces = new Map<string, Workspace>();

  /** Active PTY sessions, keyed by session ID. */
  terminals = new Map<string, TerminalSession>();

  /** Live Claude Code agent sessions, keyed by agent UUID. */
  agents = new Map<string, AgentSession>();

  /** Active iOS simulator capture session, if any. */
  simulator: SimulatorSession | null = null;

  /** Active Android device capture session, if any. */
  androidDevice: AndroidDeviceSession | null = null;

  /** Active file system watchers, keyed by workspace UUID. */
  watchers = new Map<string, WatcherHandle>();

  /** Simulator reservations for agents, keyed by agent UUID. */
  simulatorReservations = new Map<string, SimulatorReservation>();
}

/** Singleton instance. */
export const appState = new AppState();
