/**
 * Application-layer message envelopes carried inside the Noise transport.
 * Every message has a strictly-increasing `seq` (per connection, per direction)
 * as replay/reorder defense-in-depth on top of Noise's own nonce counter.
 */

import { z } from "zod";
import { REMOTE_EVENTS } from "./capabilities";
import { HuddleStatePayload } from "./huddle";
import {
  RemoteAgentCapabilities,
  RemoteAgentStatus,
  RemoteAutomation,
  RemoteAutomationRun,
  RemoteAgentVitals,
  RemoteDevice,
  RemoteDeviceClaim,
  RemoteDeviceClaimState,
  RemoteEndpoint,
  RemoteGitBranch,
  RemoteGitStatus,
  RemoteImageAttachment,
  RemoteMentionPathResult,
  RemoteMessage,
  RemotePermissionRequest,
  RemoteProject,
  RemoteQueuedMessage,
  RemoteSession,
  RemoteStoppedAgent,
  RemoteTask,
  RemoteTodo,
} from "./models";
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

// --- Request params per method ---------------------------------------------

export const MethodParams = {
  "host.endpoints": z.object({}),
  "projects.list": z.object({}),
  "sessions.list": z.object({ repo_root: z.string() }),
  "agents.list": z.object({
    session_id: z.string().optional(),
    /** List all agents across a project's sessions (incl. the project root). */
    repo_root: z.string().optional(),
  }),
  "agents.status": z.object({ agent_id: z.string() }),
  "agents.vitals": z.object({ agent_id: z.string() }),
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
    // Bounded to keep a remote from streaming an unbounded prompt into agent stdin.
    message: z.string().max(100_000),
    /** What the clients show, when the sent text carries a preamble. */
    display_text: z.string().max(100_000).optional(),
    images: z.array(RemoteImageAttachment).max(20).optional(),
  }),
  "agents.interrupt": z.object({ agent_id: z.string() }),
  "agents.stop": z.object({ agent_id: z.string() }),
  "agents.set_model": z.object({ agent_id: z.string(), model: z.string() }),
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
  }),
  "agents.queue_list": z.object({ agent_id: z.string() }),
  "agents.queue_add": z.object({
    agent_id: z.string(),
    message: z.string().max(100_000),
    /** What the clients show, when the sent text carries a preamble. */
    display_text: z.string().max(100_000).optional(),
    images: z.array(RemoteImageAttachment).max(20).optional(),
  }),
  "agents.queue_remove": z.object({ agent_id: z.string(), id: z.string() }),
  "agents.queue_update": z.object({
    agent_id: z.string(),
    id: z.string(),
    message: z.string().max(100_000),
  }),
  "sessions.create": z.object({
    repo_root: z.string(),
    branch: z.string(),
    description: z.string(),
    use_existing_branch: z.boolean().optional(),
    base_branch: z.string().optional(),
  }),
  "sessions.files": z.object({ session_id: z.string() }),
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
  "sessions.git_status": z.object({ session_id: z.string() }),
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
  "sessions.diff": z.object({
    session_id: z.string(),
    mode: z.enum(["branch", "working"]).optional(),
  }),
  "devices.list": z.object({}),
  /** Begin streaming a device's screen; returns a stream id for binary frames. */
  "devices.watch": z.object({
    device_id: z.string(),
    platform: RemotePlatform,
  }),
  "devices.unwatch": z.object({ device_id: z.string() }),
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
  "automations.run_now": z.object({ automation_id: z.string() }),
  "automations.cancel_run": z.object({ run_id: z.string() }),
} as const;

// --- Result payloads per method --------------------------------------------

export const MethodResult = {
  "host.endpoints": z.object({ endpoints: z.array(RemoteEndpoint) }),
  "projects.list": z.object({ projects: z.array(RemoteProject) }),
  "sessions.list": z.object({ sessions: z.array(RemoteSession) }),
  "agents.list": z.object({ agents: z.array(RemoteAgentStatus) }),
  "agents.status": z.object({ agent: RemoteAgentStatus }),
  "agents.vitals": z.object({ vitals: RemoteAgentVitals }),
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
    /** Model driving the conversation, if known. */
    model: z.string().nullable().optional(),
    /** Name of the tool currently executing, if any. */
    pending_tool_name: z.string().nullable().optional(),
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
  "permission.respond": z.object({ accepted: z.boolean() }),
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
  "agents.stop": z.object({ accepted: z.boolean() }),
  "agents.set_model": z.object({ accepted: z.boolean() }),
  "agents.set_permission_mode": z.object({ accepted: z.boolean() }),
  "agents.set_effort": z.object({ accepted: z.boolean() }),
  "agents.spawn": z.object({ agent: RemoteAgentStatus }),
  "agents.queue_list": z.object({
    messages: z.array(RemoteQueuedMessage),
  }),
  "agents.queue_add": z.object({ message: RemoteQueuedMessage }),
  "agents.queue_remove": z.object({ accepted: z.boolean() }),
  "agents.queue_update": z.object({ accepted: z.boolean() }),
  "sessions.create": z.object({ session: RemoteSession }),
  "sessions.files": z.object({ files: z.array(z.string()) }),
  "sessions.resolve_mention_path": RemoteMentionPathResult,
  "sessions.delete": z.object({ accepted: z.boolean() }),
  "sessions.rename": z.object({ accepted: z.boolean() }),
  "sessions.rename_branch": z.object({ accepted: z.boolean() }),
  "sessions.git_status": z.object({ status: RemoteGitStatus }),
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
  "sessions.diff": z.object({
    diff: z.string(),
    base_branch: z.string().nullable().optional(),
  }),
  "devices.list": z.object({ devices: z.array(RemoteDevice) }),
  "devices.watch": z.object({ stream_id: z.number().int().nonnegative() }),
  "devices.unwatch": z.object({ accepted: z.boolean() }),
  "browser.watch": z.object({ stream_id: z.number().int().nonnegative() }),
  "browser.unwatch": z.object({ accepted: z.boolean() }),
  /** `holder` is the incumbent when `granted` is false. */
  "devices.claim": z.object({
    granted: z.boolean(),
    holder: RemoteDeviceClaim.nullable(),
  }),
  "devices.release": z.object({ accepted: z.boolean() }),
  "devices.claim_status": z.object({ holder: RemoteDeviceClaim.nullable() }),
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
  }),
  /** The run record as created — it is still queued when this returns. */
  "automations.run_now": z.object({ run: RemoteAutomationRun }),
  "automations.cancel_run": z.object({ accepted: z.boolean() }),
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

// --- Event payload schemas -------------------------------------------------

export const EventPayloads = {
  "host.endpoints": z.object({ endpoints: z.array(RemoteEndpoint) }),
  "agent.event": z.object({ agent_id: z.string(), event: z.unknown() }),
  "agent.status": RemoteAgentStatus,
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
  /** The claim on a device changed — including being stolen from you. */
  "device.claim": RemoteDeviceClaimState,
  /** This guest's standing in its huddle room changed (host approved/denied/ended). */
  "huddle.state": HuddleStatePayload,
  "sessions.changed": z.object({ repo_root: z.string() }),
  "projects.changed": z.object({}),
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
