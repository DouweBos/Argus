/**
 * App store: owns the identity, the live Transport, and the data it fetches.
 * Screens read slices and call actions; the Transport pushes events back in
 * through `onEvent`. Mirrors the web client's store, with SecureStore-backed
 * (async) identity persistence.
 */

import { create } from "zustand";
import {
  clearIdentity,
  defaultDeviceName,
  loadIdentity,
  saveIdentity,
} from "../lib/keystore";
import type { DeviceIdentity } from "../lib/keystore";
import { parseMediaMessage, type MediaMessage } from "../lib/media";
import { showRemoteNotification } from "../lib/notify";
import {
  clearPendingDecision,
  queuePendingDecision,
  readPendingDecisions,
  type PendingDecision,
} from "../lib/pendingDecisions";
import {
  forgetRegisteredToken,
  getPushRegistration,
  pushPreference,
  rememberRegisteredToken,
  setPushPreference,
} from "../lib/push";
import type {
  EventEnvelope,
  RemoteAgentCapabilities,
  RemoteAgentStatus,
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
} from "../lib/protocol";
import { Transport, type ConnectionState } from "../lib/transport";

/** Cheap deep-equality via JSON — transcript pages are small and polled rarely. */
const jsonEq = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** True when two arrays hold the same element references in order. */
const sameRefs = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** A message typed while the agent was busy, awaiting flush on idle. */
export interface QueuedMessage {
  id: string;
  message: string;
  displayText: string;
  images?: RemoteImageAttachment[];
}

export function imageKey(agentId: string, imageId: string): string {
  return `${agentId}:${imageId}`;
}

/**
 * Background-push status, purely for what the settings screen tells the user.
 * "unconfigured" = we registered, but the desktop has no APNs/FCM credentials.
 */
export type PushState =
  | "off"
  | "registered"
  | "unavailable"
  | "unconfigured";

/** Messages fetched per transcript page (tail on open, older on scroll-up). */
const TRANSCRIPT_PAGE = 80;

interface AppState {
  identity: DeviceIdentity | null;
  /** False until the stored identity has been read back from the keychain. */
  loaded: boolean;
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
  queuedByAgent: Record<string, QueuedMessage[]>;
  tasksByAgent: Record<string, RemoteTask[] | null>;
  todosByAgent: Record<string, RemoteTodo[] | null>;
  /** Name of the tool currently executing per agent (drives the activity row). */
  pendingToolByAgent: Record<string, string | null>;
  /** Cursor to fetch the next older page per agent (null = start reached). */
  prevBeforeByAgent: Record<string, number | null>;
  gitStatusBySession: Record<string, RemoteGitStatus>;
  prompts: Record<string, RemotePermissionRequest>;
  /** Prompts this client just answered — clears the inline form instantly. */
  answered: Record<string, true>;
  /** Resolved image bytes keyed by `${agentId}:${imageId}` → data URI. */
  imageCache: Record<string, string>;
  /** This device's capability grants (seeded from pairing, refreshed live). */
  capabilities: string[];
  capabilitiesByAgent: Record<string, RemoteAgentCapabilities>;
  statusByAgent: Record<string, RemoteAgentStatus>;
  /** Locally-chosen effort per agent (not surfaced by the monitor snapshot). */
  effortByAgent: Record<string, string | null>;
  devices: RemoteDevice[];
  /** Background push: whether the user wants it and whether it is live. */
  pushEnabled: boolean;
  /** "off" | "registered" | "unavailable" | "unconfigured" — for settings copy. */
  pushState: PushState;

  /** Answer a prompt from a notification button, even while offline. */
  decidePrompt: (
    agentId: string,
    toolUseId: string,
    decision: "allow" | "deny",
  ) => Promise<void>;
  init: () => Promise<void>;
  pairComplete: (identity: DeviceIdentity) => Promise<void>;
  setDeviceName: (name: string) => Promise<void>;
  setPushEnabled: (enabled: boolean) => Promise<void>;
  unpair: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  loadRecentAgents: () => Promise<void>;
  loadSessions: (repoRoot: string) => Promise<void>;
  loadAgents: (repoRoot: string) => Promise<void>;
  loadTranscript: (agentId: string) => Promise<void>;
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
    displayText?: string,
  ) => Promise<void>;
  queueMessage: (
    agentId: string,
    message: string,
    images: RemoteImageAttachment[] | undefined,
    displayText: string,
  ) => void;
  removeQueued: (agentId: string, id: string) => void;
  flushQueue: (agentId: string) => void;
  interrupt: (agentId: string) => Promise<void>;
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
  watchDevice: (deviceId: string, platform: RemotePlatform) => Promise<number>;
  unwatchDevice: (deviceId: string) => Promise<void>;
  registerMediaSink: (
    streamId: number,
    sink: (msg: MediaMessage) => void,
  ) => () => void;
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
}

export const useAppStore = create<AppState>((set, get) => {
  // Binary media routing stays out of reactive state — hot path, no re-render.
  // Frames arriving before a view registers (the config is sent just before the
  // watch response) are briefly buffered so the decoder can still configure.
  const mediaSinks = new Map<number, (msg: MediaMessage) => void>();
  const mediaBuffer = new Map<number, MediaMessage[]>();
  const MEDIA_BUFFER_CAP = 120;

  function onMedia(bytes: Uint8Array): void {
    const msg = parseMediaMessage(bytes);
    if (!msg) {
      return;
    }
    const sink = mediaSinks.get(msg.streamId);
    if (sink) {
      sink(msg);

      return;
    }
    const buf = mediaBuffer.get(msg.streamId) ?? [];
    buf.push(msg);
    if (buf.length > MEDIA_BUFFER_CAP) {
      buf.shift();
    }
    mediaBuffer.set(msg.streamId, buf);
  }

  // Debounce live transcript refreshes so a burst of events → one refetch.
  const refetchTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const scheduleTranscript = (agentId: string) => {
    const existing = refetchTimers.get(agentId);
    if (existing) {
      clearTimeout(existing);
    }
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
      scheduleTranscript(p.agent_id);
    } else if (ev.event === "permission.cancel") {
      const p = ev.payload as { agent_id: string; tool_use_id: string };
      set((s) => {
        const next = { ...s.prompts };
        delete next[`${p.agent_id}:${p.tool_use_id}`];

        return { prompts: next };
      });
      scheduleTranscript(p.agent_id);
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
      // Flush the next queued message once the agent goes idle.
      if (a.status === "idle") {
        get().flushQueue(a.agent_id);
      }
    } else if (ev.event === "agent.capabilities" && ev.agent_id) {
      set((s) => ({
        capabilitiesByAgent: {
          ...s.capabilitiesByAgent,
          [ev.agent_id as string]: ev.payload as RemoteAgentCapabilities,
        },
      }));
    } else if (ev.event === "agent.event" && ev.agent_id) {
      // Re-fetch the structured transcript rather than rendering raw events.
      scheduleTranscript(ev.agent_id);
    } else if (ev.event === "notification") {
      showRemoteNotification(ev.payload as RemoteNotification);
    }
  }

  /**
   * Hand the desktop this install's native push token so it can wake us while
   * the app is backgrounded. Skipped when the user opted out or the OS won't
   * mint a token (permission denied, simulator, no entitlement).
   */
  async function registerPush(transport: Transport): Promise<PushState> {
    if (!(await pushPreference())) {
      return "off";
    }
    const registration = await getPushRegistration();
    if (!registration) {
      return "unavailable";
    }
    try {
      const res = await transport.request<{ configured: boolean }>(
        "device.register_push",
        registration,
      );
      await rememberRegisteredToken(registration.token);

      return res.configured ? "registered" : "unconfigured";
    } catch {
      return "unavailable";
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
          await transport.request("permission.respond", {
            agent_id: decision.agentId,
            tool_use_id: decision.toolUseId,
            decision: decision.decision,
          });

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
    const pending = await readPendingDecisions(Date.now());
    for (const decision of pending) {
      const sent = await flushDecision(transport, decision);
      // Drop it either way: a prompt that never came back is gone for good.
      await clearPendingDecision(decision);
      if (sent) {
        scheduleTranscript(decision.agentId);
      }
    }
  }

  function connect(identity: DeviceIdentity): Transport {
    const transport = new Transport(identity, {
      onState: (connection) => {
        set({ connection });
        if (connection === "ready") {
          // Push our display name so the desktop's paired-device list shows a
          // friendly label, and re-read grants (they may have changed while we
          // were offline).
          const name = get().deviceName.trim();
          if (name) {
            transport.request("device.rename", { name }).catch(() => {});
          }
          transport
            .request<{ capabilities: string[] }>("device.capabilities", {})
            .then((r) => set({ capabilities: r.capabilities }))
            .catch(() => {});
          registerPush(transport)
            .then((pushState) => set({ pushState }))
            .catch(() => {});
          flushPendingDecisions(transport).catch(() => {});
        } else {
          set({ pushState: "off" });
        }
      },
      onEvent,
      onMedia,
    });
    transport.connect();

    return transport;
  }

  return {
    identity: null,
    loaded: false,
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
    pendingToolByAgent: {},
    prevBeforeByAgent: {},
    gitStatusBySession: {},
    prompts: {},
    answered: {},
    imageCache: {},
    capabilities: [],
    pushEnabled: true,
    pushState: "off",
    capabilitiesByAgent: {},
    statusByAgent: {},
    effortByAgent: {},
    devices: [],

    decidePrompt: async (agentId, toolUseId, decision) => {
      const pending: PendingDecision = {
        agentId,
        toolUseId,
        decision,
        at: Date.now(),
      };
      await queuePendingDecision(pending);
      const transport = get().transport;
      if (get().connection === "ready" && transport) {
        await flushPendingDecisions(transport).catch(() => {});
      }
    },

    init: async () => {
      set({ pushEnabled: await pushPreference() });
      const identity = await loadIdentity();
      if (!identity) {
        set({ loaded: true });

        return;
      }
      set({
        identity,
        loaded: true,
        deviceName: identity.name || defaultDeviceName(),
        capabilities: identity.capabilities,
        transport: connect(identity),
      });
    },

    pairComplete: async (identity) => {
      await saveIdentity(identity);
      get().transport?.disconnect();
      set({
        identity,
        loaded: true,
        deviceName: identity.name || defaultDeviceName(),
        capabilities: identity.capabilities,
        transport: connect(identity),
      });
    },

    setPushEnabled: async (enabled) => {
      set({ pushEnabled: enabled });
      await setPushPreference(enabled);
      const transport = get().transport;
      if (get().connection !== "ready" || !transport) {
        set({ pushState: "off" });

        return;
      }
      if (enabled) {
        set({ pushState: await registerPush(transport) });

        return;
      }
      await transport.request("device.unregister_push", {}).catch(() => {});
      await forgetRegisteredToken();
      set({ pushState: "off" });
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
        await saveIdentity(next);
        set({ identity: next });
      }
      if (get().connection === "ready") {
        await get()
          .transport?.request("device.rename", { name })
          .catch(() => {});
      }
    },

    unpair: async () => {
      get().transport?.disconnect();
      await clearIdentity();
      set({
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
      });
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
      // No snapshot yet (agent hasn't produced output) surfaces as an error —
      // treat as empty so the UI shows an empty state rather than spinning.
      // Omitting the cursor fetches the tail; older history lazy-loads on
      // scroll-up via loadOlderMessages.
      let res: RemoteTranscript = { messages: [], next_after: null };
      try {
        res = await t.request<RemoteTranscript>("agents.transcript", {
          agent_id: agentId,
          limit: TRANSCRIPT_PAGE,
        });
      } catch {
        res = { messages: [], next_after: null };
      }
      set((s) => {
        // Merge the fetched tail into any older pages already loaded, reusing
        // prior references for unchanged messages so a poll that returns the
        // same data doesn't re-render (which would reset scroll).
        const tail = res.messages;
        const tailIds = new Set(tail.map((m) => m.id));
        const existingStored = s.messagesByAgent[agentId];
        const existing = existingStored ?? [];
        const prevById = new Map(existing.map((m) => [m.id, m]));
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

        // Drop optimistic bubbles the snapshot now includes (tolerating the
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
          pendingToolByAgent: {
            ...s.pendingToolByAgent,
            [agentId]: res.pending_tool_name ?? null,
          },
        };
      });
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
        const uri = `data:${media_type};base64,${data}`;
        set((s) => ({ imageCache: { ...s.imageCache, [key]: uri } }));
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
      await t.request("permission.respond", {
        agent_id: agentId,
        tool_use_id: toolUseId,
        decision,
        ...(message ? { message } : {}),
      });
      set((s) => {
        const key = `${agentId}:${toolUseId}`;
        const nextPrompts = { ...s.prompts };
        delete nextPrompts[key];

        return { prompts: nextPrompts, answered: { ...s.answered, [key]: true } };
      });
      // Pull the resolved transcript so the answered prompt clears and any
      // follow-up shows without waiting on events.
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
      set((s) => ({ effortByAgent: { ...s.effortByAgent, [agentId]: level } }));
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
      // Optimistically show the message right away — reconciled/removed once
      // the authoritative snapshot arrives (see loadTranscript).
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

      await t.request("agents.send", {
        agent_id: agentId,
        message,
        ...(images && images.length > 0 ? { images } : {}),
      });
      get()
        .loadTranscript(agentId)
        .catch(() => {});
    },

    queueMessage: (agentId, message, images, displayText) => {
      const id = `queued-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      set((s) => ({
        queuedByAgent: {
          ...s.queuedByAgent,
          [agentId]: [
            ...(s.queuedByAgent[agentId] ?? []),
            { id, message, images, displayText },
          ],
        },
      }));
    },

    removeQueued: (agentId, id) => {
      set((s) => ({
        queuedByAgent: {
          ...s.queuedByAgent,
          [agentId]: (s.queuedByAgent[agentId] ?? []).filter((q) => q.id !== id),
        },
      }));
    },

    flushQueue: (agentId) => {
      const queue = get().queuedByAgent[agentId] ?? [];
      const next = queue[0];
      if (!next) {
        return;
      }
      // Drop it from the queue first so the agent.status → idle that this send
      // triggers can't double-send the same message.
      set((s) => ({
        queuedByAgent: {
          ...s.queuedByAgent,
          [agentId]: (s.queuedByAgent[agentId] ?? []).filter(
            (q) => q.id !== next.id,
          ),
        },
      }));
      get()
        .sendMessage(agentId, next.message, next.images, next.displayText)
        .catch(() => {});
    },

    interrupt: async (agentId) => {
      await get().transport?.request("agents.interrupt", { agent_id: agentId });
    },

    setModel: async (agentId, model) => {
      await get().transport?.request("agents.set_model", {
        agent_id: agentId,
        model,
      });
    },

    setPermissionMode: async (agentId, mode) => {
      await get().transport?.request("agents.set_permission_mode", {
        agent_id: agentId,
        mode,
      });
    },

    setEffort: async (agentId, level) => {
      get().setEffortLocal(agentId, level);
      await get().transport?.request("agents.set_effort", {
        agent_id: agentId,
        level,
      });
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
          ...(params.useExistingBranch ? { use_existing_branch: true } : {}),
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
        get()
          .loadSessions(repoRoot)
          .catch(() => {}),
        get()
          .loadAgents(repoRoot)
          .catch(() => {}),
      ]);
    },

    renameSession: async (id, repoRoot, name) => {
      const t = get().transport;
      if (!t) {
        return;
      }
      await t.request("sessions.rename", { id, display_name: name });
      await get()
        .loadSessions(repoRoot)
        .catch(() => {});
    },

    renameSessionBranch: async (id, repoRoot, branch) => {
      const t = get().transport;
      if (!t) {
        return;
      }
      await t.request("sessions.rename_branch", { id, branch });
      await get()
        .loadSessions(repoRoot)
        .catch(() => {});
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

    registerMediaSink: (streamId, sink) => {
      mediaSinks.set(streamId, sink);
      const buffered = mediaBuffer.get(streamId);
      if (buffered) {
        mediaBuffer.delete(streamId);
        for (const msg of buffered) {
          sink(msg);
        }
      }

      return () => {
        mediaSinks.delete(streamId);
        mediaBuffer.delete(streamId);
      };
    },

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
        .catch(() => {});
    },

    deviceButton: async (deviceId, platform, button) => {
      await get()
        .transport?.request("devices.button", {
          device_id: deviceId,
          platform,
          button,
        })
        .catch(() => {});
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
        .catch(() => {});
    },
  };
});
