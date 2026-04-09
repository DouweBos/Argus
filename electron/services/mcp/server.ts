/**
 * Stagehand MCP server — exposes workspace and agent orchestration tools to
 * Claude Code agents via the Model Context Protocol (streamable HTTP).
 *
 * Runs an HTTP server on a random localhost port. The port is passed to agents
 * via `--mcp-config` when they are spawned.
 *
 * # Architecture
 *
 * The MCP server runs inside the Electron main process and has direct access
 * to `appState` and all service functions. No proxy layer or IPC needed.
 */

import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import fs from "node:fs";
import path from "node:path";

import { getMainWindow } from "../../main";
import { appState } from "../../state";
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
} from "../workspace/manager";
import {
  getWorkspaceConflicts,
  mergeWorkspaceIntoBase,
  readStagehandConfig,
  writeStagehandConfig,
} from "../workspace/workspaceOps";
import { startAgent, sendAgentMessage, listAgents } from "../agent/claude";
import { createTerminal, startTerminal } from "../terminal/multiplexer";
import { loadStagehandConfig } from "../workspace/setup";
import { isGitRepo, ensureRepoRegistered, collectAllProjects } from "./projects";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let httpServer: http.Server | null = null;
let mcpPort: number | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a workspace by ID or branch name. Agents typically know the branch
 * name, not the UUID, so we search both.
 */
function resolveWorkspace(idOrBranch: string) {
  // Try by ID first.
  const byId = appState.workspaces.get(idOrBranch);
  if (byId) return byId;

  // Search by branch name.
  for (const ws of appState.workspaces.values()) {
    if (ws.branch === idOrBranch) return ws;
  }

  // Search by display_name.
  for (const ws of appState.workspaces.values()) {
    if (ws.display_name === idOrBranch) return ws;
  }

  return null;
}

/** Resolve the repo_root for a workspace or fall back to the first repo root. */
function resolveRepoRoot(repoRoot?: string): string {
  if (repoRoot) return repoRoot;
  const first = appState.repoRoots.values().next();
  if (first.done) throw new Error("No repository roots registered");
  return first.value;
}


// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/** Exported for testing via InMemoryTransport. */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "stagehand",
    version: "1.0.0",
  });

  // -------------------------------------------------------------------------
  // list_projects
  // -------------------------------------------------------------------------

  server.tool(
    "list_projects",
    "List all known projects: currently registered projects and related projects declared in .stagehand.json configs. Use this to discover other projects you can create workspaces in and work on.",
    {},
    async () => {
      const projects = collectAllProjects();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(projects, null, 2),
          },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // add_related_project
  // -------------------------------------------------------------------------

  server.tool(
    "add_related_project",
    "Add a related project to a project's .stagehand.json configuration. Use this when you discover that work on your current project requires changes in another project that isn't yet listed as related.",
    {
      repo_root: z
        .string()
        .optional()
        .describe("Absolute path to the project whose config to update. Defaults to the first registered repo."),
      project_path: z
        .string()
        .describe("Absolute path to the related project to add."),
      description: z
        .string()
        .describe("Human-readable description of what this related project is (e.g. 'Backend API server', 'Shared component library')."),
    },
    async ({ repo_root, project_path, description }) => {
      const repoRoot = resolveRepoRoot(repo_root);

      // Validate the target path exists and is a git repo.
      if (!fs.existsSync(project_path)) {
        return {
          content: [{ type: "text" as const, text: `Path does not exist: ${project_path}` }],
          isError: true,
        };
      }
      if (!isGitRepo(project_path)) {
        return {
          content: [{ type: "text" as const, text: `Not a git repository: ${project_path}` }],
          isError: true,
        };
      }

      // Compute relative path from repoRoot to the target.
      const relativePath = path.relative(repoRoot, project_path);

      // Read existing config, add the entry, write back.
      const config = readStagehandConfig(repoRoot);
      const existing = config.related_projects ?? [];

      // Check for duplicate.
      const absExisting = existing.map((p) => path.resolve(repoRoot, p.path));
      const absTarget = path.resolve(project_path);
      if (absExisting.includes(absTarget)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Project already listed as related: ${relativePath}`,
            },
          ],
        };
      }

      existing.push({ path: relativePath, description });
      const updatedConfig = { ...config, related_projects: existing };
      writeStagehandConfig(repoRoot, JSON.stringify(updatedConfig, null, 2));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                added: { path: relativePath, description },
                project: repoRoot,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // create_workspace
  // -------------------------------------------------------------------------

  server.tool(
    "create_workspace",
    "Create a new isolated git worktree workspace. Returns the workspace ID and branch name. The workspace will be initialized with the project's setup pipeline (dependency installs, symlinks, etc.). Requires repo_root — use the path from your system prompt for the current project, or a path from list_projects for another project. The project will be auto-registered if needed.",
    {
      name: z
        .string()
        .describe("Display name for the workspace (will be slugified into a branch name)"),
      description: z
        .string()
        .optional()
        .describe("Human-readable description of what this workspace is for"),
      repo_root: z
        .string()
        .describe("Absolute path to the repository root. Use the repo_root from your system prompt for the current project, or a path from list_projects for another project."),
      base_branch: z
        .string()
        .optional()
        .describe("Branch to fork from. Defaults to the repo root HEAD. Use this to create a child worktree off another worktree's branch."),
    },
    async ({ name, description, repo_root, base_branch }) => {
      const repoRoot = repo_root;

      // Auto-register the repo root if targeting a cross-project workspace.
      const isNew = !appState.repoRoots.has(repoRoot);
      ensureRepoRegistered(repoRoot);
      if (isNew) {
        getMainWindow()?.webContents.send("project:added", repoRoot);
      }

      // Append a short unique suffix to prevent branch name collisions when
      // multiple agents create workspaces with the same display name.
      const suffix = crypto.randomUUID().slice(0, 6);
      const uniqueName = `${name}-${suffix}`;

      const ws = await createWorkspace(repoRoot, uniqueName, description ?? "", false, base_branch);

      // Notify the renderer so the sidebar updates immediately.
      getMainWindow()?.webContents.send("workspace:created", {
        id: ws.id,
        kind: ws.kind,
        branch: ws.branch,
        display_name: ws.display_name,
        description: ws.description,
        path: ws.path,
        repo_root: ws.repo_root,
        status: ws.status,
        base_branch: ws.base_branch,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                workspace_id: ws.id,
                branch: ws.branch,
                path: ws.path,
                status: ws.status,
                base_branch: ws.base_branch,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // list_workspaces
  // -------------------------------------------------------------------------

  server.tool(
    "list_workspaces",
    "List all workspaces (worktrees and repo root) for a repository. Returns workspace IDs, branches, paths, and statuses.",
    {
      repo_root: z
        .string()
        .optional()
        .describe("Absolute path to the repository root. Defaults to the first registered repo."),
    },
    async ({ repo_root }) => {
      const repoRoot = resolveRepoRoot(repo_root);
      const workspaces = await listWorkspaces(repoRoot);
      const summary = workspaces.map((ws) => ({
        workspace_id: ws.id,
        kind: ws.kind,
        branch: ws.branch,
        display_name: ws.display_name,
        description: ws.description,
        path: ws.path,
        status: ws.status,
        base_branch: ws.base_branch,
      }));
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // delete_workspace
  // -------------------------------------------------------------------------

  server.tool(
    "delete_workspace",
    "Delete a workspace (git worktree). Kills any running agent and terminals, removes the worktree from disk.",
    {
      workspace: z
        .string()
        .describe("Workspace ID, branch name, or display name"),
      delete_branch: z
        .boolean()
        .optional()
        .describe("Also delete the git branch (default: false)"),
    },
    async ({ workspace, delete_branch }) => {
      const ws = resolveWorkspace(workspace);
      if (!ws) {
        return {
          content: [{ type: "text" as const, text: `Workspace not found: ${workspace}` }],
          isError: true,
        };
      }
      const wsId = ws.id;
      const wsName = ws.display_name ?? ws.branch;
      await deleteWorkspace(wsId, delete_branch ?? false);

      // Notify the renderer so the sidebar removes the workspace.
      getMainWindow()?.webContents.send("workspace:deleted", wsId);

      return {
        content: [
          {
            type: "text" as const,
            text: `Deleted workspace '${wsName}' (${wsId})`,
          },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // spawn_agent
  // -------------------------------------------------------------------------

  server.tool(
    "spawn_agent",
    "Start a new Claude Code agent in a workspace. The agent runs as an independent process with its own conversation. Use this to delegate work to a parallel agent in another worktree.",
    {
      workspace: z
        .string()
        .describe("Workspace ID, branch name, or display name to run the agent in"),
      prompt: z
        .string()
        .describe("Initial message/instructions to send to the agent"),
      permission_mode: z
        .string()
        .optional()
        .describe("Permission mode for the agent (e.g. 'auto', 'default'). Defaults to the app's setting."),
    },
    async ({ workspace, prompt, permission_mode }) => {
      const ws = resolveWorkspace(workspace);
      if (!ws) {
        return {
          content: [{ type: "text" as const, text: `Workspace not found: ${workspace}` }],
          isError: true,
        };
      }

      const agentInfo = await startAgent(
        ws.id,
        undefined, // model — use default
        permission_mode,
        undefined, // resumeSessionId
        undefined, // appendSystemPrompt
      );

      // Send the initial prompt after startup.
      sendAgentMessage(agentInfo.agent_id, prompt);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                agent_id: agentInfo.agent_id,
                workspace_id: ws.id,
                branch: ws.branch,
                status: agentInfo.status,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // list_agents
  // -------------------------------------------------------------------------

  server.tool(
    "list_agents",
    "List all running agents across all workspaces, or for a specific workspace.",
    {
      workspace: z
        .string()
        .optional()
        .describe("Optional workspace ID, branch name, or display name to filter by"),
    },
    async ({ workspace }) => {
      let agents;
      if (workspace) {
        const ws = resolveWorkspace(workspace);
        if (!ws) {
          return {
            content: [{ type: "text" as const, text: `Workspace not found: ${workspace}` }],
            isError: true,
          };
        }
        agents = listAgents(ws.id);
      } else {
        // Collect agents across all workspaces.
        agents = [];
        for (const ws of appState.workspaces.values()) {
          agents.push(...listAgents(ws.id));
        }
      }

      // Enrich with workspace info.
      const enriched = agents.map((a) => {
        const ws = appState.workspaces.get(a.workspace_id);
        return {
          agent_id: a.agent_id,
          workspace_id: a.workspace_id,
          branch: ws?.branch,
          display_name: ws?.display_name,
          status: a.status,
        };
      });

      return {
        content: [
          {
            type: "text" as const,
            text: enriched.length > 0
              ? JSON.stringify(enriched, null, 2)
              : "No agents running.",
          },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // agent_status
  // -------------------------------------------------------------------------

  server.tool(
    "agent_status",
    "Check the status of a specific agent by its ID.",
    {
      agent_id: z.string().describe("The agent ID returned by spawn_agent"),
    },
    async ({ agent_id }) => {
      const session = appState.agents.get(agent_id);
      if (!session) {
        return {
          content: [{ type: "text" as const, text: `Agent not found: ${agent_id}` }],
          isError: true,
        };
      }

      const ws = appState.workspaces.get(session.workspaceId);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                agent_id: session.agentId,
                workspace_id: session.workspaceId,
                branch: ws?.branch,
                display_name: ws?.display_name,
                status: session.status,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // send_agent_message
  // -------------------------------------------------------------------------

  server.tool(
    "send_agent_message",
    "Send a follow-up message to a running agent. Use this to provide additional instructions or context to an agent you previously spawned.",
    {
      agent_id: z.string().describe("The agent ID returned by spawn_agent"),
      message: z.string().describe("The message to send to the agent"),
    },
    async ({ agent_id, message }) => {
      sendAgentMessage(agent_id, message);
      return {
        content: [
          {
            type: "text" as const,
            text: `Message sent to agent ${agent_id}.`,
          },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // trigger_run
  // -------------------------------------------------------------------------

  server.tool(
    "trigger_run",
    "Trigger the configured 'run' command (from .stagehand.json) in a workspace's terminal. This starts the app's dev server, test runner, or whatever the project has configured as its run command. The command runs in a visible UI terminal.",
    {
      workspace: z
        .string()
        .describe("Workspace ID, branch name, or display name"),
    },
    async ({ workspace }) => {
      const ws = resolveWorkspace(workspace);
      if (!ws) {
        return {
          content: [{ type: "text" as const, text: `Workspace not found: ${workspace}` }],
          isError: true,
        };
      }

      let runConfig;
      try {
        const config = loadStagehandConfig(ws.repo_root);
        runConfig = config.run;
      } catch {
        // No config
      }

      if (!runConfig) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No 'run' command configured in .stagehand.json",
            },
          ],
          isError: true,
        };
      }

      const command =
        typeof runConfig === "string" ? runConfig : runConfig.command;
      const dir =
        typeof runConfig === "string" ? undefined : runConfig.dir;

      const sessionId = createTerminal(ws.id, dir, command);
      startTerminal(sessionId, 120, 40);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                terminal_session_id: sessionId,
                command,
                workspace_id: ws.id,
                branch: ws.branch,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // check_conflicts
  // -------------------------------------------------------------------------

  server.tool(
    "check_conflicts",
    "Check whether a workspace's branch would conflict if merged into its base branch. Returns a list of conflicting files, or an empty list if the merge would be clean.",
    {
      workspace: z
        .string()
        .describe("Workspace ID, branch name, or display name"),
    },
    async ({ workspace }) => {
      const ws = resolveWorkspace(workspace);
      if (!ws) {
        return {
          content: [{ type: "text" as const, text: `Workspace not found: ${workspace}` }],
          isError: true,
        };
      }

      const conflicts = await getWorkspaceConflicts(ws.id);

      return {
        content: [
          {
            type: "text" as const,
            text:
              conflicts.length === 0
                ? `No conflicts — clean merge possible for '${ws.branch}' into '${ws.base_branch}'.`
                : JSON.stringify(
                    {
                      conflicting_files: conflicts,
                      workspace_branch: ws.branch,
                      base_branch: ws.base_branch,
                    },
                    null,
                    2,
                  ),
          },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // merge_workspace
  // -------------------------------------------------------------------------

  server.tool(
    "merge_workspace",
    "Merge a workspace's branch into its base branch. Commits any staged changes first, checks for conflicts, then performs a --no-ff merge. The workspace's base branch was set when the worktree was created.",
    {
      workspace: z
        .string()
        .describe("Workspace ID, branch name, or display name"),
    },
    async ({ workspace }) => {
      const ws = resolveWorkspace(workspace);
      if (!ws) {
        return {
          content: [{ type: "text" as const, text: `Workspace not found: ${workspace}` }],
          isError: true,
        };
      }

      await mergeWorkspaceIntoBase(ws.id);

      return {
        content: [
          {
            type: "text" as const,
            text: `Successfully merged '${ws.branch}' into '${ws.base_branch}'.`,
          },
        ],
      };
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// HTTP server lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the Stagehand MCP server on a random localhost port.
 *
 * Returns the port number so it can be passed to agents via `--mcp-config`.
 */
export async function startMcpServer(): Promise<number> {
  if (httpServer) {
    throw new Error("MCP server is already running");
  }

  // Track transports per session for proper lifecycle management.
  const transports = new Map<string, StreamableHTTPServerTransport>();

  httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost`);

    if (url.pathname !== "/mcp") {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    // Handle each method according to the Streamable HTTP spec.
    if (req.method === "POST") {
      // Check for existing session.
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport = sessionId ? transports.get(sessionId) : undefined;

      if (!transport) {
        // New session — create a fresh McpServer + transport pair.
        // Each session needs its own McpServer because the MCP SDK's
        // Server class only supports one active transport at a time.
        const mcpServer = createMcpServer();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
        });

        transport.onclose = () => {
          const sid = transport!.sessionId;
          if (sid) transports.delete(sid);
        };

        await mcpServer.connect(transport);
      }

      await transport.handleRequest(req, res);

      // Store after handleRequest — the session ID is generated during
      // the initialize handshake inside handleRequest, not during connect.
      if (transport.sessionId && !transports.has(transport.sessionId)) {
        transports.set(transport.sessionId, transport);
      }
    } else if (req.method === "GET") {
      // SSE stream for server-initiated messages.
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const transport = sessionId ? transports.get(sessionId) : undefined;
      if (!transport) {
        res.writeHead(400);
        res.end("No active session");
        return;
      }
      await transport.handleRequest(req, res);
    } else if (req.method === "DELETE") {
      // Session termination.
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const transport = sessionId ? transports.get(sessionId) : undefined;
      if (transport) {
        await transport.handleRequest(req, res);
        transports.delete(sessionId!);
      } else {
        res.writeHead(404);
        res.end("Session not found");
      }
    } else {
      res.writeHead(405);
      res.end("Method Not Allowed");
    }
  });

  return new Promise((resolve, reject) => {
    httpServer!.listen(0, "127.0.0.1", () => {
      const addr = httpServer!.address();
      if (typeof addr === "object" && addr) {
        mcpPort = addr.port;
        console.info(`[mcp] Stagehand MCP server listening on 127.0.0.1:${mcpPort}`);
        resolve(mcpPort);
      } else {
        reject(new Error("Failed to get server address"));
      }
    });

    httpServer!.on("error", reject);
  });
}

/** Stop the MCP server. */
export function stopMcpServer(): void {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
    mcpPort = null;
    console.info("[mcp] Stagehand MCP server stopped");
  }
}

/** Get the port the MCP server is listening on, or null if not running. */
export function getMcpPort(): number | null {
  return mcpPort;
}
