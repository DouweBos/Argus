/**
 * Application-layer message envelopes carried inside the Noise transport.
 * Every message has a strictly-increasing `seq` (per connection, per direction)
 * as replay/reorder defense-in-depth on top of Noise's own nonce counter.
 */

import { z } from "zod";
import { LogEntry } from "./account/schema";
import { REMOTE_EVENTS } from "./capabilities";
import { HuddleChatPayload, HuddleStatePayload } from "./huddle";
import {
  RemoteAgentCapabilities,
  RemoteAgentStatus,
  RemoteAutomation,
  RemoteAutomationDetail,
  RemoteAutomationMemory,
  RemoteAutomationGuardrails,
  RemoteAutomationRun,
  RemoteAgentVitals,
  RemoteMcpServerStatus,
  RemoteClaudeAccount,
  RemoteClaudeLoginState,
  RemoteDevice,
  RemoteDeviceHost,
  RemoteDeviceClaim,
  RemoteDeviceClaimState,
  RemoteDeviceOrientation,
  RemoteDeviceState,
  RemoteEndpoint,
  RemoteBranchCompare,
  RemoteCommit,
  RemoteGitBranch,
  RemoteGitStatus,
  RemoteTerminal,
  RemoteTerminalOutput,
  RemoteImageAttachment,
  RemoteMentionPathResult,
  RemoteMessage,
  RemotePermissionRequest,
  RemoteProject,
  RemoteProposal,
  RemoteProposalStatus,
  RemotePullRequest,
  RemotePullRequestDetail,
  RemoteQueuedMessage,
  RemoteRunFeedback,
  RemoteRunner,
  RemoteSession,
  RemoteSignalSource,
  RemoteFoldPose,
  RemoteStoppedAgent,
  RemoteTask,
  RemoteTodo,
} from "./models";
import { AutomationCalibration } from "./models/automations";
import { CodeFile, CodeSearchEvent } from "./models/code";
import { GitStashEntry } from "./models/git/history";
import { GitTag } from "./models/git/remotes";
import {
  DesignComparison,
  FigmaFrameDetails,
  IntegrationStatus,
  LinearIssue,
  LinearIssueDetail,
  LinearIssueScope,
  LinearWorkflowState,
} from "./models/integrations";
import {
  ClaudeUsageLimits,
  ClaudeUsageSummary,
  LimitHandoffAccount,
  UsageRange,
} from "./models/usage";
import { ReportBlock } from "./report";

/**
 * Permission modes a control device may switch an agent to. Deliberately
 * excludes "trusted" (bypassPermissions): a remote must never be able to spawn
 * or flip an agent into unattended auto-approval — that stays host-only.
 */
export const RemotePermissionMode = z.enum(["ask", "auto", "plan", "review"]);
export type RemotePermissionMode = z.infer<typeof RemotePermissionMode>;

/** Device platform, shared across the device-control methods. */
export const RemotePlatform = z.enum(["ios", "android"]);
export type RemotePlatform = z.infer<typeof RemotePlatform>;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

// Bounded so a remote can't stream an unbounded prompt into agent stdin, but loose
// enough for a pasted build log; the 16 MB gateway frame is the hard ceiling.
const MAX_PROMPT = 1_000_000;

/**
 * The editable half of an automation. Create sends it whole; update sends a
 * partial. `repo_roots` carries real paths — the host rejects any it doesn't
 * know, so a phone can't point a run at an unregistered directory.
 */
export const AutomationInput = z.object({
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  trigger_kind: z.enum(["manual", "schedule"]),
  cron: z.string(),
  timezone: z.string(),
  catch_up: z.boolean(),
  repo_roots: z.array(z.string()),
  source_ids: z.array(z.string()),
  playbook: z.string(),
  /** Optional so a client built before it existed still creates and saves. */
  extra_instructions: z.string().optional(),
  autonomy: z.enum(["auto_merge", "draft", "pr", "propose"]).nullable(),
  model: z.string().nullable(),
  /** Optional so a client built before runners could be picked still creates. */
  runner: z.string().nullable().optional(),
  guardrails: RemoteAutomationGuardrails,
});
export type AutomationInput = z.infer<typeof AutomationInput>;

// --- Request params per method ---------------------------------------------

export const MethodParams = {
  "host.endpoints": z.object({}),
  "account.status": z.object({}),
  "account.request_link": z.object({}),
  /** Entries of the caller's verified log past the host's head, in order. */
  "account.sync": z.object({
    epoch: z.number().int().nonnegative(),
    entries: z.array(LogEntry).max(500),
  }),
  "projects.list": z.object({}),
  "sessions.list": z.object({ repo_root: z.string() }),
  /**
   * The session this client is looking at, null for none, so the host keeps
   * a warm agent there. `runner_id` is the start composer's runner pick.
   */
  "sessions.viewing": z.object({
    session_id: z.string().nullish(),
    runner_id: z.string().nullish(),
  }),
  /** What a start composer offers before its agent exists; `runner_id` is its pick. */
  "sessions.start_options": z.object({
    session_id: z.string(),
    runner_id: z.string().nullish(),
  }),
  "scratch_pads.list": z.object({}),
  "agents.list": z.object({
    session_id: z.string().optional(),
    /** List all agents across a project's sessions (incl. the project root). */
    repo_root: z.string().optional(),
  }),
  "agents.status": z.object({ agent_id: z.string() }),
  "agents.vitals": z.object({ agent_id: z.string() }),
  "agents.mcp_status": z.object({ agent_id: z.string() }),
  "agents.transcript": z.object({
    agent_id: z.string(),
    /** Forward cursor — return messages starting at this index. */
    after: z.number().int().nonnegative().optional(),
    /** Backward cursor — return the page ending just before this index (for
     * lazy-loading older history when scrolling up). Omitting both `after` and
     * `before` returns the most-recent page (the tail). */
    before: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(500).optional(),
  }),
  /** Resolve a transcript image reference to its bytes. */
  "agents.image": z.object({
    agent_id: z.string(),
    image_id: z.string(),
  }),
  "agents.stopped": z.object({
    repo_root: z.string(),
    limit: z.number().int().positive().max(100).optional(),
  }),
  "agents.stopped_transcript": z.object({
    repo_root: z.string(),
    history_id: z.string(),
    after: z.number().int().nonnegative().optional(),
    before: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(500).optional(),
  }),
  "agents.stopped_image": z.object({
    repo_root: z.string(),
    history_id: z.string(),
    image_id: z.string(),
  }),
  "permission.respond": z.object({
    agent_id: z.string(),
    tool_use_id: z.string(),
    decision: z.enum(["allow", "deny"]),
    /** Optional message sent with a deny — carries AskUserQuestion answers or
     * plan feedback, so the client can respond inline like the desktop. */
    message: z.string().optional(),
    /** With an allow: also allow this kind of call for the rest of the session.
     * The host derives the rule from the prompt; the client can't name one. */
    always_allow: z.boolean().optional(),
  }),
  "device.rename": z.object({ name: z.string().trim().min(1).max(60) }),
  "device.capabilities": z.object({}),
  "device.push_info": z.object({}),
  "device.register_push": z.object({
    /** Which push service issued the registration. */
    service: z.enum(["apns", "fcm", "webpush"]),
    /** APNs token (hex), FCM registration id, or the Web Push endpoint URL. */
    token: z.string().min(1).max(4096),
    /** APNs only: which Apple environment minted the token. */
    environment: z.enum(["production", "sandbox"]).optional(),
    /** Web Push only: the subscription's encryption keys, base64url. */
    keys: z
      .object({
        p256dh: z.string().min(1).max(256),
        auth: z.string().min(1).max(64),
      })
      .optional(),
    /**
     * APNs/FCM via the relay. `push_key` seals the notification so the relay
     * can't read it; `auth_key` is what the device registered with the relay,
     * so only desktops it paired with may push to it. Both 32 bytes, base64.
     */
    push_key: z.string().min(1).max(128).optional(),
    auth_key: z.string().min(1).max(128).optional(),
  }),
  "device.unregister_push": z.object({}),
  "agents.capabilities": z.object({ agent_id: z.string() }),
  "agents.send": z.object({
    agent_id: z.string(),
    message: z.string().max(MAX_PROMPT),
    /** What the clients show, when the sent text carries a preamble. */
    display_text: z.string().max(MAX_PROMPT).optional(),
    images: z.array(RemoteImageAttachment).max(20).optional(),
  }),
  "agents.interrupt": z.object({ agent_id: z.string() }),
  "agents.dismiss_limit_resume": z.object({ agent_id: z.string() }),
  "agents.limit_handoff": z.object({ agent_id: z.string() }),
  "agents.handoff_to_account": z.object({
    agent_id: z.string(),
    account_id: z.string(),
  }),
  "agents.stop": z.object({ agent_id: z.string() }),
  "agents.set_model": z.object({ agent_id: z.string(), model: z.string() }),
  /**
   * Pin the agent's session to a Claude account (`null` follows the host's
   * active one), restarting the agent on it while it has no conversation yet.
   */
  "agents.set_claude_account": z.object({
    agent_id: z.string(),
    account_id: z.string().nullable(),
  }),
  "agents.set_permission_mode": z.object({
    agent_id: z.string(),
    mode: RemotePermissionMode,
  }),
  "agents.set_effort": z.object({
    agent_id: z.string(),
    /** null clears back to the model default. */
    level: z.string().nullable(),
  }),
  "agents.spawn": z.object({
    session_id: z.string(),
    model: z.string().optional(),
    permission_mode: RemotePermissionMode.optional(),
    /** Resume a stopped agent's conversation instead of starting empty. */
    resume_session_id: z.string().optional(),
    /** Optional so a client built before runners could be picked still spawns. */
    runner_id: z.string().optional(),
  }),
  "agents.queue_list": z.object({ agent_id: z.string() }),
  "agents.queue_add": z.object({
    agent_id: z.string(),
    message: z.string().max(MAX_PROMPT),
    /** What the clients show, when the sent text carries a preamble. */
    display_text: z.string().max(MAX_PROMPT).optional(),
    images: z.array(RemoteImageAttachment).max(20).optional(),
  }),
  "agents.queue_remove": z.object({ agent_id: z.string(), id: z.string() }),
  "agents.queue_update": z.object({
    agent_id: z.string(),
    id: z.string(),
    message: z.string().max(MAX_PROMPT),
  }),
  "agents.queue_send_now": z.object({ agent_id: z.string(), id: z.string() }),
  "scratch_pads.create": z.object({
    name: z.string().trim().max(80).optional(),
  }),
  "sessions.create": z.object({
    repo_root: z.string(),
    branch: z.string(),
    description: z.string(),
    use_existing_branch: z.boolean().optional(),
    base_branch: z.string().optional(),
    /** Start an agent on this once setup finishes — the host waits, not the client. */
    prompt: z.string().max(MAX_PROMPT).optional(),
    /** What that agent starts on; each falls back to the host's default. */
    model: z.string().optional(),
    permission_mode: RemotePermissionMode.optional(),
    runner_id: z.string().optional(),
    /**
     * A Linear identifier (`ENG-123`) or issue URL. The host branches on
     * Linear's branch name, links the session to the issue and always starts
     * the agent, with the issue's context in front of `prompt`; `branch` and
     * `description` are ignored.
     */
    linear_issue: z.string().max(500).optional(),
  }),
  "sessions.files": z.object({ session_id: z.string() }),
  /** One file's contents, read-only: the phone views, it never writes. */
  "files.read": z.object({ session_id: z.string(), path: z.string() }),
  /**
   * Search the worktree. Subscribe to `code-search:<search_id>` first: matches
   * arrive as `files.search` events, ending with one `kind: "done"`.
   */
  "files.search": z.object({
    session_id: z.string(),
    search_id: z.string().regex(/^[\w-]{1,64}$/),
    query: z.string().min(1),
    regex: z.boolean().default(false),
    case_sensitive: z.boolean().default(false),
    whole_word: z.boolean().default(false),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    max_results: z.number().int().positive().optional(),
  }),
  "files.search_cancel": z.object({
    session_id: z.string(),
    search_id: z.string(),
  }),
  "sessions.resolve_mention_path": z.object({
    session_id: z.string(),
    query: z.string(),
  }),
  "sessions.delete": z.object({
    id: z.string(),
    delete_branch: z.boolean().optional(),
  }),
  "sessions.rename": z.object({
    id: z.string(),
    display_name: z.string().trim().min(1).max(80),
  }),
  "sessions.rename_branch": z.object({
    id: z.string(),
    branch: z.string().trim().min(1),
  }),
  "sessions.set_base_branch": z.object({
    id: z.string(),
    base_branch: z.string().trim().min(1),
  }),
  /** Re-run setup for a session whose setup failed. */
  "sessions.retry_setup": z.object({ id: z.string() }),
  /** Clear a failed setup and mark the session ready. */
  "sessions.mark_ready": z.object({ id: z.string() }),
  "sessions.git_status": z.object({ session_id: z.string() }),
  "terminals.list": z.object({ session_id: z.string() }),
  "terminals.read": z.object({ terminal_id: z.string() }),
  "terminals.scrollback": z.object({ terminal_id: z.string() }),
  "sessions.branches": z.object({ session_id: z.string() }),
  "sessions.checkout": z.object({
    session_id: z.string(),
    branch: z.string().trim().min(1),
    /**
     * How to treat uncommitted changes. "fail" (the default) reports the
     * blockage back so the client can offer stash/discard itself.
     */
    dirty: z.enum(["fail", "stash", "discard"]).optional(),
  }),
  "sessions.create_branch": z.object({
    session_id: z.string(),
    name: z.string().trim().min(1),
    /** Ref to branch from; defaults to the current HEAD. */
    start_point: z.string().optional(),
    checkout: z.boolean().optional(),
  }),
  "sessions.delete_branch": z.object({
    session_id: z.string(),
    name: z.string().trim().min(1),
    /** `git branch -D` — needed for a branch that isn't fully merged. */
    force: z.boolean().optional(),
  }),
  /** `branch` is any ref: a local name, or `origin/x` for a remote-only one. */
  "sessions.branch_log": z.object({
    session_id: z.string(),
    branch: z.string().trim().min(1),
    count: z.number().int().positive().max(500).optional(),
  }),
  "sessions.commit_diff": z.object({
    session_id: z.string(),
    hash: z.string().regex(/^[0-9a-f]{4,64}$/i),
  }),
  "sessions.compare_branches": z.object({
    session_id: z.string(),
    left: z.string().trim().min(1),
    right: z.string().trim().min(1),
  }),
  "sessions.branch_pr_url": z.object({
    session_id: z.string(),
    branch: z.string().trim().min(1),
  }),
  /** Merge `from` into whatever is checked out. */
  "sessions.merge_branch": z.object({
    session_id: z.string(),
    from: z.string().trim().min(1),
    squash: z.boolean().optional(),
  }),
  /** Rebase whatever is checked out onto `onto`. */
  "sessions.rebase_current": z.object({
    session_id: z.string(),
    onto: z.string().trim().min(1),
  }),
  "sessions.push_branch": z.object({
    session_id: z.string(),
    branch: z.string().trim().min(1),
    remote: z.string().trim().min(1).optional(),
    set_upstream: z.boolean().optional(),
    force_with_lease: z.boolean().optional(),
  }),
  /** Pull into the checked-out branch. */
  "sessions.pull": z.object({
    session_id: z.string(),
    strategy: z.enum(["ff-only", "merge", "rebase"]),
  }),
  "sessions.rename_local_branch": z.object({
    session_id: z.string(),
    from: z.string().trim().min(1),
    to: z.string().trim().min(1),
  }),
  "sessions.pin_branch": z.object({
    session_id: z.string(),
    branch: z.string().trim().min(1),
    pinned: z.boolean(),
  }),
  "sessions.diff": z.object({
    session_id: z.string(),
    mode: z.enum(["branch", "working"]).optional(),
  }),
  "sessions.commit": z.object({
    session_id: z.string(),
    message: z.string().trim().min(1),
    /** Stage everything first. A phone has no per-file staging UI. */
    stage_all: z.boolean().optional(),
    /** Fold into the last commit instead of making a new one. */
    amend: z.boolean().optional(),
  }),
  "sessions.stashes": z.object({ session_id: z.string() }),
  /** Apply a stash; `drop` also removes it once applied (a pop). */
  "sessions.stash_apply": z.object({
    session_id: z.string(),
    index: z.number().int().min(0),
    drop: z.boolean().optional(),
  }),
  "sessions.stash_drop": z.object({
    session_id: z.string(),
    index: z.number().int().min(0),
  }),
  "sessions.tags": z.object({ session_id: z.string() }),
  "sessions.push": z.object({ session_id: z.string() }),
  "sessions.merge_blockers": z.object({ session_id: z.string() }),
  "sessions.merge_base": z.object({
    session_id: z.string(),
    /** Squashing rewrites history, so the client always says which it wants. */
    strategy: z.enum(["keep", "squash"]),
  }),
  "devices.list": z.object({}),
  "device_hosts.list": z.object({}),
  /** Start a billed EAS Simulator session on one of the host's free slots. */
  "device_hosts.start_eas_session": z.object({ host_id: z.string() }),
  /** Stop an EAS Simulator session, ending its device. */
  "device_hosts.stop_eas_session": z.object({ device_id: z.string() }),
  /** Begin streaming a device's screen; returns a stream id for binary frames. */
  "devices.watch": z.object({
    device_id: z.string(),
    platform: RemotePlatform,
  }),
  "devices.unwatch": z.object({ device_id: z.string() }),
  /** How the device is being held; null on platforms that can't report it. */
  "devices.state": z.object({
    device_id: z.string(),
    platform: RemotePlatform,
  }),
  "devices.set_orientation": z.object({
    device_id: z.string(),
    platform: RemotePlatform,
    orientation: RemoteDeviceOrientation,
  }),
  /** Move the hinge of a foldable. Named pose or a raw angle in degrees. */
  "devices.set_fold": z.object({
    device_id: z.string(),
    platform: RemotePlatform,
    pose: z.union([RemoteFoldPose, z.number()]),
  }),
  /** Begin streaming an embedded browser's screen; returns its stream id. */
  "browser.watch": z.object({ session_id: z.string() }),
  "browser.unwatch": z.object({ session_id: z.string() }),
  /** Take interaction on a device; `force` steals it from a live holder. */
  "devices.claim": z.object({
    device_id: z.string(),
    force: z.boolean().optional(),
  }),
  "devices.release": z.object({ device_id: z.string() }),
  "devices.claim_status": z.object({ device_id: z.string() }),
  /** Normalized [0..1] touch. event_type: 0=down, 1=move, 2=up. */
  "devices.touch": z.object({
    device_id: z.string(),
    platform: RemotePlatform,
    // Clamp to the normalized range so a rogue value can't index off-screen.
    x: z.number().transform(clamp01),
    y: z.number().transform(clamp01),
    event_type: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  }),
  "devices.button": z.object({
    device_id: z.string(),
    platform: RemotePlatform,
    button: z.string(),
  }),
  /** Platform-native key codes (macOS virtual for iOS, AKEYCODE for Android). */
  "devices.keyboard": z.object({
    device_id: z.string(),
    platform: RemotePlatform,
    key_code: z.number(),
    modifiers: z.number(),
    is_down: z.boolean(),
  }),
  "automations.list": z.object({}),
  "automations.runs": z.object({
    /** Omit for every run across every automation, newest first. */
    automation_id: z.string().optional(),
    limit: z.number().int().positive().max(100).optional(),
  }),
  "automations.run": z.object({ run_id: z.string() }),
  "automations.get": z.object({ automation_id: z.string() }),
  "automations.sources": z.object({}),
  "automations.runners": z.object({}),
  "automations.create": z.object({ input: AutomationInput }),
  /** Every field optional: an editor sends only what it changed. */
  "automations.update": z.object({
    automation_id: z.string(),
    patch: AutomationInput.partial(),
  }),
  /** Rewrite a playbook to an instruction. Returns text; saving is separate. */
  "automations.revise_playbook": z.object({
    playbook: z.string(),
    instruction: z.string(),
    name: z.string().optional(),
  }),
  "automations.delete": z.object({ automation_id: z.string() }),
  "automations.memories": z.object({ automation_id: z.string() }),
  /** Creates or overwrites; `previous_name` renames. */
  "automations.save_memory": z.object({
    automation_id: z.string(),
    memory: RemoteAutomationMemory.omit({ updated_at: true }).extend({
      previous_name: z.string().nullable().optional(),
    }),
  }),
  "automations.delete_memory": z.object({
    automation_id: z.string(),
    name: z.string(),
  }),
  "automations.set_enabled": z.object({
    automation_id: z.string(),
    enabled: z.boolean(),
  }),
  "automations.run_now": z.object({ automation_id: z.string() }),
  /** Run a playbook once, with nothing saved behind it. */
  "automations.run_scratch": z.object({
    name: z.string().optional(),
    playbook: z.string().trim().min(1),
    repo_roots: z.array(z.string()),
    source_ids: z.array(z.string()),
    model: z.string().nullable(),
    guardrails: RemoteAutomationGuardrails,
  }),
  /** Promote a quick run into a real automation, prefilled from the run. */
  "automations.save_scratch_run": z.object({
    run_id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    enabled: z.boolean().optional(),
  }),
  "automations.cancel_run": z.object({ run_id: z.string() }),
  /** Its record, report and the proposals it raised, for good. */
  "automations.delete_run": z.object({ run_id: z.string() }),
  "automations.calibration": z.object({ automation_id: z.string() }),
  /** A draft from a sentence, for the editor to review. Nothing is saved. */
  "automations.draft": z.object({
    description: z.string().trim().min(1),
    timezone: z.string().optional(),
  }),
  "automations.default_autonomy": z.object({}),
  "automations.set_default_autonomy": z.object({
    autonomy: z.enum(["auto_merge", "draft", "pr", "propose"]).nullable(),
  }),
  "automations.mark_run_read": z.object({ run_id: z.string() }),
  "automations.run_feedback": z.object({
    run_id: z.string(),
    note: z.string(),
    /** Let the turn withdraw or supersede proposals. Off adds only. */
    allow_clearing: z.boolean().optional(),
  }),
  "integrations.list": z.object({}),
  /** No query: the connected user's open issues in `scope`, newest first. */
  "linear.issues": z.object({
    query: z.string().max(500).optional(),
    /** Ignored with a query; omitted is `assigned`. */
    scope: LinearIssueScope.optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  /** `ENG-123` or a Linear URL. */
  "linear.issue": z.object({ ref: z.string().trim().min(1).max(500) }),
  "linear.update_issue": z.object({
    issue_id: z.string(),
    state_id: z.string().optional(),
    priority: z.number().int().min(0).max(4).optional(),
  }),
  "linear.comment": z.object({
    issue_id: z.string(),
    body: z.string().trim().min(1),
    /** Replies in that comment's thread. */
    parent_id: z.string().optional(),
  }),
  /** A Figma frame link, `node-id` and all. */
  "figma.frame_details": z.object({ url: z.string().trim().min(1).max(2000) }),
  /** The frame against a screenshot of one of the computer's devices. */
  "design.compare": z.object({
    url: z.string().trim().min(1).max(2000),
    platform: z.enum(["android", "ios"]),
    device_key: z.string().min(1).max(200),
  }),
  "github.pull_requests": z.object({
    /** Omit for every registered project. */
    repo_roots: z.array(z.string()).optional(),
  }),
  "github.pull_request": z.object({
    /** `owner/repo`. */
    repo: z.string(),
    number: z.number().int().positive(),
  }),
  /** Addressed by session: the branch and its base are the host's to know. */
  "github.create_pull_request": z.object({
    session_id: z.string(),
    title: z.string().trim().min(1),
    body: z.string(),
    draft: z.boolean().optional(),
  }),
  "github.merge_pull_request": z.object({
    repo: z.string(),
    number: z.number().int().positive(),
    strategy: z.enum(["merge", "rebase", "squash"]),
  }),
  "github.comment_pull_request": z.object({
    repo: z.string(),
    number: z.number().int().positive(),
    body: z.string().trim().min(1),
  }),
  "proposals.list": z.object({
    /** Omit for everything; the inbox asks for `pending`. */
    status: RemoteProposalStatus.optional(),
    limit: z.number().int().positive().max(100).optional(),
  }),
  "proposals.accept": z.object({
    proposal_id: z.string(),
    /** Added to the agent's brief, as the desktop's "start with a note". */
    note: z.string().optional(),
  }),
  "proposals.get": z.object({ proposal_id: z.string() }),
  /** Ask the automation to rework it; the next run supersedes it. */
  "proposals.request_revision": z.object({
    proposal_id: z.string(),
    note: z.string().trim().min(1),
  }),
  /** Carry out a cleanup proposal's button. Destructive, so `control`-gated. */
  "proposals.perform_cleanup": z.object({ proposal_id: z.string() }),
  "proposals.dismiss": z.object({
    proposal_id: z.string(),
    /** Kept verbatim — it is what teaches the automation. */
    reason: z.string().optional(),
  }),
  /** Mark it done: the user handled what it asked, outside Argus. */
  "proposals.resolve": z.object({
    proposal_id: z.string(),
    /** What they did, kept verbatim. */
    note: z.string().optional(),
  }),
  "claude_accounts.list": z.object({}),
  "usage.limits": z.object({ refresh: z.boolean().optional() }),
  "usage.summary": z.object({ range: UsageRange }),
  "claude_accounts.set_active": z.object({ id: z.string() }),
  "claude_accounts.add": z.object({
    use_console: z.boolean().optional(),
  }),
  "claude_accounts.remove": z.object({ id: z.string() }),
  "claude_accounts.rename": z.object({ id: z.string(), label: z.string() }),
  /** Re-authenticate an account already in the list, instead of adding one. */
  "claude_accounts.login_start": z.object({
    account_id: z.string().optional(),
    use_console: z.boolean().optional(),
  }),
  "claude_accounts.login_cancel": z.object({}),
  "claude_accounts.login_submit_code": z.object({ code: z.string() }),
  "claude_accounts.login_status": z.object({}),
} as const;

// --- Result payloads per method --------------------------------------------

export const MethodResult = {
  "host.endpoints": z.object({ endpoints: z.array(RemoteEndpoint) }),
  "account.status": z.object({
    linked: z.boolean(),
    /** sha256 hex of the account id — enough to compare, nothing to look up. */
    account_id_hash: z.string().nullable(),
    head_seq: z.number().int().nullable(),
  }),
  "account.request_link": z.object({ user_code: z.string() }),
  /** The host's head after applying; `applied` counts entries that were new. */
  "account.sync": z.object({
    head_seq: z.number().int().nullable(),
    applied: z.number().int(),
  }),
  "projects.list": z.object({ projects: z.array(RemoteProject) }),
  "sessions.list": z.object({ sessions: z.array(RemoteSession) }),
  "sessions.viewing": z.object({}),
  "sessions.start_options": z.object({
    capabilities: RemoteAgentCapabilities,
  }),
  "scratch_pads.list": z.object({ sessions: z.array(RemoteSession) }),
  "agents.list": z.object({ agents: z.array(RemoteAgentStatus) }),
  "agents.status": z.object({ agent: RemoteAgentStatus }),
  "agents.vitals": z.object({ vitals: RemoteAgentVitals }),
  /** `servers` is null when the agent's CLI can't report MCP status. */
  "agents.mcp_status": z.object({
    servers: z.array(RemoteMcpServerStatus).nullable(),
    /** The Claude account the agent's process runs as. */
    account_id: z.string().nullable().optional(),
  }),
  "agents.transcript": z.object({
    messages: z.array(RemoteMessage),
    next_after: z.number().int().nonnegative().nullable(),
    /** Cursor to fetch the page of older messages, or null at the start. */
    prev_before: z.number().int().nonnegative().nullable().optional(),
    /** Total message count in the transcript (for pagination math). */
    total: z.number().int().nonnegative().optional(),
    /** Conversation-level task list (ordered), null when none/dismissed. */
    tasks: z.array(RemoteTask).nullable().optional(),
    /** Latest todo list, null when none/dismissed. */
    todos: z.array(RemoteTodo).nullable().optional(),
    /** Replies suggested once the last turn ended. Absent on older hosts. */
    follow_ups: z.array(z.string()).optional(),
    /** Model driving the conversation, if known. */
    model: z.string().nullable().optional(),
    /** Name of the tool currently executing, if any. */
    pending_tool_name: z.string().nullable().optional(),
    /** Line the page up with `agent.transcript` deltas. Absent on older hosts. */
    epoch: z.string().optional(),
    revision: z.number().int().nonnegative().optional(),
  }),
  "agents.image": z.object({
    /** Base64-encoded image bytes (no data-URL prefix). */
    data: z.string(),
    media_type: z.string(),
  }),
  "agents.stopped": z.object({ agents: z.array(RemoteStoppedAgent) }),
  "agents.stopped_transcript": z.object({
    messages: z.array(RemoteMessage),
    next_after: z.number().int().nonnegative().nullable(),
    prev_before: z.number().int().nonnegative().nullable().optional(),
    total: z.number().int().nonnegative().optional(),
    model: z.string().nullable().optional(),
  }),
  "agents.stopped_image": z.object({
    data: z.string(),
    media_type: z.string(),
  }),
  "permission.respond": z.object({
    accepted: z.boolean(),
    /** The rule an `always_allow` added. Absent from hosts that predate it. */
    allow_rule: z.string().optional(),
  }),
  "device.rename": z.object({ accepted: z.boolean() }),
  "device.capabilities": z.object({ capabilities: z.array(z.string()) }),
  "device.push_info": z.object({
    /** True when at least one push provider is usable. */
    configured: z.boolean(),
    /** Whether the user enabled background push on the desktop at all. */
    enabled: z.boolean(),
    /** VAPID application-server key for `PushManager.subscribe`, base64url. */
    vapid_public_key: z.string().nullable(),
    /**
     * Where native clients register their relay auth key, or null when this
     * desktop has its own APNs/FCM credentials and pushes Apple/Google direct.
     */
    relay_url: z.string().nullable(),
  }),
  "device.register_push": z.object({
    accepted: z.boolean(),
    /** False when the desktop has no push credentials configured yet. */
    configured: z.boolean(),
  }),
  "device.unregister_push": z.object({ accepted: z.boolean() }),
  "agents.capabilities": z.object({ capabilities: RemoteAgentCapabilities }),
  "agents.send": z.object({
    accepted: z.boolean(),
    /** True when the agent was mid-turn, so the host parked it on the queue. */
    queued: z.boolean().optional(),
  }),
  "agents.interrupt": z.object({ accepted: z.boolean() }),
  "agents.dismiss_limit_resume": z.object({ accepted: z.boolean() }),
  "agents.limit_handoff": z.object({
    accounts: z.array(LimitHandoffAccount),
  }),
  "agents.handoff_to_account": z.object({ accepted: z.boolean() }),
  "agents.stop": z.object({ accepted: z.boolean() }),
  "agents.set_model": z.object({ accepted: z.boolean() }),
  "agents.set_claude_account": z.object({ accepted: z.boolean() }),
  "agents.set_permission_mode": z.object({ accepted: z.boolean() }),
  "agents.set_effort": z.object({ accepted: z.boolean() }),
  "agents.spawn": z.object({ agent: RemoteAgentStatus }),
  "agents.queue_list": z.object({
    messages: z.array(RemoteQueuedMessage),
  }),
  "agents.queue_add": z.object({ message: RemoteQueuedMessage }),
  "agents.queue_remove": z.object({ accepted: z.boolean() }),
  "agents.queue_update": z.object({ accepted: z.boolean() }),
  /** `mid_turn`: the agent was busy, so the message joined its running turn. */
  "agents.queue_send_now": z.object({ mid_turn: z.boolean() }),
  "sessions.create": z.object({ session: RemoteSession }),
  "scratch_pads.create": z.object({ session: RemoteSession }),
  "sessions.files": z.object({ files: z.array(z.string()) }),
  "files.read": CodeFile,
  "files.search": z.object({ search_id: z.string() }),
  "files.search_cancel": z.object({ accepted: z.boolean() }),
  "sessions.resolve_mention_path": RemoteMentionPathResult,
  "sessions.delete": z.object({ accepted: z.boolean() }),
  "sessions.rename": z.object({ accepted: z.boolean() }),
  "sessions.rename_branch": z.object({ accepted: z.boolean() }),
  "sessions.set_base_branch": z.object({ accepted: z.boolean() }),
  "sessions.retry_setup": z.object({ accepted: z.boolean() }),
  "sessions.mark_ready": z.object({ accepted: z.boolean() }),
  "sessions.git_status": z.object({ status: RemoteGitStatus }),
  "terminals.list": z.object({ terminals: z.array(RemoteTerminal) }),
  "terminals.read": RemoteTerminalOutput,
  /** Base64 of the output broadcast so far; `terminal.data` events sequenced
   *  after this response carry exactly what it doesn't. */
  "terminals.scrollback": z.object({
    data: z.string(),
    truncated: z.boolean(),
    exit_code: z.number().int().nullable(),
  }),
  "sessions.branches": z.object({ branches: z.array(RemoteGitBranch) }),
  "sessions.checkout": z.object({
    accepted: z.boolean(),
    /** Set when the checkout was refused because the tree is dirty. */
    blocked_by: z.literal("dirty").optional(),
  }),
  "sessions.create_branch": z.object({ accepted: z.boolean() }),
  "sessions.delete_branch": z.object({
    accepted: z.boolean(),
    /** Set when the branch has commits that aren't merged anywhere. */
    blocked_by: z.literal("unmerged").optional(),
  }),
  "sessions.branch_log": z.object({ commits: z.array(RemoteCommit) }),
  "sessions.commit_diff": z.object({ diff: z.string() }),
  "sessions.compare_branches": RemoteBranchCompare,
  "sessions.branch_pr_url": z.object({ url: z.string().nullable() }),
  "sessions.merge_branch": z.object({ accepted: z.boolean() }),
  "sessions.rebase_current": z.object({ accepted: z.boolean() }),
  /** Git's own output, for the phone to show. */
  "sessions.push_branch": z.object({ output: z.string() }),
  "sessions.pull": z.object({ output: z.string() }),
  "sessions.rename_local_branch": z.object({ accepted: z.boolean() }),
  "sessions.pin_branch": z.object({ pinned: z.array(z.string()) }),
  "sessions.diff": z.object({
    diff: z.string(),
    base_branch: z.string().nullable().optional(),
  }),
  /** Git's own output, so a refusal reads the same as it does in a terminal. */
  "sessions.commit": z.object({ output: z.string() }),
  "sessions.stashes": z.object({ stashes: z.array(GitStashEntry) }),
  /** Git's own output, so a conflicting apply reads as it does in a terminal. */
  "sessions.stash_apply": z.object({ output: z.string() }),
  "sessions.stash_drop": z.object({ output: z.string() }),
  "sessions.tags": z.object({ tags: z.array(GitTag) }),
  "sessions.push": z.object({
    branch: z.string(),
    remote: z.string(),
    /** GitHub's "create a PR" link, when the push printed one. */
    pr_url: z.string().nullable(),
  }),
  /** Empty means the merge would go through. */
  "sessions.merge_blockers": z.object({ blockers: z.array(z.string()) }),
  "sessions.merge_base": z.object({ accepted: z.boolean() }),
  "devices.list": z.object({ devices: z.array(RemoteDevice) }),
  "device_hosts.list": z.object({ hosts: z.array(RemoteDeviceHost) }),
  "device_hosts.start_eas_session": z.object({ device_id: z.string() }),
  "device_hosts.stop_eas_session": z.object({ accepted: z.boolean() }),
  "devices.watch": z.object({ stream_id: z.number().int().nonnegative() }),
  "devices.unwatch": z.object({ accepted: z.boolean() }),
  "devices.state": z.object({ state: RemoteDeviceState.nullable() }),
  "devices.set_orientation": z.object({ state: RemoteDeviceState.nullable() }),
  "devices.set_fold": z.object({ state: RemoteDeviceState.nullable() }),
  "browser.watch": z.object({ stream_id: z.number().int().nonnegative() }),
  "browser.unwatch": z.object({ accepted: z.boolean() }),
  /** `holder` is the incumbent when `granted` is false. */
  "devices.claim": z.object({
    granted: z.boolean(),
    holder: RemoteDeviceClaim.nullable(),
  }),
  "devices.release": z.object({ accepted: z.boolean() }),
  "devices.claim_status": z.object({
    holder: RemoteDeviceClaim.nullable(),
    /** The asking connection's own id — the only way a client learns it. */
    connection_id: z.string(),
  }),
  "devices.touch": z.object({ accepted: z.boolean() }),
  "devices.button": z.object({ accepted: z.boolean() }),
  "devices.keyboard": z.object({ accepted: z.boolean() }),
  "automations.list": z.object({ automations: z.array(RemoteAutomation) }),
  "automations.runs": z.object({ runs: z.array(RemoteAutomationRun) }),
  "automations.run": z.object({
    run: RemoteAutomationRun,
    /** Structured blocks when the run emitted them, else null. */
    report_blocks: z.array(ReportBlock).nullable(),
    /** The agent's final message. Null while the run is still going. */
    report_markdown: z.string().nullable(),
    /** What the user pushed back on after reading it, oldest first. */
    feedback: z.array(RemoteRunFeedback),
  }),
  "automations.get": z.object({ automation: RemoteAutomationDetail }),
  "automations.sources": z.object({ sources: z.array(RemoteSignalSource) }),
  "automations.runners": z.object({ runners: z.array(RemoteRunner) }),
  /** Both shapes back, so a client can refresh its list and its editor. */
  "automations.create": z.object({
    automation: RemoteAutomation,
    detail: RemoteAutomationDetail,
  }),
  "automations.update": z.object({
    automation: RemoteAutomation,
    detail: RemoteAutomationDetail,
  }),
  "automations.revise_playbook": z.object({ playbook: z.string() }),
  "automations.delete": z.object({ accepted: z.boolean() }),
  "automations.memories": z.object({
    memories: z.array(RemoteAutomationMemory),
  }),
  "automations.save_memory": z.object({ memory: RemoteAutomationMemory }),
  "automations.delete_memory": z.object({ accepted: z.boolean() }),
  "automations.set_enabled": z.object({ automation: RemoteAutomation }),
  /** The run record as created — it is still queued when this returns. */
  "automations.run_now": z.object({ run: RemoteAutomationRun }),
  "automations.run_scratch": z.object({ run: RemoteAutomationRun }),
  "automations.save_scratch_run": z.object({ automation: RemoteAutomation }),
  "automations.cancel_run": z.object({ accepted: z.boolean() }),
  "automations.delete_run": z.object({ accepted: z.boolean() }),
  "automations.calibration": AutomationCalibration,
  /** `automation.id` is empty: nothing is saved until the editor saves it. */
  "automations.draft": z.object({
    automation: RemoteAutomationDetail,
    notes: z.array(z.string()),
  }),
  /** The app-wide cap on how far any automation may go; null is no cap. */
  "automations.default_autonomy": z.object({
    autonomy: z.enum(["auto_merge", "draft", "pr", "propose"]).nullable(),
  }),
  "automations.set_default_autonomy": z.object({
    autonomy: z.enum(["auto_merge", "draft", "pr", "propose"]).nullable(),
  }),
  /** The run as it now stands — read. */
  "automations.mark_run_read": z.object({ run: RemoteAutomationRun }),
  "automations.run_feedback": z.object({ run: RemoteAutomationRun }),
  "integrations.list": z.object({ integrations: z.array(IntegrationStatus) }),
  "linear.issues": z.object({ issues: z.array(LinearIssue) }),
  /** Null when Linear has no such issue; `states` is its team's workflow, for
   *  the status picker. */
  "linear.issue": z.object({
    issue: LinearIssueDetail.nullable(),
    states: z.array(LinearWorkflowState),
  }),
  "linear.update_issue": z.object({ issue: LinearIssue }),
  "linear.comment": z.object({ accepted: z.boolean() }),
  /** Null when the link isn't a frame Figma could render. */
  "figma.frame_details": z.object({ details: FigmaFrameDetails.nullable() }),
  "design.compare": z.object({ comparison: DesignComparison }),
  "github.pull_requests": z.object({
    pull_requests: z.array(RemotePullRequest),
  }),
  "github.pull_request": z.object({ pull_request: RemotePullRequestDetail }),
  "github.create_pull_request": z.object({
    number: z.number(),
    url: z.string(),
  }),
  "github.merge_pull_request": z.object({ accepted: z.boolean() }),
  "github.comment_pull_request": z.object({ accepted: z.boolean() }),
  "proposals.list": z.object({ proposals: z.array(RemoteProposal) }),
  /**
   * Answers once the start is under way, not when it is done: building the
   * session can outlast a request. Follow `start_stage` / `start_error` on the
   * proposal; the ids are set only when it finished inside the window.
   */
  "proposals.accept": z.object({
    proposal: RemoteProposal,
    session_id: z.string().nullable(),
    agent_id: z.string().nullable(),
  }),
  /** Carry out a cleanup proposal's button. Destructive, so `control`-gated. */
  "proposals.perform_cleanup": z.object({ proposal_id: z.string() }),
  "proposals.get": z.object({ proposal: RemoteProposal }),
  "proposals.request_revision": z.object({
    proposal: RemoteProposal,
    /** False when no run was started — the note waits for the next one. */
    run_started: z.boolean(),
  }),
  "proposals.dismiss": z.object({ proposal: RemoteProposal }),
  "proposals.resolve": z.object({ proposal: RemoteProposal }),
  "claude_accounts.list": z.object({
    accounts: z.array(RemoteClaudeAccount),
    active_id: z.string(),
  }),
  "usage.limits": ClaudeUsageLimits,
  "usage.summary": ClaudeUsageSummary,
  "claude_accounts.set_active": z.object({ accepted: z.boolean() }),
  /** The sign-in URL. It opens in the host owner's browser; the code still has
   *  to be pasted back here for the browser callback to be seen. */
  "claude_accounts.add": z.object({ url: z.string() }),
  "claude_accounts.remove": z.object({ accepted: z.boolean() }),
  "claude_accounts.rename": z.object({ accepted: z.boolean() }),
  "claude_accounts.login_start": z.object({ url: z.string() }),
  "claude_accounts.login_cancel": z.object({ accepted: z.boolean() }),
  "claude_accounts.login_submit_code": z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
  "claude_accounts.login_status": RemoteClaudeLoginState,
} as const;

// --- Envelopes -------------------------------------------------------------

export const RequestEnvelope = z.object({
  type: z.literal("req"),
  seq: z.number().int().nonnegative(),
  /** Client-chosen id echoed on the matching response. */
  id: z.string(),
  method: z.string(),
  params: z.unknown(),
});
export type RequestEnvelope = z.infer<typeof RequestEnvelope>;

export const ResponseEnvelope = z.object({
  type: z.literal("res"),
  seq: z.number().int().nonnegative(),
  id: z.string(),
  ok: z.unknown().optional(),
  error: z
    .object({
      code: z.enum([
        "capability_denied",
        "bad_request",
        "not_found",
        "internal",
      ]),
      message: z.string(),
      /** Structured payload for errors the client rehydrates (e.g. GitError). */
      data: z.unknown().optional(),
    })
    .optional(),
});
export type ResponseEnvelope = z.infer<typeof ResponseEnvelope>;

/** Client → gateway: subscribe/unsubscribe to a specific agent's event stream. */
export const SubscribeEnvelope = z.object({
  type: z.literal("sub"),
  seq: z.number().int().nonnegative(),
  action: z.enum(["subscribe", "unsubscribe"]),
  agent_id: z.string(),
});
export type SubscribeEnvelope = z.infer<typeof SubscribeEnvelope>;

export const EventEnvelope = z.object({
  type: z.literal("evt"),
  seq: z.number().int().nonnegative(),
  event: z.enum(REMOTE_EVENTS),
  agent_id: z.string().nullable().optional(),
  payload: z.unknown(),
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;

export const Envelope = z.discriminatedUnion("type", [
  RequestEnvelope,
  ResponseEnvelope,
  SubscribeEnvelope,
  EventEnvelope,
]);
export type Envelope = z.infer<typeof Envelope>;

// --- Local UI socket ---------------------------------------------------------

/**
 * The local UI socket's protocol, advertised in `host.lock` next to its path.
 * A client attaches only to a version it speaks; bump on a breaking change.
 */
export const LOCAL_UI_PROTOCOL = 1;

/**
 * `error.data.reason` when the host has no such method or command: the client
 * is newer than the host. `error.data.method` names what was asked for.
 */
export const UNKNOWN_COMMAND = "unknown_command";

/**
 * What the host asks of the UI attached to its local socket: the
 * `HostPlatform` capabilities a headless Node process can't do itself. Flat
 * rather than a union so every client decodes it the same way; `kind` says
 * which fields are set.
 */
export const PlatformRequest = z.object({
  kind: z.enum([
    "notify",
    "open_external",
    "open_path",
    "reveal_in_finder",
    "focus_ui",
    "close_device_popout",
  ]),
  /** `notify`: answer with `ui.notification_action` carrying this id. */
  id: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  urgency: z.enum(["critical", "normal"]).optional(),
  /** `notify`: button labels, in order. */
  actions: z.array(z.string()).optional(),
  /** `open_external`. */
  url: z.string().optional(),
  /** `open_path` / `reveal_in_finder`. */
  path: z.string().optional(),
  /** `close_device_popout`: `platform:deviceKey`. */
  key: z.string().optional(),
});
export type PlatformRequest = z.infer<typeof PlatformRequest>;

/**
 * Methods only the local UI socket answers — the UI's half of platform
 * delegation. Not remote methods: no paired device can reach them.
 */
export const LocalUiMethods = {
  /**
   * The UI's window gained or lost focus. `role` says whether it answers the
   * host's platform requests (`platform`, the supervising app — the default)
   * or only watches a host whose own app does (`viewer`, an attached window).
   */
  "ui.state": z.object({
    foreground: z.boolean(),
    role: z.enum(["platform", "viewer"]).optional(),
  }),
  /** A `notify` banner was clicked (`action` null) or one of its buttons pressed. */
  "ui.notification_action": z.object({
    id: z.string(),
    action: z.number().int().nonnegative().nullable(),
  }),
} as const;
export type LocalUiMethod = keyof typeof LocalUiMethods;

// --- Event payload schemas -------------------------------------------------

export const EventPayloads = {
  "host.endpoints": z.object({ endpoints: z.array(RemoteEndpoint) }),
  "agent.event": z.object({ agent_id: z.string(), event: z.unknown() }),
  "agent.status": RemoteAgentStatus,
  /**
   * What changed in an agent's transcript since `revision - 1`. `messages` are
   * upserted by id (unknown ids append, in order); `removed_ids` were removed
   * or are now hidden. The other fields are the current values, small enough
   * to send whole. A gap in `revision`, or a new `epoch`, means: refetch.
   */
  "agent.transcript": z.object({
    agent_id: z.string(),
    epoch: z.string(),
    revision: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    messages: z.array(RemoteMessage),
    removed_ids: z.array(z.string()),
    title: z.string().nullable(),
    model: z.string().nullable(),
    pending_tool_name: z.string().nullable(),
    tasks: z.array(RemoteTask).nullable(),
    todos: z.array(RemoteTodo).nullable(),
    /** Replies suggested once the last turn ended. Absent on older hosts. */
    follow_ups: z.array(z.string()).optional(),
  }),
  "agent.queue": z.object({
    agent_id: z.string(),
    messages: z.array(RemoteQueuedMessage),
  }),
  "agent.capabilities": RemoteAgentCapabilities,
  "permission.request": RemotePermissionRequest,
  "permission.cancel": z.object({
    agent_id: z.string(),
    tool_use_id: z.string(),
  }),
  /** `channel` is the renderer IPC channel; `args` its broadcast arguments. */
  ipc: z.object({ channel: z.string(), args: z.array(z.unknown()) }),
  "platform.request": PlatformRequest,
  /** The claim on a device changed — including being stolen from you. */
  "device.claim": RemoteDeviceClaimState,
  /** The hinge or orientation moved — from here, Device Hub, or an agent. */
  "device.state": RemoteDeviceState,
  /** This guest's standing in its huddle room changed (host approved/denied/ended). */
  "huddle.state": HuddleStatePayload,
  /** Someone in the huddle said something to the room. */
  "huddle.chat": HuddleChatPayload,
  /** Null when the change is a deletion and the repo is no longer knowable —
   *  a client that cares refetches whatever it holds. */
  "sessions.changed": z.object({ repo_root: z.string().nullable() }),
  "projects.changed": z.object({}),
  /** Base64 output, in the order the terminal produced it. */
  "terminal.data": z.object({ terminal_id: z.string(), data: z.string() }),
  "terminal.exit": z.object({ terminal_id: z.string(), exit_code: z.number() }),
  /** Results of a search this device subscribed to as `code-search:<id>`. */
  "files.search": CodeSearchEvent,
  /** Carries the new state outright — the list is small, and a rate limit or a
   *  finished login landing on the account screen should not need a refetch. */
  "claude_accounts.changed": z.object({
    accounts: z.array(RemoteClaudeAccount),
    active_id: z.string(),
  }),
  /** Pushed when a sign-in starts needing a code, and again when it ends — the
   *  same shape `login_status` returns, so a client has one thing to render. */
  "claude_accounts.login": RemoteClaudeLoginState,
  notification: z.object({
    agent_id: z.string().nullable(),
    session_id: z.string().nullable(),
    /** The prompt a quick action answers; only set for "permission". */
    tool_use_id: z.string().nullable(),
    kind: z.enum(["finished", "failed", "permission", "push"]),
    title: z.string(),
    body: z.string(),
    /** Buttons on the notification itself — the same set the desktop shows. */
    actions: z
      .array(
        z.object({
          id: z.enum(["approve", "deny"]),
          title: z.string(),
        }),
      )
      .default([]),
  }),
} as const;
