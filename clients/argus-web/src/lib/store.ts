/**
 * App store: owns the identity, the live Transport, and the monitor-scoped data
 * it fetches. Agents are fetched per-project (across all sessions, incl. the
 * project root). Transcripts are structured messages, refreshed on live events.
 */

import { create } from "zustand";
import {
  clearIdentity,
  defaultDeviceName,
  loadIdentity,
  saveIdentity,
} from "./keystore";
import type { DeviceIdentity } from "./keystore";
import type {
  EventEnvelope,
  RemoteAgentCapabilities,
  RemoteAgentStatus,
  RemoteGitStatus,
  RemoteImageAttachment,
  RemoteImageData,
  RemoteMentionPathResult,
  RemoteMessage,
  RemotePermissionMode,
  RemotePermissionRequest,
  RemoteProject,
  RemoteSession,
  RemoteTask,
  RemoteTodo,
  RemoteTranscript,
} from "./protocol";
import { Transport, type ConnectionState } from "./transport";

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
  tasksByAgent: Record<string, RemoteTask[] | null>;
  todosByAgent: Record<string, RemoteTodo[] | null>;
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

  init: () => void;
  pairComplete: (identity: DeviceIdentity) => void;
  setDeviceName: (name: string) => Promise<void>;
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
}

export function imageKey(agentId: string, imageId: string): string {
  return `${agentId}:${imageId}`;
}

/** Messages fetched per transcript page (tail on open, older on scroll-up). */
const TRANSCRIPT_PAGE = 80;

export const useAppStore = create<AppState>((set, get) => {
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
    } else if (ev.event === "agent.capabilities" && ev.agent_id) {
      // Pickers become available once the CLI handshake completes.
      set((s) => ({
        capabilitiesByAgent: {
          ...s.capabilitiesByAgent,
          [ev.agent_id as string]: ev.payload as RemoteAgentCapabilities,
        },
      }));
    } else if (ev.event === "agent.event" && ev.agent_id) {
      // Re-fetch the structured transcript rather than rendering raw events.
      scheduleTranscript(ev.agent_id);
    }
  }

  function connect(identity: DeviceIdentity): Transport {
    const transport = new Transport(identity, {
      onState: (connection) => {
        set({ connection });
        // Push our display name once the secure channel is up, so the desktop's
        // paired-device list shows a friendly label instead of "New device".
        if (connection === "ready") {
          const name = get().deviceName.trim();
          if (name) {
            transport.request("device.rename", { name }).catch(() => {});
          }
          // Refresh grants from the desktop — reflects any control toggle made
          // while we were offline (the desktop drops the socket on change).
          transport
            .request<{ capabilities: string[] }>("device.capabilities", {})
            .then((r) => set({ capabilities: r.capabilities }))
            .catch(() => {});
        }
      },
      onEvent,
    });
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
      get().transport?.disconnect();
      clearIdentity();
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
      // No snapshot yet (agent hasn't produced output, or its tab was never
      // opened on the desktop) surfaces as an error — treat as empty so the UI
      // shows an empty state rather than spinning forever. Omitting the cursor
      // fetches the most-recent page (the tail); older history lazy-loads on
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
        // Merge the fetched tail into any older pages already loaded — keeping
        // scrolled-in history across live refreshes. Existing messages not in
        // the tail are older, so they stay ahead of it (ascending order).
        const tail = res.messages;
        const tailIds = new Set(tail.map((m) => m.id));
        const existing = s.messagesByAgent[agentId] ?? [];
        const merged = [...existing.filter((m) => !tailIds.has(m.id)), ...tail];

        // Drop optimistic bubbles the snapshot now includes (a server user
        // message whose text contains the optimistic text — tolerates the
        // linked-projects preamble the real message may carry).
        const serverUserText = tail
          .filter((m) => m.role === "user")
          .map((m) => m.text_blocks.join("\n"));
        const stillPending = (s.optimisticByAgent[agentId] ?? []).filter((o) => {
          const txt = o.text_blocks.join("\n").trim();

          return txt.length > 0 && !serverUserText.some((st) => st.includes(txt));
        });

        return {
          messagesByAgent: { ...s.messagesByAgent, [agentId]: merged },
          optimisticByAgent: {
            ...s.optimisticByAgent,
            [agentId]: stillPending,
          },
          // Set the older-cursor on first load only; scroll-up moves it back.
          prevBeforeByAgent: firstLoad
            ? { ...s.prevBeforeByAgent, [agentId]: res.prev_before ?? null }
            : s.prevBeforeByAgent,
          tasksByAgent: { ...s.tasksByAgent, [agentId]: res.tasks ?? null },
          todosByAgent: { ...s.todosByAgent, [agentId]: res.todos ?? null },
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

      await t.request("agents.send", {
        agent_id: agentId,
        message,
        ...(images && images.length > 0 ? { images } : {}),
      });
      // Nudge a transcript refresh so the real message reconciles promptly.
      get()
        .loadTranscript(agentId)
        .catch(() => {});
    },

    interrupt: async (agentId) => {
      await get()
        .transport?.request("agents.interrupt", { agent_id: agentId });
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
  };
});
