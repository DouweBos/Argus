/**
 * Capabilities and the method → capability map — the single source of truth
 * for what a paired remote device is allowed to do.
 *
 * v1 grants only "monitor". The desktop gateway builds its dispatch allowlist
 * from `REMOTE_METHODS`, so adding a method here (and a handler there) is the
 * only way to widen the remote surface for monitor/control — there is no
 * implicit escalation. The "admin" tier is the one exception: it dispatches raw
 * IPC command names, bounded by the tier its command registry declares —
 * mirrored here as `HOST_ONLY_COMMANDS`.
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
 * what actually bars them; this set is the client-visible mirror, asserted
 * equal to it by test.
 */
export const HOST_ONLY_COMMANDS = new Set([
  // act on the client's machine, not the host's
  "open_external_url",
  "open_path",
  "reveal_in_finder",
  "open_in_editor",
  "open_in_custom_editor",
  // pairing/revocation is the root of trust — console-only, never remote
  "remote_start_pairing",
  "remote_confirm_pairing",
  "remote_cancel_pairing",
  "remote_revoke_device",
  "remote_set_device_control",
  "remote_set_config",
  "remote_mcp_decide",
  "remote_mcp_revoke",
  "remote_mcp_set_access",
  // Reconfiguring how the host is reachable is console-only, like pairing.
  // Sharing an agent, letting a guest in, and ending a share are trust
  // decisions — same root as pairing, and `huddle_list` hands back room tokens.
  "huddle_start",
  "huddle_share_readiness",
  "huddle_stop",
  "huddle_set_device",
  "huddle_say",
  "huddle_set_typing",
  "huddle_list",
  "huddle_approve_guest",
  "huddle_deny_guest",
  "huddle_remove_guest",
  // Linking this computer to an account, approving another one and unlinking
  // are trust decisions with the same root as pairing.
  "account_device_key",
  "account_login_start",
  "account_login_confirm",
  "account_login_cancel",
  "account_logout",
  "account_link_local_begin",
  "account_link_local_finish",
  "account_list_requests",
  "account_approve_join",
  "account_confirm_join",
  "account_deny_join",
  "account_revoke_member",
  "account_rename_member",
  "account_set_config",
  "account_dismiss_reset",
  "account_set_name",
  // Loopback DevTools endpoints: unreachable off this machine, and a debugger
  // into the session's browser besides.
  "browser_devtools",
]);

/** Every request method the remote client may send, and the grant it needs. */
export const REMOTE_METHODS = {
  "projects.list": "monitor",
  "sessions.list": "monitor",
  "sessions.viewing": "monitor",
  "sessions.start_options": "control",
  /** Sessions that belong to no project — delete/rename go through `sessions.*`. */
  "scratch_pads.list": "monitor",
  "agents.list": "monitor",
  "agents.status": "monitor",
  "agents.vitals": "monitor",
  "agents.mcp_status": "monitor",
  "agents.transcript": "monitor",
  /** Resolve a transcript image reference to its bytes. */
  "agents.image": "monitor",
  /** Recently stopped agents, read back from the project's saved chat history. */
  "agents.stopped": "monitor",
  /** Read a stopped agent's saved transcript. */
  "agents.stopped_transcript": "monitor",
  /** Resolve an image inside a stopped agent's saved transcript. */
  "agents.stopped_image": "monitor",
  /** Search the saved chats' titles and message text. */
  "agents.history_search": "monitor",
  /** Delete a saved chat from the project's history. */
  "agents.history_delete": "control",
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
  /** The agents a Live Activity shows, for its first frame. */
  "live_activity.snapshot": "monitor",
  /** Have this host push agent progress to the phone's Live Activity. */
  "live_activity.register": "monitor",
  /** Stop pushing to it (the user switched Live Activities off). */
  "live_activity.unregister": "monitor",
  /** Models, slash commands, and subagent types for an agent's input pickers. */
  "agents.capabilities": "control",
  /** Send a chat message (optionally with image attachments) to an agent. */
  "agents.send": "control",
  /** Interrupt a running agent. */
  "agents.interrupt": "control",
  /** Cancel the automatic continue scheduled after a usage limit. */
  "agents.dismiss_limit_resume": "control",
  /** Other Claude accounts a limit-stalled agent could be handed to. */
  "agents.limit_handoff": "monitor",
  /** Move a limit-stalled agent onto another Claude account and continue. */
  "agents.handoff_to_account": "control",
  /** Stop (kill) an agent entirely — not just the current turn. */
  "agents.stop": "control",
  "agents.set_model": "control",
  /** Pin an agent's session to a Claude account; restarts a fresh agent on it. */
  "agents.set_claude_account": "control",
  "agents.set_permission_mode": "control",
  "agents.set_effort": "control",
  /** Pin a chat so the host resumes it on restart: it spawns, so control. */
  "agents.set_pinned": "control",
  /** Spawn a new agent inside an existing session. */
  "agents.spawn": "control",
  /** Continue a chat in a new agent on another runner: it spawns, so control. */
  "agents.continue_on_runner": "control",
  /** Messages waiting for a busy agent. The queue is the desktop's, shared by
   *  every client, so reading it is monitor and changing it is control. */
  "agents.queue_list": "monitor",
  "agents.queue_add": "control",
  "agents.queue_remove": "control",
  "agents.queue_update": "control",
  /** Delivers a queued message first, into a busy agent's running turn. */
  "agents.queue_send_now": "control",
  /** Edit a sent message: the conversation rewinds to it and resends. */
  "agents.rewind": "control",
  /** Fork the chat at a message into a new agent, here or in a new session. */
  "agents.fork": "control",
  /** A side question spends tokens on a fork of the agent's context. */
  "agents.ask_side": "control",
  /** Create a new session inside an existing project (never a new project). */
  "sessions.create": "control",
  "sessions.create_compare": "control",
  "sessions.compare": "monitor",
  "sessions.compare_screenshot": "monitor",
  "sessions.keep_compare": "control",
  /** Create a scratch pad: a session in its own directory, outside any project. */
  "scratch_pads.create": "control",
  /** Triage starts an agent, which spends. */
  "triage.start": "control",
  /** Delete a session (optionally its branch). */
  "sessions.delete": "control",
  /** Rename a session's display name. */
  "sessions.rename": "control",
  /** Rename the git branch backing a session. */
  "sessions.rename_branch": "control",
  "sessions.set_base_branch": "control",
  /** Re-run or clear a failed setup. */
  "sessions.retry_setup": "control",
  "sessions.mark_ready": "control",
  "sessions.watch_pull_request": "control",
  "sessions.settle": "control",
  "sessions.snooze": "control",
  /** List a session's files for the @-mention picker. */
  "sessions.files": "control",
  /** Read a session file and search its worktree, for the read-only viewer.
   *  File contents are more sensitive than the transcript, so control — the
   *  same tier as listing them. */
  "files.read": "control",
  "files.search": "control",
  "files.search_cancel": "control",
  /** Resolve a directory path for the @-mention browse mode. */
  "sessions.resolve_mention_path": "control",
  /** Read a session's git status (ahead/behind/dirty/conflicts). */
  "sessions.git_status": "monitor",
  /**
   * A session's terminals and their output, read-only: a phone watches a dev
   * server; typing into a shell stays with the desktop (`terminal_write` is
   * admin-tier).
   */
  "terminals.list": "monitor",
  "terminals.read": "monitor",
  /** Replay for a streaming reader: subscribe to `terminal:<id>` first, then
   *  stitch `terminal.data` events onto this by sequence. */
  "terminals.scrollback": "monitor",
  /** List the branches of a session's repo (local, plus remote-only ones). */
  "sessions.branches": "monitor",
  /** A project's branches and `.argus.json` base preference, to preselect a new worktree's base. */
  "projects.base_branches": "monitor",
  /** Switch the checked-out branch. Host-side these branch ops only work on a
   *  project root — session worktrees are pinned to their own branch. */
  "sessions.checkout": "control",
  "sessions.create_branch": "control",
  "sessions.delete_branch": "control",
  /** A branch's history and a commit's diff are reads, like the diff above. */
  "sessions.branch_log": "monitor",
  "sessions.commit_diff": "monitor",
  "sessions.compare_branches": "monitor",
  "sessions.branch_pr_url": "monitor",
  /** Everything that moves a ref, touches the tree or talks to the remote. */
  "sessions.merge_branch": "control",
  "sessions.rebase_current": "control",
  "sessions.push_branch": "control",
  "sessions.pull": "control",
  "sessions.rename_local_branch": "control",
  "sessions.pin_branch": "control",
  /** Read a session's diff (what the agent changed) as unified-diff text. */
  "sessions.diff": "monitor",
  "sessions.viewed_files": "monitor",
  /** Review bookkeeping on the computer, so a watcher doesn't change it. */
  "sessions.set_file_viewed": "control",
  "sessions.turns": "monitor",
  "sessions.diff_range": "monitor",
  "sessions.merge_blockers": "monitor",
  /** Writing history. Committing and pushing are the point of the session;
   *  merging lands it on the base branch, which the host still refuses for a
   *  protected branch or a conflicting tree. */
  "sessions.commit": "control",
  /** Spends a Claude call on the computer's account. */
  "sessions.draft_commit_message": "control",
  "sessions.commit_identity": "monitor",
  "sessions.push": "control",
  "sessions.merge_base": "control",
  "sessions.restack": "control",
  "sessions.land_stack": "control",
  /** Stashes and tags are reads; applying or dropping a stash rewrites the
   *  tree or throws work away, like a checkout or a delete. */
  "sessions.stashes": "monitor",
  "sessions.stash_apply": "control",
  "sessions.stash_drop": "control",
  "sessions.tags": "monitor",
  /** List connected simulators/emulators. */
  "devices.list": "monitor",
  /** Read-only: adding or testing one makes the host open SSH with its own
   *  keys, which no paired client gets to trigger. */
  "device_hosts.list": "monitor",
  /** An EAS session bills the host owner's Expo account until it stops. */
  "device_hosts.start_eas_session": "control",
  "device_hosts.stop_eas_session": "control",
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
  /** Ad-hoc runs only — the Quick Run screen's history. */
  "automations.scratch_runs": "monitor",
  /** The editor's reads. Writing one is control: a playbook is code. */
  "automations.get": "monitor",
  "automations.sources": "monitor",
  "automations.runners": "monitor",
  "automations.create": "control",
  "automations.update": "control",
  /** No playbook is written by this — it hands text back for the editor — but
   *  it spends the host's LLM, so it sits with the writes rather than the reads. */
  "automations.revise_playbook": "control",
  "automations.delete": "control",
  /** What runs carry forward. Editing one steers every future run, like a playbook. */
  "automations.memories": "monitor",
  "automations.save_memory": "control",
  "automations.delete_memory": "control",
  "automations.set_enabled": "control",
  "automations.run_now": "control",
  /** An ad-hoc run is an agent on the host, same as any other run. */
  "automations.run_scratch": "control",
  "automations.save_scratch_run": "control",
  "automations.cancel_run": "control",
  /** Throwing a run's record away is not undoable, so it sits with the writes. */
  "automations.delete_run": "control",
  /** How often its proposals were kept versus dismissed. */
  "automations.calibration": "monitor",
  /** Spends the host's LLM, like `revise_playbook`; saves nothing. */
  "automations.draft": "control",
  /** The app-wide autonomy cap. Raising it lets every automation go further
   *  unattended, the same bar as editing one automation's autonomy. */
  "automations.default_autonomy": "monitor",
  "automations.set_default_autonomy": "control",
  "worktrees.cleanup_preview": "monitor",
  /** Deletes worktrees, guarded like the scheduled sweep. */
  "worktrees.cleanup_run": "control",
  "worktrees.set_cleanup_policy": "control",
  /** Reading a report on the phone is reading it — it clears nowhere else.
   *  Monitor, not control: it records that you looked, and can do nothing else. */
  "automations.mark_run_read": "monitor",
  "automations.run_feedback": "control",
  /** Which integrations the computer has connected, and as whom. Connecting
   *  one takes a secret, which stays on the computer: no method sets it. */
  "integrations.list": "monitor",
  /** Reads Linear as the computer's connected user. */
  "linear.issues": "monitor",
  "linear.issue": "monitor",
  /** Moving an issue or commenting speaks for you in Linear. */
  "linear.update_issue": "control",
  "linear.comment": "control",
  /** Reads Figma as the computer's connected user. Comparing screenshots a
   *  device and renders the frame; it changes nothing on either. */
  "figma.frame_details": "monitor",
  "design.compare": "monitor",
  /** Pull requests, through the `gh` CLI on the computer. Reading is monitor;
   *  opening, merging or commenting speaks for you on GitHub, so it is not. */
  "github.pull_requests": "monitor",
  "github.pull_request": "monitor",
  "github.create_pull_request": "control",
  "github.pull_request_template": "monitor",
  /** Runs Claude on the computer's account. */
  "github.fill_pull_request": "control",
  "github.merge_pull_request": "control",
  "github.comment_pull_request": "control",
  "github.pull_request_diff": "monitor",
  "github.pull_request_viewed_files": "monitor",
  /** Ticks GitHub's Viewed box as you. */
  "github.set_pull_request_file_viewed": "control",
  "github.review_pull_request": "control",
  /** Review guides. Reading one is monitor; writing one or asking about a
   *  stop runs Claude on the computer's account. */
  "review_guides.get": "monitor",
  "review_guides.generate": "control",
  "review_guides.ask": "control",
  /** The inbox. Reading it is monitor; deciding is not — accepting one spins
   *  up a worktree and starts an agent, which is code execution, and
   *  dismissing writes the signal that calibrates the automation. */
  "proposals.list": "monitor",
  "proposals.accept": "control",
  "proposals.dismiss": "control",
  "proposals.resolve": "control",
  "proposals.perform_cleanup": "control",
  /** One proposal's full record, for its own screen. */
  "proposals.get": "monitor",
  /** Starts a run of the automation with the note, so control. */
  "proposals.request_revision": "control",
  /** Every address this desktop is reachable on, so a client can pick one. */
  "host.endpoints": "monitor",
  /** An app-level ping: browsers can't send WebSocket ping frames, so a web
   *  client proves the channel alive with a request any host answers. */
  "host.ping": "monitor",
  /** Whether this computer is on an account (hashed id only), so a paired
   *  phone can offer "Add to your account". */
  "account.status": "monitor",
  /** Start this computer's code link so a QR-paired phone can approve it. It
   *  only raises a console prompt — the host's own confirm is still required. */
  "account.request_link": "monitor",
  /** Hand the host signed log entries it may not have seen yet. Monitor, so a
   *  monitor-only phone's removals still reach every host it can reach; the
   *  host verifies each entry against its own pinned log before applying it. */
  "account.sync": "monitor",
  /** Claude accounts. Reading which plans the host owner signed into is
   *  monitor; anything that switches, adds or forgets one changes what every
   *  new agent authenticates as and spends that account's quota, so control. */
  "claude_accounts.list": "monitor",
  /** Which other runners are installed and signed in; signing in stays on the computer. */
  "runners.accounts": "monitor",
  "claude_accounts.set_active": "control",
  "claude_accounts.add": "control",
  "claude_accounts.remove": "control",
  "claude_accounts.rename": "control",
  /** Plan limits per account: how much quota is left, read-only. */
  "usage.limits": "monitor",
  /** Tokens and estimated cost on this machine, per runner. */
  "usage.summary": "monitor",
  "usage.prices": "monitor",
  /** Changes how every cost on the host is estimated. */
  "usage.set_prices": "control",
  /** Which models Usage counts, the phone's copy of the Mac's Settings list. */
  "usage.model_filter": "monitor",
  "usage.set_model_filter": "control",
  /** Sign an existing account back in. The browser opens on the host and the
   *  login completes there; the client just drives it and reads the result. */
  "claude_accounts.login_start": "control",
  "claude_accounts.login_cancel": "control",
  "claude_accounts.login_submit_code": "control",
  /** Whether a sign-in is waiting for a pasted code. The browser callback
   *  lands on the host, so a phone can only finish a login by code — without
   *  this it has no way to know one is wanted. */
  "claude_accounts.login_status": "control",
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
  /** The agent's transcript changed: messages upserted/removed, revisioned. */
  "agent.transcript",
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
  /** The signed-in Claude accounts or the active one changed. */
  "claude_accounts.changed",
  /** An in-flight Claude sign-in needs a pasted code, or has finished. */
  "claude_accounts.login",
  /** A user-facing notification (agent finished, needs approval, MCP push). */
  "notification",
  /** The desktop's reachable addresses changed (a tunnel came up or died). */
  "host.endpoints",
  /** Output of a terminal this device subscribed to as `terminal:<id>`. */
  "terminal.data",
  "terminal.exit",
  /** Matches of a worktree search this device subscribed to as `code-search:<id>`. */
  "files.search",
  /** A huddle guest's standing changed — approved, denied, or the room ended. */
  "huddle.state",
  /** Someone in the huddle said something to the room (not to the agent). */
  "huddle.chat",
  /** Raw renderer broadcast, forwarded verbatim to "admin" devices only —
   * another desktop wants the host's own IPC channels, not the typed mirrors. */
  "ipc",
  /** The host asking the UI on its local socket to do something only a window
   * can (a banner, opening a URL, raising the window). Never sent remotely. */
  "platform.request",
] as const;
export type RemoteEventType = (typeof REMOTE_EVENTS)[number];
