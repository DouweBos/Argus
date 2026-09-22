/**
 * Capabilities and the method → capability map — the single source of truth
 * for what a paired remote device is allowed to do.
 *
 * v1 grants only "monitor". The desktop gateway builds its dispatch allowlist
 * from `REMOTE_METHODS`, so adding a method here (and a handler there) is the
 * only way to widen the remote surface for monitor/control — there is no
 * implicit escalation. The "admin" tier is the one exception: it dispatches raw
 * IPC command names, bounded by the tier its command registry declares —
 * mirrored here as `HOST_ONLY_COMMANDS` for the renderer.
 */

/**
 * Capability grants stored per paired device.
 * - "monitor": read-only state (the v1 default). Cannot mutate anything —
 *   crucially, cannot approve tool-use prompts, which is a code-execution act.
 * - "control": drive agents like the desktop — send/interrupt, switch
 *   model/mode/effort, spawn agents, create sessions, and approve prompts.
 *   Opt-in per device. Deliberately never grants project creation — that
 *   stays host-only.
 * - "admin": another Argus desktop driving this host as if sitting at its
 *   keyboard. Inverts the model — any raw IPC command except
 *   {@link HOST_ONLY_COMMANDS}. Only ever grant it to a paired Mac you own,
 *   never to a browser.
 */
export const CAPABILITIES = ["monitor", "control", "admin"] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * Commands that never cross the wire, at any tier. They act on the machine the
 * *window* is on, or mutate the trust store that authorises the wire itself.
 *
 * The host registers these at the "host" tier in its command registry, which is
 * what actually bars them; this set is the renderer-visible mirror (the
 * registry lives in the main process) and is asserted equal to it by test.
 *
 * `updater_get_state` is deliberately absent: reading the host's update status
 * is useful, restarting it under other clients is not.
 */
export const HOST_ONLY_COMMANDS = new Set([
  // window/dialog surface — meaningless on a headless host
  "show_open_dialog",
  "show_image_context_menu",
  "open_agent_popout",
  "close_agent_popout",
  "close_window",
  // act on the client's machine, not the host's
  "open_external_url",
  "open_path",
  "reveal_in_finder",
  "open_in_editor",
  "open_in_custom_editor",
  // the host updates itself; a client must not restart it under other clients
  "updater_check",
  "updater_download",
  "updater_quit_and_install",
  // pairing/revocation is the root of trust — console-only, never remote
  "remote_start_pairing",
  "remote_confirm_pairing",
  "remote_cancel_pairing",
  "remote_revoke_device",
  "remote_set_device_control",
  "remote_set_config",
  // Reconfiguring how the host is reachable is console-only, like pairing.
  "remote_tailscale_diagnose",
  "remote_tailscale_fix",
  // Sharing an agent, letting a guest in, and ending a share are trust
  // decisions — same root as pairing, and `huddle_list` hands back room tokens.
  "huddle_start",
  "huddle_share_readiness",
  "huddle_stop",
  "huddle_set_device",
  "huddle_list",
  "huddle_approve_guest",
  "huddle_deny_guest",
  "huddle_remove_guest",
]);

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
  /** Recently stopped agents, read back from the project's saved chat history. */
  "agents.stopped": "monitor",
  /** Read a stopped agent's saved transcript. */
  "agents.stopped_transcript": "monitor",
  /** Resolve an image inside a stopped agent's saved transcript. */
  "agents.stopped_image": "monitor",
  /** Approve/deny a permission prompt the gateway forwarded — approving a
   * tool call runs code on the host, so this needs control, not monitor. */
  "permission.respond": "control",
  /** Set this device's own display label (shown in the desktop's paired list). */
  "device.rename": "monitor",
  /** Read this device's own current capability grants (to reflect live toggles). */
  "device.capabilities": "monitor",
  /** What the desktop can push with — including the VAPID key a browser needs
   * before it can create a Web Push subscription. */
  "device.push_info": "monitor",
  /** Register this device's APNs/FCM token or Web Push subscription so the
   * desktop can reach it while the app is backgrounded or closed. */
  "device.register_push": "monitor",
  /** Forget this device's push token (user turned notifications off). */
  "device.unregister_push": "monitor",
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
  /** Messages waiting for a busy agent. The queue is the desktop's, shared by
   *  every client, so reading it is monitor and changing it is control. */
  "agents.queue_list": "monitor",
  "agents.queue_add": "control",
  "agents.queue_remove": "control",
  "agents.queue_update": "control",
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
  /** List the branches of a session's repo (local, plus remote-only ones). */
  "sessions.branches": "monitor",
  /** Switch the checked-out branch. Host-side these branch ops only work on a
   *  project root — session worktrees are pinned to their own branch. */
  "sessions.checkout": "control",
  "sessions.create_branch": "control",
  "sessions.delete_branch": "control",
  /** Read a session's diff (what the agent changed) as unified-diff text. */
  "sessions.diff": "monitor",
  /** List connected simulators/emulators. */
  "devices.list": "monitor",
  /** Begin/stop streaming a device's screen (frames ride the binary channel). */
  "devices.watch": "monitor",
  "devices.unwatch": "monitor",
  /** How the device is being held. The client has to know to present the
   *  stream upright, so it is readable by anyone who may watch it. */
  "devices.state": "monitor",
  /** Rotating or folding changes what the device shows, so it is control —
   *  same bar as a tap, and it is arbitrated by the same claim. */
  "devices.set_orientation": "control",
  "devices.set_fold": "control",
  /** Claim interaction on a device. Two clients may watch one screen, but both
   *  injecting HID events into it is nonsense, so it is arbitrated. */
  "devices.claim": "control",
  "devices.release": "control",
  "devices.claim_status": "control",
  /** Begin/stop streaming an embedded browser's screen. Frames ride the same
   *  binary channel as device video; watching is read-only, so monitor. */
  "browser.watch": "monitor",
  "browser.unwatch": "monitor",
  /** Drive a device — taps mutate it, so control-gated like agents.send. */
  "devices.touch": "control",
  "devices.button": "control",
  "devices.keyboard": "control",
  /** Automations and their runs. The clock belongs to the host, so a phone
   *  reads the host's automations; firing one starts an agent, hence control. */
  "automations.list": "monitor",
  "automations.runs": "monitor",
  /** One run with its report — the list omits it because reports are large. */
  "automations.run": "monitor",
  "automations.run_now": "control",
  "automations.cancel_run": "control",
  /** Reading a report on the phone is reading it — it clears nowhere else.
   *  Monitor, not control: it records that you looked, and can do nothing else. */
  "automations.mark_run_read": "monitor",
  /** The inbox. Reading it is monitor; deciding is not — accepting one spins
   *  up a worktree and starts an agent, which is code execution, and
   *  dismissing writes the signal that calibrates the automation. */
  "proposals.list": "monitor",
  "proposals.accept": "control",
  "proposals.dismiss": "control",
  "proposals.perform_cleanup": "control",
  /** Every address this desktop is reachable on, so a client can pick one. */
  "host.endpoints": "monitor",
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
  /** The agent's queued messages changed (from any client). */
  "agent.queue",
  /** Models/commands/subagents became available (post-CLI-handshake). */
  "agent.capabilities",
  "permission.request",
  "permission.cancel",
  /** Device interaction claim changed (taken, released or stolen). */
  "device.claim",
  /** A watched device's hinge or orientation moved. */
  "device.state",
  "sessions.changed",
  "projects.changed",
  /** A user-facing notification (agent finished, needs approval, MCP push). */
  "notification",
  /** The desktop's reachable addresses changed (a tunnel came up or died). */
  "host.endpoints",
  /** A huddle guest's standing changed — approved, denied, or the room ended. */
  "huddle.state",
  /** Raw renderer broadcast, forwarded verbatim to "admin" devices only —
   * another desktop wants the host's own IPC channels, not the typed mirrors. */
  "ipc",
] as const;
export type RemoteEventType = (typeof REMOTE_EVENTS)[number];
