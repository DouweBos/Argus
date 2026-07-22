/**
 * Capabilities and the method → capability map — the single source of truth
 * for what a paired remote device is allowed to do.
 *
 * v1 grants only "monitor". The desktop gateway builds its dispatch allowlist
 * from `REMOTE_METHODS`, so adding a method here (and a handler there) is the
 * only way to widen the remote surface — there is no implicit escalation.
 */

/**
 * Capability grants stored per paired device.
 * - "monitor": read-only state (the v1 default). Cannot mutate anything —
 *   crucially, cannot approve tool-use prompts, which is a code-execution act.
 * - "control": drive agents like the desktop — send/interrupt, switch
 *   model/mode/effort, spawn agents, create sessions, and approve prompts.
 *   Opt-in per device. Deliberately never grants project creation — that
 *   stays host-only.
 */
export const CAPABILITIES = ["monitor", "control"] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Every request method the remote client may send, and the grant it needs. */
export const REMOTE_METHODS = {
  "projects.list": "monitor",
  "sessions.list": "monitor",
  "agents.list": "monitor",
  "agents.status": "monitor",
  "agents.vitals": "monitor",
  "agents.transcript": "monitor",
  /** Resolve a transcript image reference to its bytes. */
  "agents.image": "monitor",
  "orgs.list": "monitor",
  /** Approve/deny a permission prompt the gateway forwarded — approving a
   * tool call runs code on the host, so this needs control, not monitor. */
  "permission.respond": "control",
  /** Set this device's own display label (shown in the desktop's paired list). */
  "device.rename": "monitor",
  /** Read this device's own current capability grants (to reflect live toggles). */
  "device.capabilities": "monitor",
  /** Models, slash commands, and subagent types for an agent's input pickers. */
  "agents.capabilities": "control",
  /** Send a chat message (optionally with image attachments) to an agent. */
  "agents.send": "control",
  /** Interrupt a running agent. */
  "agents.interrupt": "control",
  /** Stop (kill) an agent entirely — not just the current turn. */
  "agents.stop": "control",
  "agents.set_model": "control",
  "agents.set_permission_mode": "control",
  "agents.set_effort": "control",
  /** Spawn a new agent inside an existing session. */
  "agents.spawn": "control",
  /** Create a new session inside an existing project (never a new project). */
  "sessions.create": "control",
  /** Delete a session (optionally its branch). */
  "sessions.delete": "control",
  /** Rename a session's display name. */
  "sessions.rename": "control",
  /** Rename the git branch backing a session. */
  "sessions.rename_branch": "control",
  /** List a session's files for the @-mention picker. */
  "sessions.files": "control",
  /** Resolve a directory path for the @-mention browse mode. */
  "sessions.resolve_mention_path": "control",
  /** Read a session's git status (ahead/behind/dirty/conflicts). */
  "sessions.git_status": "monitor",
  /** Read a session's diff (what the agent changed) as unified-diff text. */
  "sessions.diff": "monitor",
  /** List connected simulators/emulators. */
  "devices.list": "monitor",
  /** Begin/stop streaming a device's screen (frames ride the binary channel). */
  "devices.watch": "monitor",
  "devices.unwatch": "monitor",
  /** Drive a device — taps mutate it, so control-gated like agents.send. */
  "devices.touch": "control",
  "devices.button": "control",
  "devices.keyboard": "control",
} as const satisfies Record<string, Capability>;

export type RemoteMethod = keyof typeof REMOTE_METHODS;

export const ALL_REMOTE_METHODS = Object.keys(REMOTE_METHODS) as RemoteMethod[];

export function isRemoteMethod(value: string): value is RemoteMethod {
  return value in REMOTE_METHODS;
}

/** Events the gateway may push to a device (subscription-filtered downstream). */
export const REMOTE_EVENTS = [
  "agent.event",
  "agent.status",
  /** Models/commands/subagents became available (post-CLI-handshake). */
  "agent.capabilities",
  "permission.request",
  "permission.cancel",
  "sessions.changed",
  "projects.changed",
  /** A user-facing notification (agent finished, needs approval, MCP push). */
  "notification",
] as const;
export type RemoteEventType = (typeof REMOTE_EVENTS)[number];
