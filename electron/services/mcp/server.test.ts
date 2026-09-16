import type { AgentSession } from "../agent/models";
import type { Session } from "../session/models";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import fs from "node:fs";
import {
  describe,
  expect,
  it,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
} from "vitest";
import { appState } from "../../state";

/* eslint-disable vitest/require-top-level-describe */

// ---------------------------------------------------------------------------
// Mocks — hoisted before any imports from server.ts
// ---------------------------------------------------------------------------

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof fs>("node:fs");

  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
    },
    existsSync: vi.fn(),
  };
});

vi.mock("../../main", () => ({
  getMainWindow: () => null,
}));

vi.mock("../session/manager", () => ({
  addRepoRoot: vi.fn(),
  createSession: vi.fn(),
  createHeadSession: vi.fn(),
  deleteSession: vi.fn(),
  listSessions: vi.fn(),
}));

vi.mock("../session/sessionOps", () => ({
  getSessionConflicts: vi.fn(),
  mergeSessionIntoBase: vi.fn(),
  readArgusConfig: vi.fn(),
  writeArgusConfig: vi.fn(),
}));

vi.mock("../agent/claude", () => ({
  startAgent: vi.fn(),
  sendAgentMessage: vi.fn(),
  listAgents: vi.fn(),
  waitForAgent: vi.fn(),
  emitMcpSystemMessage: vi.fn(),
}));

vi.mock("../terminal/multiplexer", () => ({
  createTerminal: vi.fn(),
  createRunTerminal: vi.fn(),
  startTerminal: vi.fn(),
}));

vi.mock("../session/setup", () => ({
  loadArgusConfig: vi.fn(),
}));

vi.mock("./projects", () => ({
  isGitRepo: vi.fn(),
  ensureRepoRegistered: vi.fn(),
  collectAllProjects: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import mocked modules + server factory
// ---------------------------------------------------------------------------

const { createSession, deleteSession, listSessions } =
  await import("../session/manager");
const {
  getSessionConflicts,
  mergeSessionIntoBase,
  readArgusConfig,
  writeArgusConfig,
} = await import("../session/sessionOps");
const { startAgent, sendAgentMessage, listAgents } =
  await import("../agent/claude");
const { createRunTerminal, startTerminal } =
  await import("../terminal/multiplexer");
const { isGitRepo, ensureRepoRegistered, collectAllProjects } =
  await import("./projects");

const mockExistsSync = vi.mocked(fs.existsSync);
const mockCreateSession = vi.mocked(createSession);
const mockDeleteSession = vi.mocked(deleteSession);
const mockListSessions = vi.mocked(listSessions);
const mockGetSessionConflicts = vi.mocked(getSessionConflicts);
const mockMergeSessionIntoBase = vi.mocked(mergeSessionIntoBase);
const mockReadArgusConfig = vi.mocked(readArgusConfig);
const mockWriteArgusConfig = vi.mocked(writeArgusConfig);
const mockStartAgent = vi.mocked(startAgent);
const mockSendAgentMessage = vi.mocked(sendAgentMessage);
const mockListAgents = vi.mocked(listAgents);
const mockCreateRunTerminal = vi.mocked(createRunTerminal);
const mockStartTerminal = vi.mocked(startTerminal);
const mockIsGitRepo = vi.mocked(isGitRepo);
const mockEnsureRepoRegistered = vi.mocked(ensureRepoRegistered);
const mockCollectAllProjects = vi.mocked(collectAllProjects);

// ---------------------------------------------------------------------------
// Helper: extract text content from a tool result
// ---------------------------------------------------------------------------

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as unknown[];
  const block = content[0];
  if (block && typeof block === "object" && "text" in block) {
    return block.text as string;
  }
  throw new Error("Expected text content block");
}

function jsonOf(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  return JSON.parse(textOf(result));
}

// ---------------------------------------------------------------------------
// Helper: create a mock session
// ---------------------------------------------------------------------------

function mockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "ws-1",
    kind: "worktree",
    branch: "feat/cool-thing",
    display_name: "Cool Thing",
    description: "A cool feature",
    path: "/tmp/worktrees/cool-thing",
    repo_root: "/projects/frontend",
    status: "ready",
    env_index: 0,
    base_branch: "main",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test setup: create MCP server + client via InMemoryTransport
// ---------------------------------------------------------------------------

const { createMcpServer } = await import("./server");

let client: Client;

beforeAll(async () => {
  const server = createMcpServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
});

beforeEach(() => {
  vi.clearAllMocks();
  appState.repoRoots.clear();
  appState.sessions.clear();
  appState.agents.clear();
  appState.terminals.clear();
});

afterAll(async () => {
  await client.close();
});

// ===========================================================================
// list_projects
// ===========================================================================

describe("list_projects", () => {
  it("delegates to collectAllProjects and returns JSON", async () => {
    mockCollectAllProjects.mockReturnValue([
      {
        path: "/projects/frontend",
        description: "Frontend",
        registered: true,
        source: "/projects/frontend",
      },
    ]);
    const result = await client.callTool({
      name: "list_projects",
      arguments: {},
    });
    const parsed = jsonOf(result) as { path: string }[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].path).toBe("/projects/frontend");
  });

  it("returns empty array when no projects", async () => {
    mockCollectAllProjects.mockReturnValue([]);
    const result = await client.callTool({
      name: "list_projects",
      arguments: {},
    });
    expect(jsonOf(result)).toEqual([]);
  });
});

// ===========================================================================
// add_related_project
// ===========================================================================

describe("add_related_project", () => {
  beforeEach(() => {
    appState.repoRoots.add("/projects/frontend");
  });

  it("returns error when target path does not exist", async () => {
    mockExistsSync.mockReturnValue(false);
    const result = await client.callTool({
      name: "add_related_project",
      arguments: { related_project_path: "/nonexistent", description: "Nope" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("does not exist");
  });

  it("returns error when target is not a git repo", async () => {
    mockExistsSync.mockReturnValue(true);
    mockIsGitRepo.mockReturnValue(false);
    const result = await client.callTool({
      name: "add_related_project",
      arguments: { related_project_path: "/not-git", description: "Not git" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Not a git repository");
  });

  it("detects duplicates and returns without writing", async () => {
    mockExistsSync.mockReturnValue(true);
    mockIsGitRepo.mockReturnValue(true);
    mockReadArgusConfig.mockReturnValue({
      setup: { copy: [], symlink: [], commands: [] },
      terminals: [],
      workspace_env: [],
      run: [],
      browser_presets: [],
      protected_branches: [],
      release_note_patterns: [],
      simulator_deeplinks: [],
      related_projects: [{ path: "../backend", description: "Backend" }],
    });

    const result = await client.callTool({
      name: "add_related_project",
      arguments: {
        project_path: "/projects/frontend",
        related_project_path: "/projects/backend",
        description: "Backend API",
      },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("already listed");
    expect(mockWriteArgusConfig).not.toHaveBeenCalled();
  });

  it("adds a new related project and writes config", async () => {
    mockExistsSync.mockReturnValue(true);
    mockIsGitRepo.mockReturnValue(true);
    mockReadArgusConfig.mockReturnValue({
      setup: { copy: [], symlink: [], commands: [] },
      terminals: [],
      workspace_env: [],
      run: [],
      browser_presets: [],
      protected_branches: [],
      release_note_patterns: [],
      simulator_deeplinks: [],
      related_projects: [],
    });

    const result = await client.callTool({
      name: "add_related_project",
      arguments: {
        project_path: "/projects/frontend",
        related_project_path: "/projects/backend",
        description: "Backend API",
      },
    });
    const parsed = jsonOf(result) as {
      added: { path: string; description: string };
    };
    expect(parsed.added.path).toBe("../backend");
    expect(parsed.added.description).toBe("Backend API");
    expect(mockWriteArgusConfig).toHaveBeenCalledWith(
      "/projects/frontend",
      expect.any(String),
    );
  });
});

// ===========================================================================
// create_session
// ===========================================================================

describe("create_session", () => {
  beforeEach(() => {
    appState.repoRoots.add("/projects/frontend");
  });

  it("creates session and returns formatted response", async () => {
    const ws = mockSession();
    mockCreateSession.mockResolvedValue(ws);

    const result = await client.callTool({
      name: "create_session",
      arguments: {
        name: "Cool Thing",
        description: "A cool feature",
        project_path: "/projects/frontend",
      },
    });
    const parsed = jsonOf(result) as { session_id: string; branch: string };
    expect(parsed.session_id).toBe("ws-1");
    expect(parsed.branch).toBe("feat/cool-thing");
    expect(mockEnsureRepoRegistered).toHaveBeenCalledWith("/projects/frontend");
    expect(mockCreateSession).toHaveBeenCalledWith(
      "/projects/frontend",
      expect.stringContaining("Cool Thing"),
      "A cool feature",
      false,
      undefined,
    );
  });

  it("passes explicit project_path and base_branch through", async () => {
    mockCreateSession.mockResolvedValue(
      mockSession({ repo_root: "/projects/backend" }),
    );

    await client.callTool({
      name: "create_session",
      arguments: {
        name: "API fix",
        project_path: "/projects/backend",
        base_branch: "develop",
      },
    });
    expect(mockEnsureRepoRegistered).toHaveBeenCalledWith("/projects/backend");
    expect(mockCreateSession).toHaveBeenCalledWith(
      "/projects/backend",
      expect.stringContaining("API fix"),
      "",
      false,
      "develop",
    );
  });
});

// ===========================================================================
// list_sessions
// ===========================================================================

describe("list_sessions", () => {
  beforeEach(() => {
    appState.repoRoots.add("/projects/frontend");
  });

  it("returns formatted session list", async () => {
    const ws = mockSession();
    mockListSessions.mockResolvedValue([ws]);

    const result = await client.callTool({
      name: "list_sessions",
      arguments: {},
    });
    const parsed = jsonOf(result) as { session_id: string }[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].session_id).toBe("ws-1");
    expect(parsed[0]).toHaveProperty("branch", "feat/cool-thing");
    expect(parsed[0]).toHaveProperty("display_name", "Cool Thing");
  });

  it("returns empty array when no sessions exist", async () => {
    mockListSessions.mockResolvedValue([]);

    const result = await client.callTool({
      name: "list_sessions",
      arguments: {},
    });
    expect(jsonOf(result)).toEqual([]);
  });
});

// ===========================================================================
// delete_session
// ===========================================================================

describe("delete_session", () => {
  it("returns error when session not found", async () => {
    const result = await client.callTool({
      name: "delete_session",
      arguments: { session: "nonexistent", project_path: "/projects/frontend" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Session not found");
  });

  it("resolves session by ID and deletes", async () => {
    const ws = mockSession();
    appState.sessions.set("ws-1", ws);
    mockDeleteSession.mockResolvedValue(undefined);

    const result = await client.callTool({
      name: "delete_session",
      arguments: { session: "ws-1", project_path: "/projects/frontend" },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("Deleted session");
    expect(textOf(result)).toContain("Cool Thing");
    expect(mockDeleteSession).toHaveBeenCalledWith("ws-1", false);
  });

  it("resolves session by branch name", async () => {
    const ws = mockSession();
    appState.sessions.set("ws-1", ws);
    mockDeleteSession.mockResolvedValue(undefined);

    const result = await client.callTool({
      name: "delete_session",
      arguments: {
        session: "feat/cool-thing",
        project_path: "/projects/frontend",
      },
    });
    expect(result.isError).toBeFalsy();
    expect(mockDeleteSession).toHaveBeenCalledWith("ws-1", false);
  });

  it("resolves session by display name", async () => {
    const ws = mockSession();
    appState.sessions.set("ws-1", ws);
    mockDeleteSession.mockResolvedValue(undefined);

    const result = await client.callTool({
      name: "delete_session",
      arguments: { session: "Cool Thing", project_path: "/projects/frontend" },
    });
    expect(result.isError).toBeFalsy();
    expect(mockDeleteSession).toHaveBeenCalledWith("ws-1", false);
  });

  it("passes delete_branch flag through", async () => {
    const ws = mockSession();
    appState.sessions.set("ws-1", ws);
    mockDeleteSession.mockResolvedValue(undefined);

    await client.callTool({
      name: "delete_session",
      arguments: {
        session: "ws-1",
        project_path: "/projects/frontend",
        delete_branch: true,
      },
    });
    expect(mockDeleteSession).toHaveBeenCalledWith("ws-1", true);
  });
});

// ===========================================================================
// spawn_agent
// ===========================================================================

describe("spawn_agent", () => {
  it("returns error when session not found", async () => {
    const result = await client.callTool({
      name: "spawn_agent",
      arguments: {
        session: "ghost",
        project_path: "/projects/frontend",
        prompt: "do stuff",
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Session not found");
  });

  it("starts agent and sends initial prompt", async () => {
    const ws = mockSession();
    appState.sessions.set("ws-1", ws);
    mockStartAgent.mockResolvedValue({
      agent_id: "agent-42",
      session_id: "ws-1",
      status: "running",
      parent_agent_id: null,
      created_at: 1_700_000_000_000,
      model: null,
    });

    const result = await client.callTool({
      name: "spawn_agent",
      arguments: {
        session: "ws-1",
        project_path: "/projects/frontend",
        prompt: "Build the thing",
      },
    });
    const parsed = jsonOf(result) as { agent_id: string; status: string };
    expect(parsed.agent_id).toBe("agent-42");
    expect(parsed.status).toBe("running");

    expect(mockStartAgent).toHaveBeenCalledWith(
      "ws-1",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(mockSendAgentMessage).toHaveBeenCalledWith(
      "agent-42",
      "Build the thing",
      [],
    );
  });

  it("passes permission_mode through", async () => {
    const ws = mockSession();
    appState.sessions.set("ws-1", ws);
    mockStartAgent.mockResolvedValue({
      agent_id: "agent-42",
      session_id: "ws-1",
      status: "running",
      parent_agent_id: null,
      created_at: 1_700_000_000_000,
      model: null,
    });

    await client.callTool({
      name: "spawn_agent",
      arguments: {
        session: "ws-1",
        project_path: "/projects/frontend",
        prompt: "test",
        permission_mode: "auto",
      },
    });
    expect(mockStartAgent).toHaveBeenCalledWith(
      "ws-1",
      undefined,
      "auto",
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  it("requires `session` to be present", async () => {
    const result = await client.callTool({
      name: "spawn_agent",
      arguments: { project_path: "/projects/frontend", prompt: "no target" },
    });
    expect(result.isError).toBe(true);
  });
});

// ===========================================================================
// list_agents
// ===========================================================================

describe("list_agents", () => {
  it("returns error when session filter is not found", async () => {
    const result = await client.callTool({
      name: "list_agents",
      arguments: { session: "nope", project_path: "/projects/frontend" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Session not found");
  });

  it("returns agents for a specific session", async () => {
    const ws = mockSession();
    appState.sessions.set("ws-1", ws);
    mockListAgents.mockReturnValue([
      {
        agent_id: "a-1",
        session_id: "ws-1",
        status: "running",
        parent_agent_id: null,
        created_at: 1_700_000_000_000,
        model: null,
      },
    ]);

    const result = await client.callTool({
      name: "list_agents",
      arguments: { session: "ws-1", project_path: "/projects/frontend" },
    });
    const parsed = jsonOf(result) as { agent_id: string }[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].agent_id).toBe("a-1");
    expect(parsed[0]).toHaveProperty("branch", "feat/cool-thing");
    expect(mockListAgents).toHaveBeenCalledWith("ws-1");
  });

  it("returns every agent in the project when no session filter", async () => {
    const ws1 = mockSession({ id: "ws-1" });
    const ws2 = mockSession({ id: "ws-2", branch: "feat/other" });
    appState.sessions.set("ws-1", ws1);
    appState.sessions.set("ws-2", ws2);
    mockListAgents.mockImplementation((wsId: string) => {
      if (wsId === "ws-1") {
        return [
          {
            agent_id: "a-1",
            session_id: "ws-1",
            status: "running" as const,
            parent_agent_id: null,
            created_at: 1_700_000_000_000,
            model: null,
          },
        ];
      }
      if (wsId === "ws-2") {
        return [
          {
            agent_id: "a-2",
            session_id: "ws-2",
            status: "running" as const,
            parent_agent_id: null,
            created_at: 1_700_000_000_000,
            model: null,
          },
        ];
      }

      return [];
    });

    const result = await client.callTool({
      name: "list_agents",
      arguments: { project_path: "/projects/frontend" },
    });
    const parsed = jsonOf(result) as { agent_id: string }[];
    expect(parsed).toHaveLength(2);
    expect(parsed.map((a) => a.agent_id).sort()).toEqual(["a-1", "a-2"]);
  });

  it("returns 'No agents running.' when none exist", async () => {
    const ws = mockSession();
    appState.sessions.set("ws-1", ws);
    mockListAgents.mockReturnValue([]);

    const result = await client.callTool({
      name: "list_agents",
      arguments: { session: "ws-1", project_path: "/projects/frontend" },
    });
    expect(textOf(result)).toBe("No agents running.");
  });
});

// ===========================================================================
// agent_status
// ===========================================================================

describe("agent_status", () => {
  it("returns error when agent not found", async () => {
    const result = await client.callTool({
      name: "agent_status",
      arguments: { agent_id: "nonexistent" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Agent not found");
  });

  it("returns agent info with session context", async () => {
    const ws = mockSession();
    appState.sessions.set("ws-1", ws);
    appState.agents.set("agent-1", {
      agentId: "agent-1",
      sessionId: "ws-1",
      status: "running",
      runner: null as unknown as AgentSession["runner"],
      handle: null as unknown as AgentSession["handle"],
      parentAgentId: null,
      resultSummary: null,
      exitWaiters: [],
      turnWaiters: [],
      turnsCompleted: 0,
      createdAt: 1_700_000_000_000,
      lastEventAt: 1_700_000_000_000,
      toolUsesTotal: 0,
      lastToolUseAt: null,
      lastToolName: null,
      inflightPrompts: 0,
      model: null,
    });

    const result = await client.callTool({
      name: "agent_status",
      arguments: { agent_id: "agent-1" },
    });
    const parsed = jsonOf(result) as {
      agent_id: string;
      branch: string;
      display_name: string;
      status: string;
    };
    expect(parsed.agent_id).toBe("agent-1");
    expect(parsed.branch).toBe("feat/cool-thing");
    expect(parsed.display_name).toBe("Cool Thing");
    expect(parsed.status).toBe("running");
  });
});

// ===========================================================================
// send_agent_message
// ===========================================================================

describe("send_agent_message", () => {
  it("sends message and confirms", async () => {
    const result = await client.callTool({
      name: "send_agent_message",
      arguments: { agent_id: "a-1", message: "Hello agent" },
    });
    expect(textOf(result)).toContain("Message sent to agent a-1");
    expect(mockSendAgentMessage).toHaveBeenCalledWith("a-1", "Hello agent", []);
  });
});

// ===========================================================================
// trigger_run
// ===========================================================================

describe("trigger_run", () => {
  it("returns error when session not found", async () => {
    const result = await client.callTool({
      name: "trigger_run",
      arguments: { session: "ghost", project_path: "/projects/frontend" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Session not found");
  });

  it("returns error when no run command configured", async () => {
    const ws = mockSession();
    appState.sessions.set("ws-1", ws);
    mockCreateRunTerminal.mockImplementation(() => {
      throw "No 'run' command configured";
    });

    const result = await client.callTool({
      name: "trigger_run",
      arguments: { session: "ws-1", project_path: "/projects/frontend" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("No 'run' command configured");
  });

  it("starts the configured run terminal", async () => {
    const ws = mockSession();
    appState.sessions.set("ws-1", ws);
    mockCreateRunTerminal.mockReturnValue({
      sessionId: "term-1",
      started: true,
      title: "dev",
      dependencies: [],
    });

    const result = await client.callTool({
      name: "trigger_run",
      arguments: { session: "ws-1", project_path: "/projects/frontend" },
    });
    const parsed = jsonOf(result) as {
      terminal_session_id: string;
      title: string;
    };
    expect(parsed.terminal_session_id).toBe("term-1");
    expect(parsed.title).toBe("dev");
    expect(mockCreateRunTerminal).toHaveBeenCalledWith("ws-1", undefined);
    expect(mockStartTerminal).toHaveBeenCalledWith("term-1", 120, 40);
  });

  it("handles run terminal creation failure gracefully", async () => {
    const ws = mockSession();
    appState.sessions.set("ws-1", ws);
    mockCreateRunTerminal.mockImplementation(() => {
      throw new Error("bad config");
    });

    const result = await client.callTool({
      name: "trigger_run",
      arguments: { session: "ws-1", project_path: "/projects/frontend" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("bad config");
  });
});

// ===========================================================================
// check_conflicts
// ===========================================================================

describe("check_conflicts", () => {
  it("returns error when session not found", async () => {
    const result = await client.callTool({
      name: "check_conflicts",
      arguments: { session: "nope", project_path: "/projects/frontend" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Session not found");
  });

  it("reports clean merge when no conflicts", async () => {
    const ws = mockSession();
    appState.sessions.set("ws-1", ws);
    mockGetSessionConflicts.mockResolvedValue([]);

    const result = await client.callTool({
      name: "check_conflicts",
      arguments: { session: "ws-1", project_path: "/projects/frontend" },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("No conflicts");
    expect(textOf(result)).toContain("feat/cool-thing");
    expect(textOf(result)).toContain("main");
  });

  it("returns conflicting file list", async () => {
    const ws = mockSession();
    appState.sessions.set("ws-1", ws);
    mockGetSessionConflicts.mockResolvedValue(["src/app.ts", "README.md"]);

    const result = await client.callTool({
      name: "check_conflicts",
      arguments: { session: "ws-1", project_path: "/projects/frontend" },
    });
    const parsed = jsonOf(result) as {
      conflicting_files: string[];
      session_branch: string;
    };
    expect(parsed.conflicting_files).toEqual(["src/app.ts", "README.md"]);
    expect(parsed.session_branch).toBe("feat/cool-thing");
  });
});

// ===========================================================================
// merge_session
// ===========================================================================

describe("merge_session", () => {
  it("returns error when session not found", async () => {
    const result = await client.callTool({
      name: "merge_session",
      arguments: { session: "gone", project_path: "/projects/frontend" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Session not found");
  });

  it("merges and returns success message", async () => {
    const ws = mockSession();
    appState.sessions.set("ws-1", ws);
    mockMergeSessionIntoBase.mockResolvedValue(undefined);

    const result = await client.callTool({
      name: "merge_session",
      arguments: { session: "ws-1", project_path: "/projects/frontend" },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("Successfully merged");
    expect(textOf(result)).toContain("feat/cool-thing");
    expect(textOf(result)).toContain("main");
    expect(mockMergeSessionIntoBase).toHaveBeenCalledWith("ws-1");
  });
});

// ===========================================================================
// spawn_agents_batch
// ===========================================================================

describe("spawn_agents_batch", () => {
  // Mirror the real manager: register the created session in appState so
  // `waitForSessionReady` (called before startAgent) resolves immediately.
  function mockReadyCreateSession(idFn: (repoRoot: string) => string) {
    mockCreateSession.mockImplementation(async (repoRoot: string) => {
      const ws = mockSession({ id: idFn(repoRoot), repo_root: repoRoot });
      appState.sessions.set(ws.id, ws);

      return ws;
    });
  }

  beforeEach(() => {
    mockStartAgent.mockImplementation(async (sessionId: string) => ({
      agent_id: `agent-for-${sessionId}`,
      session_id: sessionId,
      status: "running" as const,
      parent_agent_id: null,
      created_at: 1_700_000_000_000,
      model: null,
    }));
  });

  it("uses top-level project_path for all agents (existing behavior)", async () => {
    mockReadyCreateSession(
      (repoRoot) => `ws-${repoRoot.replace(/\W/g, "")}-${Math.random()}`,
    );

    const result = await client.callTool({
      name: "spawn_agents_batch",
      arguments: {
        project_path: "/projects/frontend",
        agents: [
          { name: "A", prompt: "do A" },
          { name: "B", prompt: "do B" },
        ],
      },
    });
    const parsed = jsonOf(result) as { spawned: number; failed: number };
    expect(parsed.failed).toBe(0);
    expect(parsed.spawned).toBe(2);
    expect(mockCreateSession).toHaveBeenCalledTimes(2);
    expect(mockCreateSession.mock.calls[0][0]).toBe("/projects/frontend");
    expect(mockCreateSession.mock.calls[1][0]).toBe("/projects/frontend");
    // Repo registered exactly once even with two agents.
    expect(mockEnsureRepoRegistered).toHaveBeenCalledTimes(1);
    expect(mockEnsureRepoRegistered).toHaveBeenCalledWith("/projects/frontend");
  });

  it("honors per-agent project_path overrides for cross-project spawning", async () => {
    mockReadyCreateSession((repoRoot) => `ws-${repoRoot.replace(/\W/g, "")}`);

    const result = await client.callTool({
      name: "spawn_agents_batch",
      arguments: {
        agents: [
          { name: "A", prompt: "do A", project_path: "/projects/frontend" },
          { name: "B", prompt: "do B", project_path: "/projects/backend" },
        ],
      },
    });
    const parsed = jsonOf(result) as { spawned: number; failed: number };
    expect(parsed.failed).toBe(0);
    expect(parsed.spawned).toBe(2);
    expect(mockCreateSession.mock.calls.map((c) => c[0]).sort()).toEqual([
      "/projects/backend",
      "/projects/frontend",
    ]);
    expect(mockEnsureRepoRegistered).toHaveBeenCalledTimes(2);
  });

  it("mixes default and per-agent overrides", async () => {
    mockReadyCreateSession((repoRoot) => `ws-${repoRoot.replace(/\W/g, "")}`);

    const result = await client.callTool({
      name: "spawn_agents_batch",
      arguments: {
        project_path: "/projects/frontend",
        agents: [
          { name: "A", prompt: "do A" },
          { name: "B", prompt: "do B", project_path: "/projects/backend" },
        ],
      },
    });
    const parsed = jsonOf(result) as { spawned: number };
    expect(parsed.spawned).toBe(2);
    expect(mockCreateSession.mock.calls.map((c) => c[0]).sort()).toEqual([
      "/projects/backend",
      "/projects/frontend",
    ]);
  });

  it("registers each unique repo only once even when shared by multiple agents", async () => {
    mockReadyCreateSession(() => `ws-${Math.random()}`);

    await client.callTool({
      name: "spawn_agents_batch",
      arguments: {
        agents: [
          { name: "A", prompt: "do A", project_path: "/projects/frontend" },
          { name: "B", prompt: "do B", project_path: "/projects/frontend" },
          { name: "C", prompt: "do C", project_path: "/projects/backend" },
        ],
      },
    });
    expect(mockEnsureRepoRegistered).toHaveBeenCalledTimes(2);
    const registered = mockEnsureRepoRegistered.mock.calls
      .map((c) => c[0])
      .sort();
    expect(registered).toEqual(["/projects/backend", "/projects/frontend"]);
  });

  it("fails the whole batch with a clear error when no project_path resolves", async () => {
    const result = await client.callTool({
      name: "spawn_agents_batch",
      arguments: {
        agents: [
          { name: "A", prompt: "do A", project_path: "/projects/frontend" },
          { name: "B", prompt: "do B" },
        ],
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("B");
    expect(textOf(result)).toContain("project_path");
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockEnsureRepoRegistered).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// resolveRepoRoot (tested indirectly)
// ===========================================================================

describe("create_session project_path handling", () => {
  it("requires project_path — omitting it returns an error", async () => {
    appState.repoRoots.add("/first/repo");

    const result = await client.callTool({
      name: "create_session",
      arguments: { name: "test" },
    });
    // Zod validation should reject the missing required field.
    expect(result.isError).toBe(true);
  });

  it("uses explicit project_path when provided", async () => {
    appState.repoRoots.add("/default/repo");
    mockCreateSession.mockResolvedValue(
      mockSession({ repo_root: "/other/repo" }),
    );

    await client.callTool({
      name: "create_session",
      arguments: { name: "test", project_path: "/other/repo" },
    });
    expect(mockEnsureRepoRegistered).toHaveBeenCalledWith("/other/repo");
  });
});

// ===========================================================================
// resolveSession (tested indirectly via delete_session)
// ===========================================================================

describe("resolveSession (via delete_session)", () => {
  it("resolves by UUID", async () => {
    appState.sessions.set("uuid-abc", mockSession({ id: "uuid-abc" }));
    mockDeleteSession.mockResolvedValue(undefined);

    const result = await client.callTool({
      name: "delete_session",
      arguments: { session: "uuid-abc", project_path: "/projects/frontend" },
    });
    expect(result.isError).toBeFalsy();
  });

  it("resolves by branch name when ID doesn't match", async () => {
    appState.sessions.set(
      "ws-x",
      mockSession({ id: "ws-x", branch: "fix/bug-123" }),
    );
    mockDeleteSession.mockResolvedValue(undefined);

    const result = await client.callTool({
      name: "delete_session",
      arguments: { session: "fix/bug-123", project_path: "/projects/frontend" },
    });
    expect(result.isError).toBeFalsy();
    expect(mockDeleteSession).toHaveBeenCalledWith("ws-x", false);
  });

  it("resolves by display_name as last resort", async () => {
    appState.sessions.set(
      "ws-y",
      mockSession({
        id: "ws-y",
        branch: "feat/xyz",
        display_name: "My Feature",
      }),
    );
    mockDeleteSession.mockResolvedValue(undefined);

    const result = await client.callTool({
      name: "delete_session",
      arguments: { session: "My Feature", project_path: "/projects/frontend" },
    });
    expect(result.isError).toBeFalsy();
    expect(mockDeleteSession).toHaveBeenCalledWith("ws-y", false);
  });

  it('resolves "root" to the project_root session', async () => {
    appState.sessions.set(
      "ws-wt",
      mockSession({ id: "ws-wt", branch: "feat/side" }),
    );
    appState.sessions.set(
      "ws-root",
      mockSession({ id: "ws-root", branch: "main", kind: "project_root" }),
    );
    mockDeleteSession.mockResolvedValue(undefined);

    const result = await client.callTool({
      name: "delete_session",
      arguments: { session: "root", project_path: "/projects/frontend" },
    });
    expect(result.isError).toBeFalsy();
    expect(mockDeleteSession).toHaveBeenCalledWith("ws-root", false);
  });

  it('lets the "root" alias win over a session literally named root', async () => {
    appState.sessions.set(
      "ws-root",
      mockSession({ id: "ws-root", kind: "project_root" }),
    );
    appState.sessions.set("root", mockSession({ id: "root" }));
    mockDeleteSession.mockResolvedValue(undefined);

    const result = await client.callTool({
      name: "delete_session",
      arguments: { session: "root", project_path: "/projects/frontend" },
    });
    expect(result.isError).toBeFalsy();
    expect(mockDeleteSession).toHaveBeenCalledWith("ws-root", false);
  });

  it("returns null (error) when nothing matches", async () => {
    appState.sessions.set("ws-z", mockSession({ id: "ws-z" }));

    const result = await client.callTool({
      name: "delete_session",
      arguments: {
        session: "completely-unknown",
        project_path: "/projects/frontend",
      },
    });
    expect(result.isError).toBe(true);
  });

  it("scopes a branch name lookup to the given project", async () => {
    appState.sessions.set(
      "ws-a",
      mockSession({ id: "ws-a", branch: "main", repo_root: "/projects/one" }),
    );
    appState.sessions.set(
      "ws-b",
      mockSession({ id: "ws-b", branch: "main", repo_root: "/projects/two" }),
    );
    mockDeleteSession.mockResolvedValue(undefined);

    const result = await client.callTool({
      name: "delete_session",
      arguments: { session: "main", project_path: "/projects/two" },
    });
    expect(result.isError).toBeFalsy();
    // The branch "main" exists in both projects — project_path picks ws-b.
    expect(mockDeleteSession).toHaveBeenCalledWith("ws-b", false);
  });

  it("errors when a session ID belongs to a different project", async () => {
    appState.sessions.set(
      "ws-a",
      mockSession({ id: "ws-a", repo_root: "/projects/one" }),
    );

    const result = await client.callTool({
      name: "delete_session",
      arguments: { session: "ws-a", project_path: "/projects/two" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain(
      "belongs to project /projects/one",
    );
    expect(mockDeleteSession).not.toHaveBeenCalled();
  });

  it("requires project_path", async () => {
    appState.sessions.set("ws-1", mockSession());

    const result = await client.callTool({
      name: "delete_session",
      arguments: { session: "ws-1" },
    });
    expect(result.isError).toBe(true);
    expect(mockDeleteSession).not.toHaveBeenCalled();
  });
});
