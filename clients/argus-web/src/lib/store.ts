/**
 * App store: owns the identity, the live Transport, and the monitor-scoped data
 * it fetches. Agents are fetched per-project (across all sessions, incl. the
 * project root). Transcripts are structured messages, refreshed on live events.
 */

import { create } from "zustand";
import {
  clearIdentity,
  credentialsFor,
  defaultDeviceName,
  loadIdentity,
  saveIdentity,
} from "./keystore";
import {
  applyDeltaMessages,
  deltaAction,
  type TranscriptCursor,
} from "@argus/client-core";
import type { DeviceIdentity } from "./keystore";
import {
  fetchHostKey,
  guestClientId,
  guestKeypair,
  readGuestLabel,
  rememberGuestLabel,
} from "./huddleIdentity";
import {
  applyHuddleChat,
  applyHuddleState,
  huddleCapabilities,
  INITIAL_HUDDLE_VIEW,
  requestJoin,
  type HuddleView,
} from "./huddleSession";
import { showRemoteNotification } from "./notify";
import { wsOrigin } from "./origin";
import {
  clearPendingDecision,
  queuePendingDecision,
  readPendingDecisions,
  type PendingDecision,
} from "./pendingDecisions";
import {
  pushPreference,
  registerWebPush,
  setPushPreference,
  unregisterWebPush,
  type WebPushState,
} from "./webpush";
import type {
  EventEnvelope,
  HuddleChatPayload,
  HuddleStatePayload,
  PermissionRespondParams,
  PermissionRespondResult,
  RemoteDeviceClaim,
  RemoteDeviceClaimState,
  RemoteDeviceOrientation,
  RemoteMethod,
  RemoteDeviceState,
  RemoteFoldPose,
  RemoteAgentCapabilities,
  RemoteAgentStatus,
  RemoteQueuedMessage,
  RemoteDevice,
  RemoteGitStatus,
  RemoteImageAttachment,
  RemoteImageData,
  RemoteMentionPathResult,
  RemoteMessage,
  RemoteNotification,
  RemotePermissionMode,
  RemotePermissionRequest,
  RemotePlatform,
  RemoteProject,
  RemoteSession,
  RemoteTask,
  RemoteTodo,
  RemoteTranscript,
  RemoteTranscriptDelta,
} from "./protocol";
import {
  MediaRouter,
  Transport,
  type ConnectionState,
  type MediaMessage,
} from "@argus/remote-client";

/** Everything a host connection fetched, back to empty. */
const DISCONNECTED = {
  identity: null,
  deviceName: "",
  transport: null,
  connection: "offline",
  projects: [],
  sessionsByRepo: {},
  agentsByRepo: {},
  recentAgents: [],
  messagesByAgent: {},
  optimisticByAgent: {},
  queuedByAgent: {},
  tasksByAgent: {},
  todosByAgent: {},
  followUpsByAgent: {},
  pendingToolByAgent: {},
  prevBeforeByAgent: {},
  gitStatusBySession: {},
  prompts: {},
  answered: {},
  imageCache: {},
  capabilities: [],
  capabilitiesByAgent: {},
  statusByAgent: {},
  effortByAgent: {},
  devices: [],
} satisfies Partial<AppState>;

/** Cheap deep-equality via JSON — transcript pages are small and polled rarely. */
const jsonEq = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** True when two arrays hold the same element references in order. */
const sameRefs = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

interface AppState {
  identity: DeviceIdentity | null;
  deviceName: string;
  connection: ConnectionState;
  transport: Transport | null;
  projects: RemoteProject[];
  sessionsByRepo: Record<string, RemoteSession[]>;
  agentsByRepo: Record<string, RemoteAgentStatus[]>;
  /** All agents across every project, for the home "Recent agents" section. */
  recentAgents: RemoteAgentStatus[];
  messagesByAgent: Record<string, RemoteMessage[]>;
  /** Locally-appended user messages awaiting confirmation in the next snapshot. */
  optimisticByAgent: Record<string, RemoteMessage[]>;
  /** Messages typed while the agent is busy, flushed in order once it goes idle. */
  queuedByAgent: Record<string, RemoteQueuedMessage[]>;
  tasksByAgent: Record<string, RemoteTask[] | null>;
  todosByAgent: Record<string, RemoteTodo[] | null>;
  /** Replies suggested once each agent's last turn ended. */
  followUpsByAgent: Record<string, string[]>;
  /** Name of the tool currently executing per agent (drives the activity row). */
  pendingToolByAgent: Record<string, string | null>;
  /** Cursor to fetch the next older page per agent (null = start reached). */
  prevBeforeByAgent: Record<string, number | null>;
  /** Latest git status per session (badges + changes-view header). */
  gitStatusBySession: Record<string, RemoteGitStatus>;
  prompts: Record<string, RemotePermissionRequest>;
  /** Tool prompts this client just answered (`${agentId}:${toolUseId}`) — clears
   * the inline form instantly, before the resolved snapshot round-trips back. */
  answered: Record<string, true>;
  /** Resolved image bytes keyed by `${agentId}:${imageId}` → data URL. */
  imageCache: Record<string, string>;
  /** This device's current capability grants (seeded from pairing, refreshed live). */
  capabilities: string[];
  /** Input pickers' data (models/commands/subagents) per agent. */
  capabilitiesByAgent: Record<string, RemoteAgentCapabilities>;
  /** Latest known status for an agent (drives the input's Send/Stop + pills). */
  statusByAgent: Record<string, RemoteAgentStatus>;
  /** Locally-chosen effort per agent (not surfaced by the monitor snapshot). */
  effortByAgent: Record<string, string | null>;
  /** Connected simulators/emulators (from devices.list). */
  devices: RemoteDevice[];
  /** Who holds input per device, so a locked-out client says so rather than
   *  tapping at a picture that never answers. */
  claimByDevice: Record<string, RemoteDeviceClaim | null>;
  /** Our own connection id, learned the first time the host grants us a claim. */
  claimConnectionId: string | null;
  /** How each watched device is being held, so the stream is presented upright. */
  deviceStateById: Record<string, RemoteDeviceState | null>;
  /**
   * Guest standing when this tab was opened on a huddle link. Null for a
   * paired device — the two modes never mix in one tab.
   */
  huddle: HuddleView | null;
  /** Whether the user wants background push in this browser. */
  pushEnabled: boolean;
  /** Where Web Push registration got to — drives the Settings copy. */
  pushState: WebPushState;

  /** Answer a prompt from a notification button, even while offline. */
  decidePrompt: (
    agentId: string,
    toolUseId: string,
    decision: "allow" | "deny",
  ) => Promise<void>;
  init: () => void;
  /**
   * Open a huddle link: handshake with an ephemeral key, present the token,
   * then sit pending until the host approves — the socket is upgraded in
   * place, so there is no second connection.
   */
  joinHuddle: (token: string, label: string) => Promise<void>;
  /** Hang up on a huddle from the guest side. The link still works after. */
  leaveHuddle: () => void;
  /** Say something to the room. Never reaches the agent. */
  sayInHuddle: (text: string) => void;
  /**
   * Change the name the room sees. Re-presents the token on the same key, so
   * the grant survives and nobody has to approve the guest a second time.
   */
  renameInHuddle: (label: string) => void;
  /**
   * Tell the room we are (or are no longer) composing. Presence only: the draft
   * never leaves this browser, and a drop expires the flag host-side anyway,
   * so a failed send is nothing to recover from.
   */
  setHuddleTyping: (typing: boolean) => void;
  pairComplete: (identity: DeviceIdentity) => void;
  /** Connect to an account computer (hosted client); nothing is persisted here. */
  openAccountHost: (identity: DeviceIdentity) => void;
  /** Drop the account computer and everything fetched from it. */
  closeHost: () => void;
  setDeviceName: (name: string) => Promise<void>;
  setPushEnabled: (enabled: boolean) => Promise<void>;
  unpair: () => void;
  refreshProjects: () => Promise<void>;
  loadRecentAgents: () => Promise<void>;
  loadSessions: (repoRoot: string) => Promise<void>;
  loadAgents: (repoRoot: string) => Promise<void>;
  loadTranscript: (agentId: string) => Promise<void>;
  /** Fetch and prepend the next page of older messages (lazy scroll-up). */
  loadOlderMessages: (agentId: string) => Promise<void>;
  loadImage: (agentId: string, imageId: string) => Promise<void>;
  watchAgent: (agentId: string, on: boolean) => void;
  respond: (
    agentId: string,
    toolUseId: string,
    decision: "allow" | "deny",
    message?: string,
  ) => Promise<void>;

  // --- control-scoped (no-ops without the "control" grant) ---------------
  hasControl: () => boolean;
  loadAgentStatus: (agentId: string) => Promise<void>;
  setEffortLocal: (agentId: string, level: string | null) => void;
  loadCapabilities: (agentId: string) => Promise<void>;
  sendMessage: (
    agentId: string,
    message: string,
    images?: RemoteImageAttachment[],
    /** Text to show in the optimistic bubble (message minus any preamble). */
    displayText?: string,
  ) => Promise<void>;
  /** Park a message on the computer's queue until the agent's turn ends. */
  queueMessage: (
    agentId: string,
    message: string,
    images: RemoteImageAttachment[] | undefined,
    displayText: string,
  ) => Promise<void>;
  /** Drop a still-queued message before it's sent. */
  removeQueued: (agentId: string, id: string) => Promise<void>;
  updateQueued: (agentId: string, id: string, message: string) => Promise<void>;
  /** Send one queued message ahead of the rest, into a busy agent's turn. */
  sendQueuedNow: (agentId: string, id: string) => Promise<void>;
  /** Fetch the computer's queue for an agent (then follow `agent.queue`). */
  loadQueue: (agentId: string) => Promise<void>;
  interrupt: (agentId: string) => Promise<void>;
  /** Cancel the continue scheduled after a usage limit. */
  dismissLimitResume: (agentId: string) => Promise<void>;
  setModel: (agentId: string, model: string) => Promise<void>;
  setPermissionMode: (
    agentId: string,
    mode: RemotePermissionMode,
  ) => Promise<void>;
  setEffort: (agentId: string, level: string | null) => Promise<void>;
  spawnAgent: (
    sessionId: string,
    opts?: { model?: string; permissionMode?: RemotePermissionMode },
  ) => Promise<RemoteAgentStatus>;
  createSession: (params: {
    repoRoot: string;
    branch: string;
    description: string;
    useExistingBranch?: boolean;
    baseBranch?: string;
  }) => Promise<RemoteSession>;
  stopAgentProcess: (agentId: string) => Promise<void>;
  deleteSession: (
    id: string,
    repoRoot: string,
    deleteBranch?: boolean,
  ) => Promise<void>;
  renameSession: (id: string, repoRoot: string, name: string) => Promise<void>;
  renameSessionBranch: (
    id: string,
    repoRoot: string,
    branch: string,
  ) => Promise<void>;
  loadGitStatus: (sessionId: string) => Promise<void>;
  loadDiff: (
    sessionId: string,
    mode: "branch" | "working",
  ) => Promise<{ diff: string; base_branch: string | null }>;
  listFiles: (sessionId: string) => Promise<string[]>;
  resolveMentionPath: (
    sessionId: string,
    query: string,
  ) => Promise<RemoteMentionPathResult>;

  // --- devices -----------------------------------------------------------
  refreshDevices: () => Promise<void>;
  /** Start streaming a device's screen; returns the binary-frame stream id. */
  watchDevice: (deviceId: string, platform: RemotePlatform) => Promise<number>;
  unwatchDevice: (deviceId: string) => Promise<void>;
  /** Seed a device's pose; the host pushes `device.state` while we watch it. */
  loadDeviceState: (
    deviceId: string,
    platform: RemotePlatform,
  ) => Promise<void>;
  /** Rotate the device. Arbitrated by the same claim as a tap. */
  setDeviceOrientation: (
    deviceId: string,
    platform: RemotePlatform,
    orientation: RemoteDeviceOrientation,
  ) => Promise<void>;
  /** Move a foldable's hinge. */
  setDeviceFold: (
    deviceId: string,
    platform: RemotePlatform,
    pose: RemoteFoldPose,
  ) => Promise<void>;
  /** Route parsed media frames for a stream to a sink (the device view). */
  registerMediaSink: (
    streamId: number,
    sink: (msg: MediaMessage) => void,
  ) => () => void;
  /** Fire-and-forget touch (moves are unawaited to avoid head-of-line latency). */
  deviceTouch: (
    deviceId: string,
    platform: RemotePlatform,
    x: number,
    y: number,
    eventType: 0 | 1 | 2,
  ) => void;
  deviceButton: (
    deviceId: string,
    platform: RemotePlatform,
    button: string,
  ) => Promise<void>;
  deviceKeyboard: (
    deviceId: string,
    platform: RemotePlatform,
    keyCode: number,
    modifiers: number,
    isDown: boolean,
  ) => void;
  /** Seed who holds a device before the first input, so the overlay is right. */
  loadClaim: (deviceId: string) => Promise<void>;
  /** Take the claim; `force` steals it from a live holder. */
  claimDevice: (deviceId: string, force?: boolean) => Promise<void>;
  releaseDevice: (deviceId: string) => void;
}

export function imageKey(agentId: string, imageId: string): string {
  return `${agentId}:${imageId}`;
}

/** Messages fetched per transcript page (tail on open, older on scroll-up). */
const TRANSCRIPT_PAGE = 80;

/** The map with this agent's follow-ups replaced, or itself when unchanged. */
function withFollowUps(
  byAgent: Record<string, string[]>,
  agentId: string,
  followUps: string[] | undefined,
): Record<string, string[]> {
  const next = followUps ?? [];

  return jsonEq(byAgent[agentId] ?? [], next)
    ? byAgent
    : { ...byAgent, [agentId]: next };
}

export const useAppStore = create<AppState>((set, get) => {
  // Binary media routing (kept out of reactive state — hot path, no re-render).
  const media = new MediaRouter();

  // The room this tab is in, so a rename can re-present the same token.
  let huddleToken: string | null = null;

  // Where each transcript's newest page sits in the host's deltas. An agent
  // whose host has sent one stops refetching on every event.
  const cursors = new Map<string, TranscriptCursor>();
  const followsDeltas = new Set<string>();
  /** Deltas that arrived while a page was in flight, keyed by agent. */
  const buffered = new Map<string, RemoteTranscriptDelta[]>();

  const applyDelta = (delta: RemoteTranscriptDelta) => {
    const agentId = delta.agent_id;
    const action = deltaAction(cursors.get(agentId), delta);
    if (action === "drop") {
      return;
    }
    if (action === "refetch") {
      scheduleTranscript(agentId);

      return;
    }
    cursors.set(agentId, { epoch: delta.epoch, revision: delta.revision });
    set((s) => {
      const existing = s.messagesByAgent[agentId] ?? [];
      const messages = applyDeltaMessages(existing, delta);

      return {
        messagesByAgent:
          messages === existing
            ? s.messagesByAgent
            : { ...s.messagesByAgent, [agentId]: messages },
        tasksByAgent: jsonEq(s.tasksByAgent[agentId], delta.tasks)
          ? s.tasksByAgent
          : { ...s.tasksByAgent, [agentId]: delta.tasks },
        todosByAgent: jsonEq(s.todosByAgent[agentId], delta.todos)
          ? s.todosByAgent
          : { ...s.todosByAgent, [agentId]: delta.todos },
        followUpsByAgent: withFollowUps(
          s.followUpsByAgent,
          agentId,
          delta.follow_ups,
        ),
        pendingToolByAgent: {
          ...s.pendingToolByAgent,
          [agentId]: delta.pending_tool_name,
        },
      };
    });
  };

  // Debounce live transcript refreshes so a burst of events → one refetch.
  const refetchTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const scheduleTranscript = (agentId: string) => {
    clearTimeout(refetchTimers.get(agentId));
    refetchTimers.set(
      agentId,
      setTimeout(() => {
        get()
          .loadTranscript(agentId)
          .catch(() => {});
      }, 300),
    );
  };

  function onEvent(ev: EventEnvelope): void {
    if (ev.event === "permission.request") {
      const p = ev.payload as RemotePermissionRequest;
      set((s) => ({
        prompts: { ...s.prompts, [`${p.agent_id}:${p.tool_use_id}`]: p },
      }));
      // Refresh the transcript so the tool call renders its pending form inline.
      if (!followsDeltas.has(p.agent_id)) {
        scheduleTranscript(p.agent_id);
      }
    } else if (ev.event === "permission.cancel") {
      const p = ev.payload as { agent_id: string; tool_use_id: string };
      set((s) => {
        const next = { ...s.prompts };
        delete next[`${p.agent_id}:${p.tool_use_id}`];

        return { prompts: next };
      });
      if (!followsDeltas.has(p.agent_id)) {
        scheduleTranscript(p.agent_id);
      }
    } else if (ev.event === "agent.status") {
      const a = ev.payload as RemoteAgentStatus;
      set((s) => {
        const next = { ...s.agentsByRepo };
        for (const [repo, list] of Object.entries(next)) {
          if (list.some((x) => x.agent_id === a.agent_id)) {
            next[repo] = list.map((x) => (x.agent_id === a.agent_id ? a : x));
          }
        }

        const recentAgents = s.recentAgents.some(
          (x) => x.agent_id === a.agent_id,
        )
          ? s.recentAgents.map((x) => (x.agent_id === a.agent_id ? a : x))
          : [a, ...s.recentAgents];

        return {
          agentsByRepo: next,
          recentAgents,
          statusByAgent: { ...s.statusByAgent, [a.agent_id]: a },
        };
      });
    } else if (ev.event === "agent.queue" && ev.agent_id) {
      const { messages } = ev.payload as { messages: RemoteQueuedMessage[] };
      set((s) => ({
        queuedByAgent: {
          ...s.queuedByAgent,
          [ev.agent_id as string]: messages,
        },
      }));
    } else if (ev.event === "agent.capabilities" && ev.agent_id) {
      // Pickers become available once the CLI handshake completes.
      set((s) => ({
        capabilitiesByAgent: {
          ...s.capabilitiesByAgent,
          [ev.agent_id as string]: ev.payload as RemoteAgentCapabilities,
        },
      }));
    } else if (ev.event === "agent.transcript") {
      const delta = ev.payload as RemoteTranscriptDelta;
      followsDeltas.add(delta.agent_id);
      const waiting = buffered.get(delta.agent_id);
      if (waiting) {
        waiting.push(delta);
      } else {
        applyDelta(delta);
      }
    } else if (ev.event === "agent.event" && ev.agent_id) {
      // An older host sends no deltas: re-fetch the structured transcript.
      if (!followsDeltas.has(ev.agent_id)) {
        scheduleTranscript(ev.agent_id);
      }
    } else if (ev.event === "notification") {
      showRemoteNotification(ev.payload as RemoteNotification);
    } else if (ev.event === "device.state") {
      // The hinge and orientation move from the desktop or an agent as easily
      // as from here, so the host is the only source worth trusting.
      const state = ev.payload as RemoteDeviceState;
      set((s) => ({
        deviceStateById: { ...s.deviceStateById, [state.device_id]: state },
      }));
    } else if (ev.event === "device.claim") {
      const c = ev.payload as RemoteDeviceClaimState;
      set((s) => ({
        claimByDevice: { ...s.claimByDevice, [c.device_id]: c.holder },
      }));
    } else if (ev.event === "huddle.chat") {
      set((s) => ({
        huddle: s.huddle
          ? applyHuddleChat(ev.payload as HuddleChatPayload, s.huddle)
          : s.huddle,
      }));
    } else if (ev.event === "huddle.state") {
      // Approval upgrades this very socket, so the grant arrives as an event
      // rather than a reconnect. Denied and ended are terminal.
      const view = applyHuddleState(
        ev.payload as HuddleStatePayload,
        get().huddle ?? undefined,
      );
      set({ huddle: view, capabilities: huddleCapabilities(view.state) });
      if (view.state === "denied" || view.state === "ended") {
        // The host drops the socket right after this. Stop dialling: a guest
        // who was turned away or whose huddle ended should read that, not a
        // reconnect spinner.
        get().transport?.disconnect();
      }
    }
  }

  /** Adopt the holder a refused input reports, in case it beat the broadcast. */
  function adoptClaimDenial(err: unknown): void {
    const data =
      err && typeof err === "object" && "data" in err
        ? (err as { data: unknown }).data
        : null;
    if (
      data &&
      typeof data === "object" &&
      typeof (data as RemoteDeviceClaimState).device_id === "string"
    ) {
      const state = data as RemoteDeviceClaimState;
      set((s) => ({
        claimByDevice: { ...s.claimByDevice, [state.device_id]: state.holder },
      }));
    }
  }

  /**
   * Run a pose write and adopt the state it answers with, so the picture turns
   * with the press rather than waiting on the host's next poll.
   */
  async function applyDeviceStateWrite(
    method: RemoteMethod,
    deviceId: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    const t = get().transport;
    if (!t) {
      return;
    }
    try {
      const { state } = await t.request<{ state: RemoteDeviceState | null }>(
        method,
        params,
      );
      set((s) => ({
        deviceStateById: { ...s.deviceStateById, [deviceId]: state },
      }));
    } catch (err) {
      adoptClaimDenial(err);
    }
  }

  /**
   * Replay a queued Approve/Deny. The gateway only accepts answers to prompts
   * it forwarded to *this* connection, and it re-forwards pending ones when we
   * subscribe — so subscribe first, then retry while the replay lands.
   */
  async function flushDecision(
    transport: Transport,
    decision: PendingDecision,
  ): Promise<boolean> {
    transport.subscribe(decision.agentId, true);
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          await transport.request<PermissionRespondResult>(
            "permission.respond",
            {
              agent_id: decision.agentId,
              tool_use_id: decision.toolUseId,
              decision: decision.decision,
            } satisfies PermissionRespondParams,
          );

          return true;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }

      return false;
    } finally {
      transport.subscribe(decision.agentId, false);
    }
  }

  async function flushPendingDecisions(transport: Transport): Promise<void> {
    for (const decision of readPendingDecisions(Date.now())) {
      const sent = await flushDecision(transport, decision);
      // Drop it either way: a prompt that never came back is gone for good.
      clearPendingDecision(decision);
      if (sent) {
        scheduleTranscript(decision.agentId);
      }
    }
  }

  function connect(identity: DeviceIdentity): Transport {
    const transport = new Transport(credentialsFor(identity), {
      onState: (connection) => {
        set({ connection });
        // Push our display name once the secure channel is up, so the desktop's
        // paired-device list shows a friendly label instead of "New device".
        if (connection === "ready") {
          if (identity.account) {
            // An account device is named on the account, and push for the
            // hosted client isn't wired: it serves every computer from one origin.
            identity.account.onReady(transport);
          } else {
            const name = get().deviceName.trim();
            if (name) {
              transport.request("device.rename", { name }).catch(() => {});
            }
          }
          // Refresh grants from the desktop — reflects any control toggle made
          // while we were offline (the desktop drops the socket on change).
          transport
            .request<{ capabilities: string[] }>("device.capabilities", {})
            .then((r) => set({ capabilities: r.capabilities }))
            .catch(() => {});
          if (!identity.account) {
            registerWebPush(transport)
              .then((pushState) => set({ pushState }))
              .catch(() => {});
          }
          flushPendingDecisions(transport).catch(() => {});
        } else {
          set({ pushState: "off" });
        }
      },
      onEvent,
      onMedia: (bytes) => media.push(bytes),
    });
    transport.connect();

    return transport;
  }

  /**
   * A huddle guest's socket. Deliberately leaner than {@link connect}: a guest
   * has no device record to rename, no push subscription and no parked
   * decisions — it has no capabilities at all until the host approves it.
   */
  function connectGuest(token: string, label: string, hostPubB64: string): Transport {
    const { privB64, pubB64 } = guestKeypair(token);
    const transport = new Transport(
      {
        url: wsOrigin(),
        devPrivB64: privB64,
        devPubB64: pubB64,
        hostPubB64,
      },
      {
        onState: (connection) => {
          set({ connection });
          if (connection !== "ready") {
            return;
          }
          // Re-present the token on every (re)connect: an already-approved key
          // is re-granted silently, so a reload costs no second approval.
          requestJoin(
            transport,
            token,
            readGuestLabel() || label,
            get().huddle ?? undefined,
            guestClientId(),
          )
            .then((view) => {
              set({
                huddle: view,
                capabilities: huddleCapabilities(view.state),
              });
              // A refusal and a dead link are both final — retrying the join
              // on every reconnect would only spin.
              if (view.state === "denied" || view.state === "unavailable") {
                transport.disconnect();
              }
            })
            .catch(() => {});
        },
        onEvent,
        onMedia: (bytes) => media.push(bytes),
      },
    );
    transport.connect();

    return transport;
  }

  return {
    identity: null,
    deviceName: "",
    connection: "offline",
    transport: null,
    projects: [],
    sessionsByRepo: {},
    agentsByRepo: {},
    recentAgents: [],
    messagesByAgent: {},
    optimisticByAgent: {},
    queuedByAgent: {},
    tasksByAgent: {},
    todosByAgent: {},
    followUpsByAgent: {},
    pendingToolByAgent: {},
    prevBeforeByAgent: {},
    gitStatusBySession: {},
    prompts: {},
    answered: {},
    imageCache: {},
    capabilities: [],
    pushEnabled: pushPreference(),
    pushState: "off",
    capabilitiesByAgent: {},
    statusByAgent: {},
    effortByAgent: {},
    devices: [],
    claimByDevice: {},
    claimConnectionId: null,
    deviceStateById: {},
    huddle: null,

    init: () => {
      const identity = loadIdentity();
      if (identity) {
        set({
          identity,
          deviceName: identity.name || defaultDeviceName(),
          capabilities: identity.capabilities,
          transport: connect(identity),
        });
      }
    },

    joinHuddle: async (token, label) => {
      huddleToken = token;
      get().transport?.disconnect();
      set({ huddle: INITIAL_HUDDLE_VIEW, capabilities: [], identity: null });
      try {
        const hostPubB64 = await fetchHostKey();
        set({ transport: connectGuest(token, label, hostPubB64) });
      } catch {
        // No key published means no open room: the link is dead, not broken.
        set((s) => ({
          huddle: { ...(s.huddle ?? INITIAL_HUDDLE_VIEW), state: "unavailable" },
        }));
      }
    },

    sayInHuddle: (text) => {
      if (get().huddle?.state !== "approved") {
        return;
      }
      get()
        .transport?.request("huddle.say", { text })
        .catch(() => {});
    },

    renameInHuddle: (label) => {
      const name = label.trim();
      if (!name) {
        return;
      }
      rememberGuestLabel(name);
      const transport = get().transport;
      if (!transport || !huddleToken || get().connection !== "ready") {
        return;
      }
      requestJoin(
        transport,
        huddleToken,
        name,
        get().huddle ?? undefined,
        guestClientId(),
      )
        .then((view) => {
          set({ huddle: view, capabilities: huddleCapabilities(view.state) });
        })
        .catch(() => {});
    },

    setHuddleTyping: (typing) => {
      if (get().huddle?.state !== "approved") {
        return;
      }
      get()
        .transport?.request("huddle.typing", { typing })
        .catch(() => {});
    },

    leaveHuddle: () => {
      // Dropping the socket is what tells the host, via the connection's own
      // teardown. Keep the view so the gate can offer to go back in.
      get().transport?.disconnect();
      set((s) => ({
        transport: null,
        capabilities: [],
        huddle: { ...(s.huddle ?? INITIAL_HUDDLE_VIEW), state: "left" },
      }));
    },

    pairComplete: (identity) => {
      saveIdentity(identity);
      get().transport?.disconnect();
      set({
        identity,
        deviceName: identity.name || defaultDeviceName(),
        capabilities: identity.capabilities,
        transport: connect(identity),
      });
    },

    openAccountHost: (identity) => {
      get().transport?.disconnect();
      set({
        ...DISCONNECTED,
        identity,
        deviceName: identity.name,
        capabilities: [],
        transport: connect(identity),
      });
    },

    closeHost: () => {
      get().transport?.disconnect();
      set(DISCONNECTED);
    },

    decidePrompt: async (agentId, toolUseId, decision) => {
      queuePendingDecision({ agentId, toolUseId, decision, at: Date.now() });
      const transport = get().transport;
      if (get().connection === "ready" && transport) {
        await flushPendingDecisions(transport).catch(() => {});
      }
    },

    setPushEnabled: async (enabled) => {
      setPushPreference(enabled);
      set({ pushEnabled: enabled });
      const transport = get().transport;
      if (!enabled) {
        await unregisterWebPush(transport);
        set({ pushState: "off" });

        return;
      }
      if (get().connection === "ready" && transport) {
        set({ pushState: await registerWebPush(transport) });
      }
    },

    setDeviceName: async (rawName) => {
      const name = rawName.trim();
      if (!name) {
        return;
      }
      set({ deviceName: name });
      const identity = get().identity;
      if (identity) {
        const next = { ...identity, name };
        saveIdentity(next);
        set({ identity: next });
      }
      if (get().connection === "ready") {
        await get()
          .transport?.request("device.rename", { name })
          .catch(() => {});
      }
    },

    unpair: () => {
      void unregisterWebPush(get().transport);
      get().transport?.disconnect();
      clearIdentity();
      set(DISCONNECTED);
    },

    refreshProjects: async () => {
      const t = get().transport;
      if (!t) {
        return;
      }
      const { projects } = await t.request<{ projects: RemoteProject[] }>(
        "projects.list",
        {},
      );
      set({ projects });
    },

    loadRecentAgents: async () => {
      const t = get().transport;
      if (!t) {
        return;
      }
      const { agents } = await t.request<{ agents: RemoteAgentStatus[] }>(
        "agents.list",
        {},
      );
      set({ recentAgents: agents });
    },

    loadSessions: async (repoRoot) => {
      const t = get().transport;
      if (!t) {
        return;
      }
      const { sessions } = await t.request<{ sessions: RemoteSession[] }>(
        "sessions.list",
        { repo_root: repoRoot },
      );
      set((s) => ({
        sessionsByRepo: { ...s.sessionsByRepo, [repoRoot]: sessions },
      }));
    },

    loadAgents: async (repoRoot) => {
      const t = get().transport;
      if (!t) {
        return;
      }
      const { agents } = await t.request<{ agents: RemoteAgentStatus[] }>(
        "agents.list",
        { repo_root: repoRoot },
      );
      set((s) => ({ agentsByRepo: { ...s.agentsByRepo, [repoRoot]: agents } }));
    },

    loadTranscript: async (agentId) => {
      const t = get().transport;
      if (!t) {
        return;
      }
      const firstLoad = get().messagesByAgent[agentId] === undefined;
      // No snapshot yet (agent hasn't produced output, or its tab was never
      // opened on the desktop) surfaces as an error — treat as empty so the UI
      // shows an empty state rather than spinning forever. Omitting the cursor
      // fetches the most-recent page (the tail); older history lazy-loads on
      // scroll-up via loadOlderMessages.
      let res: RemoteTranscript = { messages: [], next_after: null };
      const waiting: RemoteTranscriptDelta[] = buffered.get(agentId) ?? [];
      buffered.set(agentId, waiting);
      try {
        res = await t.request<RemoteTranscript>("agents.transcript", {
          agent_id: agentId,
          limit: TRANSCRIPT_PAGE,
        });
      } catch {
        res = { messages: [], next_after: null };
      } finally {
        buffered.delete(agentId);
      }
      if (res.epoch !== undefined && res.revision !== undefined) {
        cursors.set(agentId, { epoch: res.epoch, revision: res.revision });
      }
      set((s) => {
        // Merge the fetched tail into any older pages already loaded — keeping
        // scrolled-in history across live refreshes. Existing messages not in
        // the tail are older, so they stay ahead of it (ascending order).
        // Reuse prior references for unchanged slices so a poll that returns the
        // same data doesn't re-render the transcript (which would reset scroll).
        const tail = res.messages;
        const tailIds = new Set(tail.map((m) => m.id));
        const existingStored = s.messagesByAgent[agentId];
        const existing = existingStored ?? [];
        const prevById = new Map(existing.map((m) => [m.id, m]));
        // Keep the previous object for messages whose content is identical, so
        // memoized rows stay put and only genuinely new content re-renders.
        const keep = (m: RemoteMessage): RemoteMessage => {
          const prev = prevById.get(m.id);

          return prev && jsonEq(prev, m) ? prev : m;
        };
        const mergedNext = [
          ...existing.filter((m) => !tailIds.has(m.id)),
          ...tail.map(keep),
        ];
        const merged =
          existingStored !== undefined && sameRefs(mergedNext, existingStored)
            ? existingStored
            : mergedNext;

        // Drop optimistic bubbles the snapshot now includes (a server user
        // message whose text contains the optimistic text — tolerates the
        // linked-projects preamble the real message may carry).
        const serverUserText = tail
          .filter((m) => m.role === "user")
          .map((m) => m.text_blocks.join("\n"));
        const prevOptimistic = s.optimisticByAgent[agentId] ?? [];
        const stillPendingNext = prevOptimistic.filter((o) => {
          const txt = o.text_blocks.join("\n").trim();

          return txt.length > 0 && !serverUserText.some((st) => st.includes(txt));
        });
        const stillPending = sameRefs(stillPendingNext, prevOptimistic)
          ? prevOptimistic
          : stillPendingNext;

        const nextTasks = res.tasks ?? null;
        const tasks = jsonEq(s.tasksByAgent[agentId], nextTasks)
          ? (s.tasksByAgent[agentId] ?? null)
          : nextTasks;
        const nextTodos = res.todos ?? null;
        const todos = jsonEq(s.todosByAgent[agentId], nextTodos)
          ? (s.todosByAgent[agentId] ?? null)
          : nextTodos;

        return {
          messagesByAgent:
            merged === existingStored
              ? s.messagesByAgent
              : { ...s.messagesByAgent, [agentId]: merged },
          optimisticByAgent:
            stillPending === prevOptimistic
              ? s.optimisticByAgent
              : { ...s.optimisticByAgent, [agentId]: stillPending },
          // Set the older-cursor on first load only; scroll-up moves it back.
          prevBeforeByAgent: firstLoad
            ? { ...s.prevBeforeByAgent, [agentId]: res.prev_before ?? null }
            : s.prevBeforeByAgent,
          tasksByAgent:
            tasks === s.tasksByAgent[agentId]
              ? s.tasksByAgent
              : { ...s.tasksByAgent, [agentId]: tasks },
          todosByAgent:
            todos === s.todosByAgent[agentId]
              ? s.todosByAgent
              : { ...s.todosByAgent, [agentId]: todos },
          followUpsByAgent: withFollowUps(
            s.followUpsByAgent,
            agentId,
            res.follow_ups,
          ),
          pendingToolByAgent: {
            ...s.pendingToolByAgent,
            [agentId]: res.pending_tool_name ?? null,
          },
        };
      });
      // Deltas that raced the page: anything it already had is dropped.
      for (const delta of waiting) {
        applyDelta(delta);
      }
    },

    loadOlderMessages: async (agentId) => {
      const t = get().transport;
      const cursor = get().prevBeforeByAgent[agentId];
      if (!t || cursor == null) {
        return;
      }
      const res = await t.request<RemoteTranscript>("agents.transcript", {
        agent_id: agentId,
        before: cursor,
        limit: TRANSCRIPT_PAGE,
      });
      set((s) => {
        const existing = s.messagesByAgent[agentId] ?? [];
        const existingIds = new Set(existing.map((m) => m.id));
        const older = res.messages.filter((m) => !existingIds.has(m.id));

        return {
          messagesByAgent: {
            ...s.messagesByAgent,
            [agentId]: [...older, ...existing],
          },
          prevBeforeByAgent: {
            ...s.prevBeforeByAgent,
            [agentId]: res.prev_before ?? null,
          },
        };
      });
    },

    loadImage: async (agentId, imageId) => {
      const key = imageKey(agentId, imageId);
      if (get().imageCache[key]) {
        return;
      }
      const t = get().transport;
      if (!t) {
        return;
      }
      try {
        const { data, media_type } = await t.request<RemoteImageData>(
          "agents.image",
          { agent_id: agentId, image_id: imageId },
        );
        const url = `data:${media_type};base64,${data}`;
        set((s) => ({ imageCache: { ...s.imageCache, [key]: url } }));
      } catch {
        // Leave uncached; the transcript re-fetch on the next event retries.
      }
    },

    watchAgent: (agentId, on) => {
      get().transport?.subscribe(agentId, on);
    },

    respond: async (agentId, toolUseId, decision, message) => {
      const t = get().transport;
      if (!t) {
        return;
      }
      await t.request<PermissionRespondResult>("permission.respond", {
        agent_id: agentId,
        tool_use_id: toolUseId,
        decision,
        ...(message ? { message } : {}),
      } satisfies PermissionRespondParams);
      set((s) => {
        const key = `${agentId}:${toolUseId}`;
        const nextPrompts = { ...s.prompts };
        delete nextPrompts[key];

        return { prompts: nextPrompts, answered: { ...s.answered, [key]: true } };
      });
      // Pull the freshly-resolved transcript so the answered prompt clears and
      // any follow-up (e.g. the next question) shows without waiting on events.
      get()
        .loadTranscript(agentId)
        .catch(() => {});
    },

    hasControl: () => get().capabilities.includes("control"),

    loadAgentStatus: async (agentId) => {
      const t = get().transport;
      if (!t) {
        return;
      }
      try {
        const { agent } = await t.request<{ agent: RemoteAgentStatus }>(
          "agents.status",
          { agent_id: agentId },
        );
        set((s) => ({
          statusByAgent: { ...s.statusByAgent, [agentId]: agent },
        }));
      } catch {
        // Agent may be gone; leave any prior status in place.
      }
    },

    setEffortLocal: (agentId, level) => {
      set((s) => ({
        effortByAgent: { ...s.effortByAgent, [agentId]: level },
      }));
    },

    loadCapabilities: async (agentId) => {
      const t = get().transport;
      if (!t) {
        return;
      }
      const { capabilities } = await t.request<{
        capabilities: RemoteAgentCapabilities;
      }>("agents.capabilities", { agent_id: agentId });
      set((s) => ({
        capabilitiesByAgent: {
          ...s.capabilitiesByAgent,
          [agentId]: capabilities,
        },
      }));
    },

    sendMessage: async (agentId, message, images, displayText) => {
      const t = get().transport;
      if (!t) {
        return;
      }
      // Optimistically show the message right away — reconciled/removed once the
      // authoritative snapshot arrives (see loadTranscript).
      const id = `optimistic-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      const imageRefs = (images ?? []).map((img, i) => ({
        image_id: `${id}:img:${i}`,
        media_type: img.media_type,
      }));
      const optimistic: RemoteMessage = {
        id,
        role: "user",
        text_blocks: [displayText ?? message],
        tool_calls: [],
        ...(imageRefs.length > 0 ? { images: imageRefs } : {}),
        timestamp: Date.now(),
      };
      set((s) => ({
        optimisticByAgent: {
          ...s.optimisticByAgent,
          [agentId]: [...(s.optimisticByAgent[agentId] ?? []), optimistic],
        },
        imageCache: {
          ...s.imageCache,
          ...Object.fromEntries(
            (images ?? []).map((img, i) => [
              imageKey(agentId, `${id}:img:${i}`),
              `data:${img.media_type};base64,${img.data}`,
            ]),
          ),
        },
      }));

      const { queued } = await t.request<{ queued?: boolean }>("agents.send", {
        agent_id: agentId,
        message,
        ...(displayText && displayText !== message
          ? { display_text: displayText }
          : {}),
        ...(images && images.length > 0 ? { images } : {}),
      });
      // The computer may have found the agent mid-turn and parked this on the
      // queue instead. It belongs in the queue strip, not the transcript, so
      // retire the optimistic bubble rather than waiting for it to reconcile.
      if (queued) {
        set((s) => ({
          optimisticByAgent: {
            ...s.optimisticByAgent,
            [agentId]: (s.optimisticByAgent[agentId] ?? []).filter(
              (m) => m.id !== id,
            ),
          },
        }));
        get()
          .loadQueue(agentId)
          .catch(() => {});
        get()
          .loadAgentStatus(agentId)
          .catch(() => {});

        return;
      }
      // Nudge a transcript refresh so the real message reconciles promptly.
      get()
        .loadTranscript(agentId)
        .catch(() => {});
    },

    queueMessage: async (agentId, message, images, displayText) => {
      // The computer owns the queue, so it outlives this tab and the desktop
      // is what eventually drains it.
      await get().transport?.request("agents.queue_add", {
        agent_id: agentId,
        message,
        ...(displayText && displayText !== message
          ? { display_text: displayText }
          : {}),
        ...(images?.length ? { images } : {}),
      });
    },

    removeQueued: async (agentId, id) => {
      await get().transport?.request("agents.queue_remove", {
        agent_id: agentId,
        id,
      });
    },

    updateQueued: async (agentId, id, message) => {
      // The queue lives on the computer, so the edit lands there and comes back
      // to every client on `agent.queue` — no local mirror to keep in step.
      await get().transport?.request("agents.queue_update", {
        agent_id: agentId,
        id,
        message,
      });
    },

    sendQueuedNow: async (agentId, id) => {
      await get().transport?.request("agents.queue_send_now", {
        agent_id: agentId,
        id,
      });
    },

    loadQueue: async (agentId) => {
      const t = get().transport;
      if (!t) {
        return;
      }
      const { messages } = await t.request<{ messages: RemoteQueuedMessage[] }>(
        "agents.queue_list",
        { agent_id: agentId },
      );
      set((s) => ({
        queuedByAgent: { ...s.queuedByAgent, [agentId]: messages },
      }));
    },

    interrupt: async (agentId) => {
      await get()
        .transport?.request("agents.interrupt", { agent_id: agentId });
    },

    dismissLimitResume: async (agentId) => {
      await get().transport?.request("agents.dismiss_limit_resume", {
        agent_id: agentId,
      });
    },

    setModel: async (agentId, model) => {
      await get()
        .transport?.request("agents.set_model", { agent_id: agentId, model });
    },

    setPermissionMode: async (agentId, mode) => {
      await get().transport?.request("agents.set_permission_mode", {
        agent_id: agentId,
        mode,
      });
    },

    setEffort: async (agentId, level) => {
      get().setEffortLocal(agentId, level);
      await get()
        .transport?.request("agents.set_effort", { agent_id: agentId, level });
    },

    spawnAgent: async (sessionId, opts) => {
      const t = get().transport;
      if (!t) {
        throw new Error("not connected");
      }
      const { agent } = await t.request<{ agent: RemoteAgentStatus }>(
        "agents.spawn",
        {
          session_id: sessionId,
          ...(opts?.model ? { model: opts.model } : {}),
          ...(opts?.permissionMode
            ? { permission_mode: opts.permissionMode }
            : {}),
        },
      );

      return agent;
    },

    createSession: async (params) => {
      const t = get().transport;
      if (!t) {
        throw new Error("not connected");
      }
      const { session } = await t.request<{ session: RemoteSession }>(
        "sessions.create",
        {
          repo_root: params.repoRoot,
          branch: params.branch,
          description: params.description,
          ...(params.useExistingBranch
            ? { use_existing_branch: true }
            : {}),
          ...(params.baseBranch ? { base_branch: params.baseBranch } : {}),
        },
      );

      return session;
    },

    stopAgentProcess: async (agentId) => {
      // Status flips to "stopped" via the forwarded agent.status broadcast.
      await get().transport?.request("agents.stop", { agent_id: agentId });
    },

    deleteSession: async (id, repoRoot, deleteBranch) => {
      const t = get().transport;
      if (!t) {
        return;
      }
      await t.request("sessions.delete", {
        id,
        ...(deleteBranch ? { delete_branch: true } : {}),
      });
      await Promise.all([
        get().loadSessions(repoRoot).catch(() => {}),
        get().loadAgents(repoRoot).catch(() => {}),
      ]);
    },

    renameSession: async (id, repoRoot, name) => {
      const t = get().transport;
      if (!t) {
        return;
      }
      await t.request("sessions.rename", { id, display_name: name });
      await get().loadSessions(repoRoot).catch(() => {});
    },

    renameSessionBranch: async (id, repoRoot, branch) => {
      const t = get().transport;
      if (!t) {
        return;
      }
      await t.request("sessions.rename_branch", { id, branch });
      await get().loadSessions(repoRoot).catch(() => {});
    },

    loadGitStatus: async (sessionId) => {
      const t = get().transport;
      if (!t) {
        return;
      }
      try {
        const { status } = await t.request<{ status: RemoteGitStatus }>(
          "sessions.git_status",
          { session_id: sessionId },
        );
        set((s) => ({
          gitStatusBySession: { ...s.gitStatusBySession, [sessionId]: status },
        }));
      } catch {
        // Session may be initializing / gone — leave any prior status.
      }
    },

    loadDiff: async (sessionId, mode) => {
      const t = get().transport;
      if (!t) {
        return { diff: "", base_branch: null };
      }

      return t.request<{ diff: string; base_branch: string | null }>(
        "sessions.diff",
        { session_id: sessionId, mode },
      );
    },

    listFiles: async (sessionId) => {
      const t = get().transport;
      if (!t) {
        return [];
      }
      const { files } = await t.request<{ files: string[] }>("sessions.files", {
        session_id: sessionId,
      });

      return files;
    },

    resolveMentionPath: async (sessionId, query) => {
      const t = get().transport;
      if (!t) {
        return { entries: [], resolved_path: "" };
      }

      return t.request<RemoteMentionPathResult>(
        "sessions.resolve_mention_path",
        { session_id: sessionId, query },
      );
    },

    refreshDevices: async () => {
      const t = get().transport;
      if (!t) {
        return;
      }
      try {
        const { devices } = await t.request<{ devices: RemoteDevice[] }>(
          "devices.list",
          {},
        );
        set({ devices });
      } catch {
        // Toolchain may be missing; leave any prior list in place.
      }
    },

    watchDevice: async (deviceId, platform) => {
      const t = get().transport;
      if (!t) {
        throw new Error("not connected");
      }
      const { stream_id } = await t.request<{ stream_id: number }>(
        "devices.watch",
        { device_id: deviceId, platform },
      );

      return stream_id;
    },

    unwatchDevice: async (deviceId) => {
      await get()
        .transport?.request("devices.unwatch", { device_id: deviceId })
        .catch(() => {});
    },

    loadDeviceState: async (deviceId, platform) => {
      const t = get().transport;
      if (!t) {
        return;
      }
      try {
        const { state } = await t.request<{ state: RemoteDeviceState | null }>(
          "devices.state",
          { device_id: deviceId, platform },
        );
        set((s) => ({
          deviceStateById: { ...s.deviceStateById, [deviceId]: state },
        }));
      } catch {
        // Android reports no pose, and an older host may not answer at all —
        // either way, portrait is the right assumption.
      }
    },

    registerMediaSink: (streamId, sink) => media.register(streamId, sink),

    deviceTouch: (deviceId, platform, x, y, eventType) => {
      // Unawaited: touch-move latency compounds if we round-trip each event.
      get()
        .transport?.request("devices.touch", {
          device_id: deviceId,
          platform,
          x,
          y,
          event_type: eventType,
        })
        .catch(adoptClaimDenial);
    },

    deviceButton: async (deviceId, platform, button) => {
      await get()
        .transport?.request("devices.button", {
          device_id: deviceId,
          platform,
          button,
        })
        .catch(adoptClaimDenial);
    },

    deviceKeyboard: (deviceId, platform, keyCode, modifiers, isDown) => {
      get()
        .transport?.request("devices.keyboard", {
          device_id: deviceId,
          platform,
          key_code: keyCode,
          modifiers,
          is_down: isDown,
        })
        .catch(adoptClaimDenial);
    },

    loadClaim: async (deviceId) => {
      const t = get().transport;
      if (!t) {
        return;
      }
      try {
        const { holder, connection_id } = await t.request<{
          holder: RemoteDeviceClaim | null;
          connection_id: string;
        }>("devices.claim_status", { device_id: deviceId });
        set((s) => ({
          claimByDevice: { ...s.claimByDevice, [deviceId]: holder },
          // Our own id, so "who holds it" can be answered however the claim was
          // taken — including implicitly, by a tap.
          claimConnectionId: connection_id,
        }));
      } catch {
        // Monitor-only clients can't ask; they can't drive either, so no overlay.
      }
    },

    setDeviceOrientation: async (deviceId, platform, orientation) => {
      await applyDeviceStateWrite("devices.set_orientation", deviceId, {
        device_id: deviceId,
        platform,
        orientation,
      });
    },

    setDeviceFold: async (deviceId, platform, pose) => {
      await applyDeviceStateWrite("devices.set_fold", deviceId, {
        device_id: deviceId,
        platform,
        pose,
      });
    },

    claimDevice: async (deviceId, force) => {
      const t = get().transport;
      if (!t) {
        return;
      }
      try {
        const res = await t.request<{
          granted: boolean;
          holder: RemoteDeviceClaim | null;
        }>("devices.claim", { device_id: deviceId, force: force ?? false });
        set((s) => ({
          claimByDevice: { ...s.claimByDevice, [deviceId]: res.holder },
          claimConnectionId: res.granted
            ? (res.holder?.connection_id ?? s.claimConnectionId)
            : s.claimConnectionId,
        }));
      } catch (err) {
        adoptClaimDenial(err);
      }
    },

    releaseDevice: (deviceId) => {
      get()
        .transport?.request("devices.release", { device_id: deviceId })
        .catch(() => {});
    },
  };
});
