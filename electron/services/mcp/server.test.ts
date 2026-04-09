import { describe, expect, it, vi, beforeAll, beforeEach, afterAll } from "vitest";
import fs from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { appState } from "../../state";
import type { Workspace } from "../workspace/models";
import type { AgentSession } from "../agent/models";

// ---------------------------------------------------------------------------
// Mocks — hoisted before any imports from server.ts
// ---------------------------------------------------------------------------

vi.mock("node:fs", () => {
  const actual = vi.importActual("node:fs");
  return {
    ...actual,
    default: {
      ...(actual as typeof fs),
      existsSync: vi.fn(),
    },
    existsSync: vi.fn(),
  };
});

vi.mock("../../main", () => ({
  getMainWindow: () => null,
}));

vi.mock("../workspace/manager", () => ({
  addRepoRoot: vi.fn(),
  createWorkspace: vi.fn(),
  createHeadWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
}));

vi.mock("../workspace/workspaceOps", () => ({
  getWorkspaceConflicts: vi.fn(),
  mergeWorkspaceIntoBase: vi.fn(),
  readStagehandConfig: vi.fn(),
  writeStagehandConfig: vi.fn(),
}));

vi.mock("../agent/claude", () => ({
  startAgent: vi.fn(),
  sendAgentMessage: vi.fn(),
  listAgents: vi.fn(),
}));

vi.mock("../terminal/multiplexer", () => ({
  createTerminal: vi.fn(),
  startTerminal: vi.fn(),
}));

vi.mock("../workspace/setup", () => ({
  loadStagehandConfig: vi.fn(),
}));

vi.mock("./projects", () => ({
  isGitRepo: vi.fn(),
  ensureRepoRegistered: vi.fn(),
  collectAllProjects: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import mocked modules + server factory
// ---------------------------------------------------------------------------

const { createWorkspace, deleteWorkspace, listWorkspaces } = await import(
  "../workspace/manager"
);
const { getWorkspaceConflicts, mergeWorkspaceIntoBase, readStagehandConfig, writeStagehandConfig } =
  await import("../workspace/workspaceOps");
const { startAgent, sendAgentMessage, listAgents } = await import(
  "../agent/claude"
);
const { createTerminal, startTerminal } = await import(
  "../terminal/multiplexer"
);
const { loadStagehandConfig } = await import("../workspace/setup");
const { isGitRepo, ensureRepoRegistered, collectAllProjects } = await import(
  "./projects"
);

const mockExistsSync = vi.mocked(fs.existsSync);
const mockCreateWorkspace = vi.mocked(createWorkspace);
const mockDeleteWorkspace = vi.mocked(deleteWorkspace);
const mockListWorkspaces = vi.mocked(listWorkspaces);
const mockGetWorkspaceConflicts = vi.mocked(getWorkspaceConflicts);
const mockMergeWorkspaceIntoBase = vi.mocked(mergeWorkspaceIntoBase);
const mockReadStagehandConfig = vi.mocked(readStagehandConfig);
const mockWriteStagehandConfig = vi.mocked(writeStagehandConfig);
const mockStartAgent = vi.mocked(startAgent);
const mockSendAgentMessage = vi.mocked(sendAgentMessage);
const mockListAgents = vi.mocked(listAgents);
const mockCreateTerminal = vi.mocked(createTerminal);
const mockStartTerminal = vi.mocked(startTerminal);
const mockLoadStagehandConfig = vi.mocked(loadStagehandConfig);
const mockIsGitRepo = vi.mocked(isGitRepo);
const mockEnsureRepoRegistered = vi.mocked(ensureRepoRegistered);
const mockCollectAllProjects = vi.mocked(collectAllProjects);

// ---------------------------------------------------------------------------
// Helper: extract text content from a tool result
// ---------------------------------------------------------------------------

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const block = result.content[0];
  if (block && typeof block === "object" && "text" in block) {
    return block.text as string;
  }
  throw new Error("Expected text content block");
}

function jsonOf(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  return JSON.parse(textOf(result));
}

// ---------------------------------------------------------------------------
// Helper: create a mock workspace
// ---------------------------------------------------------------------------

function mockWorkspace(overrides: Partial<Workspace> = {}): Workspace {
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

afterAll(async () => {
  await client.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  appState.repoRoots.clear();
  appState.workspaces.clear();
  appState.agents.clear();
  appState.terminals.clear();
});

// ===========================================================================
// list_projects
// ===========================================================================

describe("list_projects", () => {
  it("delegates to collectAllProjects and returns JSON", async () => {
    mockCollectAllProjects.mockReturnValue([
      { path: "/projects/frontend", description: "Frontend", registered: true, source: "/projects/frontend" },
    ]);
    const result = await client.callTool({ name: "list_projects", arguments: {} });
    const parsed = jsonOf(result) as Array<{ path: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].path).toBe("/projects/frontend");
  });

  it("returns empty array when no projects", async () => {
    mockCollectAllProjects.mockReturnValue([]);
    const result = await client.callTool({ name: "list_projects", arguments: {} });
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
      arguments: { project_path: "/nonexistent", description: "Nope" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("does not exist");
  });

  it("returns error when target is not a git repo", async () => {
    mockExistsSync.mockReturnValue(true);
    mockIsGitRepo.mockReturnValue(false);
    const result = await client.callTool({
      name: "add_related_project",
      arguments: { project_path: "/not-git", description: "Not git" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Not a git repository");
  });

  it("detects duplicates and returns without writing", async () => {
    mockExistsSync.mockReturnValue(true);
    mockIsGitRepo.mockReturnValue(true);
    mockReadStagehandConfig.mockReturnValue({
      setup: { copy: [], symlink: [], commands: [] },
      terminals: [],
      workspace_env: [],
      related_projects: [{ path: "../backend", description: "Backend" }],
    });

    const result = await client.callTool({
      name: "add_related_project",
      arguments: {
        repo_root: "/projects/frontend",
        project_path: "/projects/backend",
        description: "Backend API",
      },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("already listed");
    expect(mockWriteStagehandConfig).not.toHaveBeenCalled();
  });

  it("adds a new related project and writes config", async () => {
    mockExistsSync.mockReturnValue(true);
    mockIsGitRepo.mockReturnValue(true);
    mockReadStagehandConfig.mockReturnValue({
      setup: { copy: [], symlink: [], commands: [] },
      terminals: [],
      workspace_env: [],
      related_projects: [],
    });

    const result = await client.callTool({
      name: "add_related_project",
      arguments: {
        repo_root: "/projects/frontend",
        project_path: "/projects/backend",
        description: "Backend API",
      },
    });
    const parsed = jsonOf(result) as { added: { path: string; description: string } };
    expect(parsed.added.path).toBe("../backend");
    expect(parsed.added.description).toBe("Backend API");
    expect(mockWriteStagehandConfig).toHaveBeenCalledWith(
      "/projects/frontend",
      expect.any(String),
    );
  });
});

// ===========================================================================
// create_workspace
// ===========================================================================

describe("create_workspace", () => {
  beforeEach(() => {
    appState.repoRoots.add("/projects/frontend");
  });

  it("creates workspace and returns formatted response", async () => {
    const ws = mockWorkspace();
    mockCreateWorkspace.mockResolvedValue(ws);

    const result = await client.callTool({
      name: "create_workspace",
      arguments: { name: "Cool Thing", description: "A cool feature", repo_root: "/projects/frontend" },
    });
    const parsed = jsonOf(result) as { workspace_id: string; branch: string };
    expect(parsed.workspace_id).toBe("ws-1");
    expect(parsed.branch).toBe("feat/cool-thing");
    expect(mockEnsureRepoRegistered).toHaveBeenCalledWith("/projects/frontend");
    expect(mockCreateWorkspace).toHaveBeenCalledWith(
      "/projects/frontend",
      expect.stringContaining("Cool Thing"),
      "A cool feature",
      false,
      undefined,
    );
  });

  it("passes explicit repo_root and base_branch through", async () => {
    mockCreateWorkspace.mockResolvedValue(
      mockWorkspace({ repo_root: "/projects/backend" }),
    );

    await client.callTool({
      name: "create_workspace",
      arguments: {
        name: "API fix",
        repo_root: "/projects/backend",
        base_branch: "develop",
      },
    });
    expect(mockEnsureRepoRegistered).toHaveBeenCalledWith("/projects/backend");
    expect(mockCreateWorkspace).toHaveBeenCalledWith(
      "/projects/backend",
      expect.stringContaining("API fix"),
      "",
      false,
      "develop",
    );
  });
});

// ===========================================================================
// list_workspaces
// ===========================================================================

describe("list_workspaces", () => {
  beforeEach(() => {
    appState.repoRoots.add("/projects/frontend");
  });

  it("returns formatted workspace list", async () => {
    const ws = mockWorkspace();
    mockListWorkspaces.mockResolvedValue([ws]);

    const result = await client.callTool({
      name: "list_workspaces",
      arguments: {},
    });
    const parsed = jsonOf(result) as Array<{ workspace_id: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].workspace_id).toBe("ws-1");
    expect(parsed[0]).toHaveProperty("branch", "feat/cool-thing");
    expect(parsed[0]).toHaveProperty("display_name", "Cool Thing");
  });

  it("returns empty array when no workspaces exist", async () => {
    mockListWorkspaces.mockResolvedValue([]);

    const result = await client.callTool({
      name: "list_workspaces",
      arguments: {},
    });
    expect(jsonOf(result)).toEqual([]);
  });
});

// ===========================================================================
// delete_workspace
// ===========================================================================

describe("delete_workspace", () => {
  it("returns error when workspace not found", async () => {
    const result = await client.callTool({
      name: "delete_workspace",
      arguments: { workspace: "nonexistent" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Workspace not found");
  });

  it("resolves workspace by ID and deletes", async () => {
    const ws = mockWorkspace();
    appState.workspaces.set("ws-1", ws);
    mockDeleteWorkspace.mockResolvedValue(undefined);

    const result = await client.callTool({
      name: "delete_workspace",
      arguments: { workspace: "ws-1" },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("Deleted workspace");
    expect(textOf(result)).toContain("Cool Thing");
    expect(mockDeleteWorkspace).toHaveBeenCalledWith("ws-1", false);
  });

  it("resolves workspace by branch name", async () => {
    const ws = mockWorkspace();
    appState.workspaces.set("ws-1", ws);
    mockDeleteWorkspace.mockResolvedValue(undefined);

    const result = await client.callTool({
      name: "delete_workspace",
      arguments: { workspace: "feat/cool-thing" },
    });
    expect(result.isError).toBeFalsy();
    expect(mockDeleteWorkspace).toHaveBeenCalledWith("ws-1", false);
  });

  it("resolves workspace by display name", async () => {
    const ws = mockWorkspace();
    appState.workspaces.set("ws-1", ws);
    mockDeleteWorkspace.mockResolvedValue(undefined);

    const result = await client.callTool({
      name: "delete_workspace",
      arguments: { workspace: "Cool Thing" },
    });
    expect(result.isError).toBeFalsy();
    expect(mockDeleteWorkspace).toHaveBeenCalledWith("ws-1", false);
  });

  it("passes delete_branch flag through", async () => {
    const ws = mockWorkspace();
    appState.workspaces.set("ws-1", ws);
    mockDeleteWorkspace.mockResolvedValue(undefined);

    await client.callTool({
      name: "delete_workspace",
      arguments: { workspace: "ws-1", delete_branch: true },
    });
    expect(mockDeleteWorkspace).toHaveBeenCalledWith("ws-1", true);
  });
});

// ===========================================================================
// spawn_agent
// ===========================================================================

describe("spawn_agent", () => {
  it("returns error when workspace not found", async () => {
    const result = await client.callTool({
      name: "spawn_agent",
      arguments: { workspace: "ghost", prompt: "do stuff" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Workspace not found");
  });

  it("starts agent and sends initial prompt", async () => {
    const ws = mockWorkspace();
    appState.workspaces.set("ws-1", ws);
    mockStartAgent.mockResolvedValue({
      agent_id: "agent-42",
      workspace_id: "ws-1",
      status: "running",
    });

    const result = await client.callTool({
      name: "spawn_agent",
      arguments: { workspace: "ws-1", prompt: "Build the thing" },
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
    );
    expect(mockSendAgentMessage).toHaveBeenCalledWith(
      "agent-42",
      "Build the thing",
    );
  });

  it("passes permission_mode through", async () => {
    const ws = mockWorkspace();
    appState.workspaces.set("ws-1", ws);
    mockStartAgent.mockResolvedValue({
      agent_id: "agent-42",
      workspace_id: "ws-1",
      status: "running",
    });

    await client.callTool({
      name: "spawn_agent",
      arguments: {
        workspace: "ws-1",
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
    );
  });
});

// ===========================================================================
// list_agents
// ===========================================================================

describe("list_agents", () => {
  it("returns error when workspace filter is not found", async () => {
    const result = await client.callTool({
      name: "list_agents",
      arguments: { workspace: "nope" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Workspace not found");
  });

  it("returns agents for a specific workspace", async () => {
    const ws = mockWorkspace();
    appState.workspaces.set("ws-1", ws);
    mockListAgents.mockReturnValue([
      { agent_id: "a-1", workspace_id: "ws-1", status: "running" },
    ]);

    const result = await client.callTool({
      name: "list_agents",
      arguments: { workspace: "ws-1" },
    });
    const parsed = jsonOf(result) as Array<{ agent_id: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].agent_id).toBe("a-1");
    expect(parsed[0]).toHaveProperty("branch", "feat/cool-thing");
    expect(mockListAgents).toHaveBeenCalledWith("ws-1");
  });

  it("returns agents across all workspaces when no filter", async () => {
    const ws1 = mockWorkspace({ id: "ws-1" });
    const ws2 = mockWorkspace({ id: "ws-2", branch: "feat/other" });
    appState.workspaces.set("ws-1", ws1);
    appState.workspaces.set("ws-2", ws2);
    mockListAgents.mockImplementation((wsId: string) => {
      if (wsId === "ws-1")
        return [{ agent_id: "a-1", workspace_id: "ws-1", status: "running" as const }];
      if (wsId === "ws-2")
        return [{ agent_id: "a-2", workspace_id: "ws-2", status: "running" as const }];
      return [];
    });

    const result = await client.callTool({
      name: "list_agents",
      arguments: {},
    });
    const parsed = jsonOf(result) as Array<{ agent_id: string }>;
    expect(parsed).toHaveLength(2);
    expect(parsed.map((a) => a.agent_id).sort()).toEqual(["a-1", "a-2"]);
  });

  it("returns 'No agents running.' when none exist", async () => {
    const ws = mockWorkspace();
    appState.workspaces.set("ws-1", ws);
    mockListAgents.mockReturnValue([]);

    const result = await client.callTool({
      name: "list_agents",
      arguments: { workspace: "ws-1" },
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

  it("returns agent info with workspace context", async () => {
    const ws = mockWorkspace();
    appState.workspaces.set("ws-1", ws);
    appState.agents.set("agent-1", {
      agentId: "agent-1",
      workspaceId: "ws-1",
      status: "running",
      stdin: null as unknown as AgentSession["stdin"],
      child: null as unknown as AgentSession["child"],
      controlHandler: null,
    });

    const result = await client.callTool({
      name: "agent_status",
      arguments: { agent_id: "agent-1" },
    });
    const parsed = jsonOf(result) as {
      agent_id: string;
      branch: string;
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
    expect(mockSendAgentMessage).toHaveBeenCalledWith("a-1", "Hello agent");
  });
});

// ===========================================================================
// trigger_run
// ===========================================================================

describe("trigger_run", () => {
  it("returns error when workspace not found", async () => {
    const result = await client.callTool({
      name: "trigger_run",
      arguments: { workspace: "ghost" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Workspace not found");
  });

  it("returns error when no run command configured", async () => {
    const ws = mockWorkspace();
    appState.workspaces.set("ws-1", ws);
    mockLoadStagehandConfig.mockReturnValue({
      setup: { copy: [], symlink: [], commands: [] },
      terminals: [],
      workspace_env: [],
      run: null,
    });

    const result = await client.callTool({
      name: "trigger_run",
      arguments: { workspace: "ws-1" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("No 'run' command configured");
  });

  it("handles run config as object with command and dir", async () => {
    const ws = mockWorkspace();
    appState.workspaces.set("ws-1", ws);
    mockLoadStagehandConfig.mockReturnValue({
      setup: { copy: [], symlink: [], commands: [] },
      terminals: [],
      workspace_env: [],
      run: { command: "pnpm dev", dir: "packages/app" },
    });
    mockCreateTerminal.mockReturnValue("term-1");

    const result = await client.callTool({
      name: "trigger_run",
      arguments: { workspace: "ws-1" },
    });
    const parsed = jsonOf(result) as { command: string; terminal_session_id: string };
    expect(parsed.command).toBe("pnpm dev");
    expect(parsed.terminal_session_id).toBe("term-1");
    expect(mockCreateTerminal).toHaveBeenCalledWith("ws-1", "packages/app", "pnpm dev");
    expect(mockStartTerminal).toHaveBeenCalledWith("term-1", 120, 40);
  });

  it("handles config load failure gracefully", async () => {
    const ws = mockWorkspace();
    appState.workspaces.set("ws-1", ws);
    mockLoadStagehandConfig.mockImplementation(() => {
      throw new Error("bad config");
    });

    const result = await client.callTool({
      name: "trigger_run",
      arguments: { workspace: "ws-1" },
    });
    // Falls through to "no run command" since config load threw.
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("No 'run' command configured");
  });
});

// ===========================================================================
// check_conflicts
// ===========================================================================

describe("check_conflicts", () => {
  it("returns error when workspace not found", async () => {
    const result = await client.callTool({
      name: "check_conflicts",
      arguments: { workspace: "nope" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Workspace not found");
  });

  it("reports clean merge when no conflicts", async () => {
    const ws = mockWorkspace();
    appState.workspaces.set("ws-1", ws);
    mockGetWorkspaceConflicts.mockResolvedValue([]);

    const result = await client.callTool({
      name: "check_conflicts",
      arguments: { workspace: "ws-1" },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("No conflicts");
    expect(textOf(result)).toContain("feat/cool-thing");
    expect(textOf(result)).toContain("main");
  });

  it("returns conflicting file list", async () => {
    const ws = mockWorkspace();
    appState.workspaces.set("ws-1", ws);
    mockGetWorkspaceConflicts.mockResolvedValue(["src/app.ts", "README.md"]);

    const result = await client.callTool({
      name: "check_conflicts",
      arguments: { workspace: "ws-1" },
    });
    const parsed = jsonOf(result) as {
      conflicting_files: string[];
      workspace_branch: string;
    };
    expect(parsed.conflicting_files).toEqual(["src/app.ts", "README.md"]);
    expect(parsed.workspace_branch).toBe("feat/cool-thing");
  });
});

// ===========================================================================
// merge_workspace
// ===========================================================================

describe("merge_workspace", () => {
  it("returns error when workspace not found", async () => {
    const result = await client.callTool({
      name: "merge_workspace",
      arguments: { workspace: "gone" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Workspace not found");
  });

  it("merges and returns success message", async () => {
    const ws = mockWorkspace();
    appState.workspaces.set("ws-1", ws);
    mockMergeWorkspaceIntoBase.mockResolvedValue(undefined);

    const result = await client.callTool({
      name: "merge_workspace",
      arguments: { workspace: "ws-1" },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("Successfully merged");
    expect(textOf(result)).toContain("feat/cool-thing");
    expect(textOf(result)).toContain("main");
    expect(mockMergeWorkspaceIntoBase).toHaveBeenCalledWith("ws-1");
  });
});

// ===========================================================================
// resolveRepoRoot (tested indirectly)
// ===========================================================================

describe("create_workspace repo_root handling", () => {
  it("requires repo_root — omitting it returns an error", async () => {
    appState.repoRoots.add("/first/repo");

    const result = await client.callTool({
      name: "create_workspace",
      arguments: { name: "test" },
    });
    // Zod validation should reject the missing required field.
    expect(result.isError).toBe(true);
  });

  it("uses explicit repo_root when provided", async () => {
    appState.repoRoots.add("/default/repo");
    mockCreateWorkspace.mockResolvedValue(
      mockWorkspace({ repo_root: "/other/repo" }),
    );

    await client.callTool({
      name: "create_workspace",
      arguments: { name: "test", repo_root: "/other/repo" },
    });
    expect(mockEnsureRepoRegistered).toHaveBeenCalledWith("/other/repo");
  });
});

// ===========================================================================
// resolveWorkspace (tested indirectly via delete_workspace)
// ===========================================================================

describe("resolveWorkspace (via delete_workspace)", () => {
  it("resolves by UUID", async () => {
    appState.workspaces.set("uuid-abc", mockWorkspace({ id: "uuid-abc" }));
    mockDeleteWorkspace.mockResolvedValue(undefined);

    const result = await client.callTool({
      name: "delete_workspace",
      arguments: { workspace: "uuid-abc" },
    });
    expect(result.isError).toBeFalsy();
  });

  it("resolves by branch name when ID doesn't match", async () => {
    appState.workspaces.set(
      "ws-x",
      mockWorkspace({ id: "ws-x", branch: "fix/bug-123" }),
    );
    mockDeleteWorkspace.mockResolvedValue(undefined);

    const result = await client.callTool({
      name: "delete_workspace",
      arguments: { workspace: "fix/bug-123" },
    });
    expect(result.isError).toBeFalsy();
    expect(mockDeleteWorkspace).toHaveBeenCalledWith("ws-x", false);
  });

  it("resolves by display_name as last resort", async () => {
    appState.workspaces.set(
      "ws-y",
      mockWorkspace({ id: "ws-y", branch: "feat/xyz", display_name: "My Feature" }),
    );
    mockDeleteWorkspace.mockResolvedValue(undefined);

    const result = await client.callTool({
      name: "delete_workspace",
      arguments: { workspace: "My Feature" },
    });
    expect(result.isError).toBeFalsy();
    expect(mockDeleteWorkspace).toHaveBeenCalledWith("ws-y", false);
  });

  it("returns null (error) when nothing matches", async () => {
    appState.workspaces.set("ws-z", mockWorkspace({ id: "ws-z" }));

    const result = await client.callTool({
      name: "delete_workspace",
      arguments: { workspace: "completely-unknown" },
    });
    expect(result.isError).toBe(true);
  });
});
