/**
 * A fixture scenario as the Mac app sees it. The scenarios are written for the
 * renderer's IPC — command replies plus raw `agent:*` broadcasts — and the Mac
 * app speaks the gateway's typed dialect on top of those, so this derives the
 * typed answers (`sessions.list`, `agents.transcript`, …) from the same data.
 * Transcripts go through the host's own reducer, so a scenario's stream-json
 * reads exactly as a live agent's would.
 */

import type { FixtureEvent, FixtureScenario } from "./fixture/types";
import type { FixtureHost } from "./fixtureHost";
import type { LlmStreamEvent } from "@argus/host/services/agent/conversation/types";
import path, { basename } from "node:path";
import type { z } from "zod";
import { addHostEventSink } from "@argus/host/bus";
import {
  flushLive,
  liveConversation,
  liveCursor,
  liveMeta,
  readConversation,
  resetLive,
  seedLive,
  setLive,
} from "@argus/host/services/agent/conversation/live";
import {
  emptyConversation,
  reduceEvent,
  withUserMessage,
} from "@argus/host/services/agent/conversation/reducer";
import {
  toRemoteTranscriptDelta,
  transcriptPage,
  type RawConversation,
} from "@argus/host/services/remote/transcript";
import {
  COMMANDS,
  MethodResult,
  type AgentTranscriptDelta,
  type RemoteAgentCapabilities,
  type RemoteAgentStatus,
} from "@argus/remote-protocol";
import { automationReply } from "./automations";
import { cannedReply } from "./fixture/reply";
import { materializeWorktree } from "./repos";
import { conform } from "./synth";

interface FixtureAgent {
  agent_id: string;
  created_at: number;
  model: string | null;
  parent_agent_id: string | null;
  permission_mode?: string;
  session_id: string;
  status: RemoteAgentStatus["status"];
}

interface FixtureSession {
  branch: string;
  display_name?: string;
  id: string;
  kind: string;
  repo_root: string;
  status: string;
  [key: string]: unknown;
}

interface FixtureProject {
  description: string;
  path: string;
}

export class MacFixture {
  /** Answers that failed their own schema — the Mac app would drop them silently. */
  readonly mismatches: string[] = [];
  private readonly agents = new Map<string, FixtureAgent>();
  private readonly capabilities = new Map<string, RemoteAgentCapabilities>();
  private host: FixtureHost | null = null;
  /** Session id → the real repository standing in for its worktree. */
  private readonly worktrees = new Map<string, string>();
  private readonly untap: () => void;

  constructor(private readonly scenario: FixtureScenario) {
    resetLive();
    // The host's live transcripts announce each change on the bus; forward
    // them the way the gateway does, to whoever follows the agent.
    this.untap = addHostEventSink((channel, args) => {
      const agentId = /^agent:transcript:(.+)$/.exec(channel)?.[1];
      const meta = agentId ? liveMeta(agentId) : null;
      if (!agentId || !meta || !this.host?.subscriptions.has(agentId)) {
        return;
      }
      this.host.push(
        "agent.transcript",
        agentId,
        toRemoteTranscriptDelta(args[0] as AgentTranscriptDelta, meta),
      );
    });
  }

  /** Back every worktree session with a real repository under `dir`. */
  async materialize(dir: string): Promise<void> {
    for (const session of this.sessions()) {
      if (session.kind !== "worktree") {
        continue;
      }
      const root = path.join(dir, session.branch);
      await materializeWorktree(root, session.branch);
      this.worktrees.set(session.id, root);
    }
  }

  attach(host: FixtureHost): void {
    this.host = host;
  }

  dispose(): void {
    this.untap();
    resetLive();
  }

  /** Apply one scenario event: state first, then what the app would hear. */
  apply(event: FixtureEvent): void {
    const { channel, payload } = event;
    const agentEvent = /^agent:event:(.+)$/.exec(channel)?.[1];
    if (agentEvent) {
      const conversation = liveConversation(agentEvent) ?? emptyConversation();
      const parsed = (
        typeof payload === "string" ? JSON.parse(payload) : payload
      ) as LlmStreamEvent;
      setLive(agentEvent, reduceEvent(conversation, parsed));
      flushLive(agentEvent);
      // A finished turn leaves the agent idle; the host says so as a status.
      const agent = this.agents.get(agentEvent);
      if (parsed.type === "result" && agent) {
        agent.status = "idle";
        if (this.host?.subscriptions.has(agentEvent)) {
          this.host.push("agent.status", agentEvent, this.status(agent));
        }
      }

      return;
    }
    // A guest's line reaches the agent as a user turn with its author.
    const guestTo = /^agent:remote-message:(.+)$/.exec(channel)?.[1];
    if (guestTo) {
      const { author, message } = payload as {
        author?: string;
        message: string;
      };
      const conversation = liveConversation(guestTo) ?? emptyConversation();
      setLive(guestTo, withUserMessage(conversation, message, { author }));
      flushLive(guestTo);

      return;
    }
    const capsFor = /^agent:capabilities:(.+)$/.exec(channel)?.[1];
    if (capsFor) {
      const caps = toCapabilities(payload);
      this.capabilities.set(capsFor, caps);
      if (this.host?.subscriptions.has(capsFor)) {
        this.host.push("agent.capabilities", capsFor, caps);
      }

      return;
    }
    if (channel === "agent:started") {
      const agent = payload as FixtureAgent;
      this.agents.set(agent.agent_id, { ...agent });
      seedLive(agent.agent_id, emptyConversation());
    }
    this.host?.ipc(channel, payload);
  }

  /** The reply to one request; `undefined` lets the host fall back to the schema default. */
  resolve = (method: string, params: Record<string, unknown>): unknown => {
    const value = this.answer(method, params);
    const schema = resultSchema(method);
    const conformed =
      value !== undefined && schema ? conform(schema, value) : value;
    if (conformed !== undefined) {
      this.check(method, conformed);
    }

    return conformed;
  };

  private answer(method: string, params: Record<string, unknown>): unknown {
    switch (method) {
      case "projects.list":
        return {
          projects: this.projects().map((p) => ({
            repo_root: p.path,
            name: basename(p.path),
          })),
        };
      case "sessions.list":
        return {
          sessions: this.sessions()
            .filter((s) => s.repo_root === params.repo_root)
            .map(toRemoteSession),
        };
      case "agents.list":
        return {
          agents: [...this.agents.values()]
            .filter((a) => this.inScope(a, params))
            .map((a) => this.status(a)),
        };
      case "agents.status": {
        const agent = this.agents.get(String(params.agent_id));

        return agent ? { agent: this.status(agent) } : undefined;
      }
      case "agents.transcript":
        return this.transcript(params);
      case "agents.capabilities":
        return {
          capabilities:
            this.capabilities.get(String(params.agent_id)) ?? noCapabilities(),
        };
      case "sessions.start_options":
        return {
          capabilities: [...this.capabilities.values()][0] ?? noCapabilities(),
        };
      case "sessions.git_status":
        return this.gitStatus(String(params.session_id));
      case "list_sessions":
        return this.sessions().filter((s) => s.repo_root === params.repoRoot);
      case "get_session":
        return (
          this.sessions().find(
            (s) => s.id === (params.id ?? params.sessionId),
          ) ?? null
        );
      case "state_hydrate":
        return {
          agents: [...this.agents.values()].map((a) => ({
            agent_id: a.agent_id,
            created_at: a.created_at,
            model: a.model,
            parent_agent_id: a.parent_agent_id,
            runner_id: "claude-code",
            session_id: a.session_id,
            status: a.status,
          })),
          projects: this.projects().map((p) => ({
            ...p,
            registered: true,
            source: "user",
          })),
          sessions: this.sessions(),
        };
      default:
        return method.startsWith("automations.")
          ? automationReply(method, params, (channel) =>
              cannedReply(this.scenario, channel, {}),
            )
          : cannedReply(this.scenario, method, params);
    }
  }

  private transcript(params: Record<string, unknown>): unknown {
    const agentId = String(params.agent_id);
    const conversation = readConversation(agentId) as RawConversation | null;
    if (!conversation) {
      return undefined;
    }
    const cursor = {
      after: params.after as number | undefined,
      before: params.before as number | undefined,
      limit: params.limit as number | undefined,
    };

    return {
      ...transcriptPage(conversation, cursor),
      ...(liveCursor(agentId) ?? {}),
      tasks: null,
      todos: null,
      follow_ups: [],
      model: conversation.model ?? null,
      pending_tool_name: null,
    };
  }

  /** The session's branch, with the scenario's `git_status` counts where it has them. */
  private gitStatus(sessionId: string): unknown {
    const session = this.sessions().find((s) => s.id === sessionId);
    if (!session) {
      return undefined;
    }
    const canned = cannedReply(this.scenario, "git_status", { sessionId }) as
      | Record<string, number | string | null>
      | undefined;
    const counted = canned?.branch === session.branch ? canned : undefined;

    return {
      status: {
        branch: session.branch,
        upstream: null,
        ahead: counted?.ahead ?? 0,
        behind: counted?.behind ?? 0,
        dirty_count: counted?.dirtyCount ?? 0,
        stash_count: 0,
        conflict_count: 0,
        detached: false,
        last_fetch_at: counted?.lastFetchAt ?? null,
        in_progress: null,
      },
    };
  }

  private inScope(
    agent: FixtureAgent,
    params: Record<string, unknown>,
  ): boolean {
    if (typeof params.session_id === "string") {
      return agent.session_id === params.session_id;
    }
    if (typeof params.repo_root === "string") {
      return this.sessions().some(
        (s) => s.id === agent.session_id && s.repo_root === params.repo_root,
      );
    }

    return true;
  }

  private status(agent: FixtureAgent): RemoteAgentStatus {
    const session = this.sessions().find((s) => s.id === agent.session_id);

    return {
      agent_id: agent.agent_id,
      session_id: agent.session_id,
      session_label: session?.display_name ?? session?.branch,
      project_name: session ? basename(session.repo_root) : undefined,
      // What the host's generated title would read like: the task, in a line.
      title:
        session?.kind === "worktree" ? (session.description as string) : null,
      status: agent.status,
      model: agent.model,
      permission_mode: agent.permission_mode ?? null,
      parent_agent_id: agent.parent_agent_id,
      created_at: agent.created_at,
      runner_id: "claude-code",
    };
  }

  private sessions(): FixtureSession[] {
    const listed = (cannedReply(this.scenario, "list_sessions", {}) ??
      []) as FixtureSession[];

    return listed.map((s) => {
      const real = this.worktrees.get(s.id);

      return real ? { ...s, path: real } : s;
    });
  }

  private projects(): FixtureProject[] {
    return (cannedReply(this.scenario, "list_projects", {}) ??
      []) as FixtureProject[];
  }

  private check(method: string, value: unknown): void {
    const parsed = resultSchema(method)?.safeParse(value);
    if (parsed && !parsed.success) {
      const issues = parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      );
      this.mismatches.push(`${method}: ${issues.slice(0, 4).join("; ")}`);
    }
  }
}

function resultSchema(method: string): z.ZodType | undefined {
  return (
    (MethodResult as Record<string, z.ZodType>)[method] ??
    (COMMANDS as Record<string, { result: z.ZodType } | undefined>)[method]
      ?.result
  );
}

function toRemoteSession(s: FixtureSession) {
  return {
    id: s.id,
    repo_root: s.repo_root,
    kind: s.kind,
    branch: s.branch,
    display_name: s.display_name ?? null,
    base_branch: (s.base_branch as string | undefined) ?? null,
    status: s.status,
  };
}

function toCapabilities(payload: unknown): RemoteAgentCapabilities {
  const caps = payload as Partial<RemoteAgentCapabilities>;

  return {
    models: caps.models ?? [],
    commands: caps.commands ?? [],
    agents: caps.agents ?? [],
  };
}

function noCapabilities(): RemoteAgentCapabilities {
  return { models: [], commands: [], agents: [] };
}
