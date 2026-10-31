/**
 * Scoped grants: narrowing a capability grant to specific agents and devices.
 *
 * A normal paired device has no scope and reaches everything its capability
 * tier allows. A huddle guest carries a {@link GrantScope} and may only address
 * what the scope names — enforced host-side in `dispatch()`, never by the
 * client hiding UI.
 *
 * The table below is the whole surface: `Record<RemoteMethod, …>` means a new
 * method fails to compile until its scope rule is decided, so a method can
 * never slip past the check by being forgotten.
 */

import type { RemoteMethod } from "./capabilities";
import { browserClaimId } from "./models";

/** What a scoped grant may address. Absent scope means "everything". */
export interface GrantScope {
  /** Live agent ids this grant may read and drive. */
  agent_ids: string[];
  /** Claim keys (simulator udid / android serial / `browser:<sessionId>`). */
  device_keys: string[];
}

/**
 * How a method relates to a scope.
 * - `agent` / `device` / `browser` / `session`: the named param must resolve to
 *   something inside the scope, else the call is denied.
 * - `filter`: an enumerating method — it runs and its result is narrowed, so a
 *   guest sees one agent rather than an error.
 * - `open`: addresses nothing scopable (this connection's own device record,
 *   host endpoints).
 * - `denied`: creates or destroys things a guest has no business touching.
 */
export type ScopeRule =
  | { kind: "agent"; param: string }
  | { kind: "browser"; param: string }
  | { kind: "denied" }
  | { kind: "device"; param: string }
  | { kind: "filter" }
  | { kind: "open" }
  | { kind: "session"; param: string };

const agent = (param = "agent_id"): ScopeRule => ({ kind: "agent", param });
const device = (param = "device_id"): ScopeRule => ({ kind: "device", param });
const browser = (param = "session_id"): ScopeRule => ({
  kind: "browser",
  param,
});
const session = (param = "session_id"): ScopeRule => ({
  kind: "session",
  param,
});
const FILTER: ScopeRule = { kind: "filter" };
const OPEN: ScopeRule = { kind: "open" };
const DENIED: ScopeRule = { kind: "denied" };

/**
 * Every remote method and the subject a scope check resolves it against.
 * Session-addressed methods resolve through the scoped agents' sessions: a
 * guest can read the diff of the work its agent is doing, and nothing else.
 */
export const METHOD_SCOPE: Record<RemoteMethod, ScopeRule> = {
  "host.endpoints": OPEN,
  "account.status": OPEN,
  "account.request_link": OPEN,
  // A huddle guest isn't on the account; nothing it could hand over applies.
  "account.sync": DENIED,

  // The host owner's Claude sign-ins: the list names their email and org, and
  // switching one silently changes what every new agent spends. Nothing a
  // huddle guest has a claim on.
  "claude_accounts.list": DENIED,
  "claude_accounts.set_active": DENIED,
  "claude_accounts.add": DENIED,
  "claude_accounts.remove": DENIED,
  "claude_accounts.rename": DENIED,
  // The host owner's plan usage, per account.
  "usage.limits": DENIED,
  "usage.summary": DENIED,
  "claude_accounts.login_start": DENIED,
  "claude_accounts.login_cancel": DENIED,
  "claude_accounts.login_submit_code": DENIED,
  "claude_accounts.login_status": DENIED,

  "projects.list": FILTER,
  "sessions.list": FILTER,
  // Accepted and ignored: a guest's view never warms the owner's sessions.
  "sessions.viewing": OPEN,
  "sessions.start_options": session(),
  "scratch_pads.list": FILTER,
  "agents.list": FILTER,
  "agents.stopped": FILTER,
  "devices.list": FILTER,
  // The host owner's other machines; nothing a guest has a claim on.
  "device_hosts.list": DENIED,
  // Spends the owner's money; a guest never starts a billed session.
  "device_hosts.start_eas_session": DENIED,
  // Ending one only saves it, so a guest granted the device may.
  "device_hosts.stop_eas_session": device(),

  "agents.status": agent(),
  "agents.vitals": agent(),
  "agents.mcp_status": agent(),
  "agents.transcript": agent(),
  "agents.image": agent(),
  "agents.capabilities": agent(),
  "agents.send": agent(),
  "agents.interrupt": agent(),
  "agents.dismiss_limit_resume": agent(),
  "agents.limit_handoff": agent(),
  "agents.handoff_to_account": agent(),
  "agents.stop": agent(),
  "agents.set_model": agent(),
  "agents.set_claude_account": agent(),
  "agents.set_permission_mode": agent(),
  "agents.set_effort": agent(),
  "agents.queue_list": agent(),
  "agents.queue_add": agent(),
  "agents.queue_remove": agent(),
  "agents.queue_update": agent(),
  "agents.queue_send_now": agent(),
  "agents.rewind": agent(),
  "permission.respond": agent(),

  // Keyed by a history id, not an agent id — nothing a scope can name, and a
  // guest has no business reading agents that ran before the huddle.
  "agents.stopped_transcript": DENIED,
  "agents.stopped_image": DENIED,
  "agents.history_search": DENIED,
  "agents.history_delete": DENIED,
  // Spawning is creating an agent outside the scope by definition.
  "agents.spawn": DENIED,
  // Scoped to its source agent; the handler still refuses any scoped guest,
  // since the fork it starts is outside the scope.
  "agents.fork": agent(),

  // This connection's own device record and push registration.
  "device.rename": OPEN,
  "device.capabilities": OPEN,
  "device.push_info": OPEN,
  "device.register_push": OPEN,
  "device.unregister_push": OPEN,

  "sessions.files": session(),
  "sessions.resolve_mention_path": session(),
  "files.read": session(),
  "files.search": session(),
  "files.search_cancel": session(),
  "sessions.git_status": session(),
  // Terminal output carries whatever the host's shells print — env dumps,
  // tokens in URLs — which is the owner's, not a huddle guest's.
  "terminals.list": DENIED,
  "terminals.read": DENIED,
  "terminals.scrollback": DENIED,
  "sessions.branches": session(),
  // Only useful for creating a session, which a guest can't.
  "projects.base_branches": DENIED,
  "sessions.diff": session(),
  "sessions.merge_blockers": session(),

  // Creating, destroying or re-pointing a session/branch is the engineer's
  // call, never a guest's — even for the session their agent runs in.
  "sessions.create": DENIED,
  "scratch_pads.create": DENIED,
  "sessions.delete": DENIED,
  "sessions.rename": DENIED,
  "sessions.rename_branch": DENIED,
  "sessions.set_base_branch": DENIED,
  "sessions.retry_setup": DENIED,
  "sessions.mark_ready": DENIED,
  "sessions.checkout": DENIED,
  // Landing work is the engineer's call too — a guest reviews, never ships.
  "sessions.commit": DENIED,
  "sessions.push": DENIED,
  "sessions.merge_base": DENIED,
  "sessions.stashes": DENIED,
  "sessions.stash_apply": DENIED,
  "sessions.stash_drop": DENIED,
  "sessions.tags": DENIED,
  "sessions.create_branch": DENIED,
  "sessions.delete_branch": DENIED,
  // Branch history and branch ops are project-root only — a guest's grant is
  // one agent's session, never the repo behind it.
  "sessions.branch_log": DENIED,
  "sessions.commit_diff": DENIED,
  "sessions.compare_branches": DENIED,
  "sessions.branch_pr_url": DENIED,
  "sessions.merge_branch": DENIED,
  "sessions.rebase_current": DENIED,
  "sessions.push_branch": DENIED,
  "sessions.pull": DENIED,
  "sessions.rename_local_branch": DENIED,
  "sessions.pin_branch": DENIED,

  "devices.watch": device(),
  "devices.unwatch": device(),
  "devices.claim": device(),
  "devices.release": device(),
  "devices.claim_status": device(),
  "devices.state": device(),
  "devices.set_orientation": device(),
  "devices.set_fold": device(),
  "devices.touch": device(),
  "devices.button": device(),
  "devices.keyboard": device(),

  // Automations are the host's own surface, not an agent's. A huddle guest is
  // handed one agent and nothing else — least of all the clock behind it.
  "automations.list": DENIED,
  "automations.runs": DENIED,
  "automations.run": DENIED,
  "automations.get": DENIED,
  "automations.sources": DENIED,
  "automations.runners": DENIED,
  "automations.create": DENIED,
  "automations.update": DENIED,
  "automations.revise_playbook": DENIED,
  "automations.delete": DENIED,
  "automations.memories": DENIED,
  "automations.save_memory": DENIED,
  "automations.delete_memory": DENIED,
  "automations.set_enabled": DENIED,
  "automations.run_now": DENIED,
  "automations.run_scratch": DENIED,
  "automations.save_scratch_run": DENIED,
  "automations.cancel_run": DENIED,
  "automations.delete_run": DENIED,
  "automations.calibration": DENIED,
  "automations.draft": DENIED,
  "automations.default_autonomy": DENIED,
  "automations.set_default_autonomy": DENIED,
  "automations.mark_run_read": DENIED,
  "automations.run_feedback": DENIED,
  // The host owner's Linear account; a guest has no claim on it.
  "integrations.list": DENIED,
  "linear.issues": DENIED,
  "linear.issue": DENIED,
  "linear.update_issue": DENIED,
  "linear.comment": DENIED,
  "figma.frame_details": DENIED,
  "design.compare": DENIED,
  // A guest reviews the agent it was handed; it does not speak on GitHub.
  "github.pull_requests": DENIED,
  "github.pull_request": DENIED,
  "github.create_pull_request": DENIED,
  "github.merge_pull_request": DENIED,
  "github.comment_pull_request": DENIED,
  "proposals.list": DENIED,
  "proposals.accept": DENIED,
  "proposals.dismiss": DENIED,
  "proposals.resolve": DENIED,
  "proposals.perform_cleanup": DENIED,
  "proposals.get": DENIED,
  "proposals.request_revision": DENIED,

  // Browser streams share the claim table under a `browser:` prefix, so the
  // session id has to be namespaced before it is matched against device_keys.
  "browser.watch": browser(),
  "browser.unwatch": browser(),
};

/** Methods whose result is narrowed to the scope instead of being refused. */
export const SCOPE_FILTERED_METHODS = (
  Object.keys(METHOD_SCOPE) as RemoteMethod[]
).filter((m) => METHOD_SCOPE[m].kind === "filter");

export function isAgentInScope(scope: GrantScope, agentId: string): boolean {
  return scope.agent_ids.includes(agentId);
}

export function isDeviceInScope(scope: GrantScope, deviceKey: string): boolean {
  return scope.device_keys.includes(deviceKey);
}

export function isBrowserInScope(
  scope: GrantScope,
  sessionId: string,
): boolean {
  return isDeviceInScope(scope, browserClaimId(sessionId));
}
