/**
 * Argus MCP server — exposes session and agent orchestration tools to
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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { z } from "zod";
import { createLogger, info } from "../../../app/lib/logger";
import { getMainWindow } from "../../main";
import { appState } from "../../state";
import { resolveAttachments, mcpAttachmentSchema } from "../agent/attachments";
import {
  startAgent,
  sendAgentMessage,
  listAgents,
  waitForAgent,
  waitForAnyAgent,
  stopAgent,
  interruptAgent,
  ensureSimulatorForAgent,
  ensureWebBrowserForAgent,
  emitMcpSystemMessage,
} from "../agent/claude";
import {
  addRepoToOrganization,
  createOrganization,
  listOrganizations,
  removeRepoFromOrganization,
  updateOrganization,
  deleteOrganization,
} from "../organization/manager";
import { createSession, deleteSession, listSessions } from "../session/manager";
import {
  abortSessionMerge,
  attemptSessionMerge,
  continueSessionMerge,
  getSessionConflicts,
  getSessionBranchDiff,
  getSessionDiff,
  getSessionFullDiff,
  getSessionMergeStatus,
  getSessionStagedDiff,
  getSessionStatus,
  getSessionUntrackedDiff,
  mergeSessionIntoBase,
  readArgusConfig,
  writeSessionFile,
  writeArgusConfig,
} from "../session/sessionOps";
import {
  createRunTerminal,
  readTerminalOutput,
  startTerminal,
  stripAnsi,
  waitForTerminal,
} from "../terminal/multiplexer";
import {
  isGitRepo,
  ensureRepoRegistered,
  collectAllProjects,
} from "./projects";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let httpServer: http.Server | null = null;
let mcpPort: number | null = null;
let mcpAuthToken: string | null = null;

/**
 * Constant-time comparison of two strings to avoid timing oracles when
 * checking the bearer token.
 */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    return false;
  }

  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Validate an incoming HTTP request against the MCP auth token and an
 * Origin/Host whitelist. Returns true if authorized; on failure, writes a
 * 401/403 response and returns false (caller should `return`).
 */
function authorizeRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  // Reject any cross-origin request (browser DNS-rebinding defense). The MCP
  // server is only ever contacted by spawned agent subprocesses, never by a
  // browser document, so legitimate requests have no Origin header.
  const origin = req.headers.origin;
  if (origin) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "cross-origin requests not allowed" }));

    return false;
  }

  // Require a Host header pointing at loopback. The HTTP/1.1 default Host is
  // `127.0.0.1:<port>`; anything else (e.g. a rebound DNS name) is rejected.
  const host = (req.headers.host ?? "").toLowerCase().split(":")[0];
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]") {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "host not allowed" }));

    return false;
  }

  if (!mcpAuthToken) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "MCP server not initialized" }));

    return false;
  }

  const auth = req.headers.authorization ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m || !timingSafeEqualStr(m[1].trim(), mcpAuthToken)) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));

    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a session by ID or branch name. Agents typically know the branch
 * name, not the UUID, so we search both.
 */
function resolveSession(idOrBranch: string) {
  // Try by ID first.
  const byId = appState.sessions.get(idOrBranch);
  if (byId) {
    return byId;
  }

  // Search by branch name.
  for (const ws of appState.sessions.values()) {
    if (ws.branch === idOrBranch) {
      return ws;
    }
  }

  // Search by display_name.
  for (const ws of appState.sessions.values()) {
    if (ws.display_name === idOrBranch) {
      return ws;
    }
  }

  return null;
}

/**
 * Wait for a freshly-created session to finish provisioning its worktree.
 *
 * `create_session` returns immediately with `status: "initializing"` while
 * branch resolution and `git worktree add` run in the background. Anything
 * that needs the worktree on disk (spawning an agent, opening a terminal)
 * has to wait — `startAgent` / `createTerminal` now throw on a missing path.
 *
 * Resolves once the session reaches `ready`. Throws if the session enters an
 * `error` state, is deleted, or the timeout elapses.
 */
async function waitForSessionReady(
  id: string,
  timeoutMs = 900_000,
): Promise<void> {
  const start = Date.now();
  // Poll on a short interval — provisioning is typically sub-second once the
  // branch name is resolved, but title generation can briefly stretch it.
  while (Date.now() - start < timeoutMs) {
    const ws = appState.sessions.get(id);
    if (!ws) {
      throw `Session ${id} was deleted before it became ready`;
    }
    if (ws.status === "ready") {
      return;
    }
    if (typeof ws.status !== "string") {
      throw `Session ${id} failed to initialize: ${ws.status.error}`;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw `Timed out waiting for session ${id} to become ready`;
}

/**
 * Read a JSON request body and parse it. Returns an empty object on empty
 * bodies and throws on parse errors.
 */
function readJsonBody(
  req: http.IncomingMessage,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf-8").trim();
      if (!text) {
        resolve({});

        return;
      }
      try {
        resolve(JSON.parse(text) as Record<string, unknown>);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Return the most recent mtime (Unix ms) across all files reported by
 * `git status --short` in a session's worktree, or null if no files are
 * changed or the lookup fails. Used by `agent_vitals` as a forward-progress
 * signal that includes background processes the agent spawned (dev servers,
 * watchers, codegen) — `lastEventAt` only catches CLI stream events.
 */
async function latestWorktreeMtime(
  sessionId: string,
  worktreePath: string,
): Promise<number | null> {
  let raw: string;
  try {
    raw = await getSessionStatus(sessionId);
  } catch {
    return null;
  }
  let latest = 0;
  for (const line of raw.split("\n")) {
    if (!line) {
      continue;
    }
    // `git status --short` lines are `XY <path>` or `XY <from> -> <to>`.
    const rest = line.slice(3);
    const arrow = rest.indexOf(" -> ");
    const rel = arrow >= 0 ? rest.slice(arrow + 4) : rest;
    const abs = path.resolve(worktreePath, rel);
    try {
      const stat = fs.statSync(abs);
      const ms = stat.mtimeMs;
      if (ms > latest) {
        latest = ms;
      }
    } catch {
      // File may have been deleted between status and stat — skip.
    }
  }

  return latest > 0 ? latest : null;
}

/** Resolve the project_path for a call, or fall back to the first registered project. */
function resolveRepoRoot(projectPath?: string): string {
  if (projectPath) {
    return projectPath;
  }
  const first = appState.repoRoots.values().next();
  if (first.done) {
    throw new Error("No projects registered");
  }

  return first.value;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/** Exported for testing via InMemoryTransport. */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "argus",
    version: "1.0.0",
  });

  // Wrap server.tool so every handler's thrown errors are logged before the
  // MCP SDK converts them into isError tool results. Without this, backend
  // failures (e.g. createSession() throwing) are invisible in main.log and
  // only surface as opaque error text in the agent's tool-call display.
  const originalTool = server.tool.bind(server) as (
    ...args: unknown[]
  ) => unknown;
  (server as unknown as { tool: typeof originalTool }).tool = (
    ...args: unknown[]
  ) => {
    const handlerIndex = args.length - 1;
    const handler = args[handlerIndex];
    const name = typeof args[0] === "string" ? args[0] : "<unknown>";
    if (typeof handler === "function") {
      const wrapped = async (...handlerArgs: unknown[]) => {
        try {
          return await (handler as (...a: unknown[]) => unknown)(
            ...handlerArgs,
          );
        } catch (err) {
          createLogger(`mcp:${name}`).error("tool handler threw:", err);
          throw err;
        }
      };
      args[handlerIndex] = wrapped;
    }

    return originalTool(...args);
  };

  // -------------------------------------------------------------------------
  // list_projects
  // -------------------------------------------------------------------------

  server.tool(
    "list_projects",
    "List all known projects: currently registered projects and related projects declared in .argus.json configs. Use this to discover other projects you can create sessions in and work on.",
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
    "Add a related project to a project's .argus.json configuration. Use this when you discover that work on your current project requires changes in another project that isn't yet listed as related.",
    {
      project_path: z
        .string()
        .optional()
        .describe(
          "Absolute path to the project whose config to update. Defaults to the first registered project.",
        ),
      related_project_path: z
        .string()
        .describe("Absolute path to the related project to add."),
      description: z
        .string()
        .describe(
          "Human-readable description of what this related project is (e.g. 'Backend API server', 'Shared component library').",
        ),
    },
    async ({ project_path, related_project_path, description }) => {
      const repoRoot = resolveRepoRoot(project_path);

      // Validate the target path exists and is a git repo.
      if (!fs.existsSync(related_project_path)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Path does not exist: ${related_project_path}`,
            },
          ],
          isError: true,
        };
      }
      if (!isGitRepo(related_project_path)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Not a git repository: ${related_project_path}`,
            },
          ],
          isError: true,
        };
      }

      // Compute relative path from repoRoot to the target.
      const relativePath = path.relative(repoRoot, related_project_path);

      // Read existing config, add the entry, write back.
      const config = readArgusConfig(repoRoot);
      const existing = config.related_projects ?? [];

      // Check for duplicate.
      const absExisting = existing.map((p) => path.resolve(repoRoot, p.path));
      const absTarget = path.resolve(related_project_path);
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
      writeArgusConfig(repoRoot, JSON.stringify(updatedConfig, null, 2));

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
  // create_session
  // -------------------------------------------------------------------------

  server.tool(
    "create_session",
    "Create a new isolated git worktree session. Returns the session ID and branch name. The session will be initialized with the project's setup pipeline (dependency installs, symlinks, etc.). Requires project_path — use the path from your system prompt for the current project, or a path from list_projects for another project. The project will be auto-registered if needed.",
    {
      name: z
        .string()
        .describe(
          "Display name for the session (will be slugified into a branch name)",
        ),
      description: z
        .string()
        .optional()
        .describe("Human-readable description of what this session is for"),
      project_path: z
        .string()
        .describe(
          "Absolute path to the project root. Use the project_path from your system prompt for the current project, or a path from list_projects for another project.",
        ),
      base_branch: z
        .string()
        .optional()
        .describe(
          "Branch to fork from. Defaults to the project's HEAD. Use this to create a child worktree off another worktree's branch.",
        ),
    },
    async ({ name, description, project_path, base_branch }) => {
      const repoRoot = project_path;

      // Auto-register the repo root if targeting a cross-project session.
      const isNew = !appState.repoRoots.has(repoRoot);
      ensureRepoRegistered(repoRoot);
      if (isNew) {
        getMainWindow()?.webContents.send("project:added", repoRoot);
      }

      // Append a short unique suffix to prevent branch name collisions when
      // multiple agents create sessions with the same display name.
      const suffix = crypto.randomUUID().slice(0, 6);
      const uniqueName = `${name}-${suffix}`;

      const ws = await createSession(
        repoRoot,
        uniqueName,
        description ?? "",
        false,
        base_branch,
      );

      // Notify the renderer so the sidebar updates immediately.
      getMainWindow()?.webContents.send("session:created", {
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
                session_id: ws.id,
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
  // list_sessions
  // -------------------------------------------------------------------------

  server.tool(
    "list_sessions",
    "List all sessions (worktrees and project root) for a project. Returns session IDs, branches, paths, and statuses.",
    {
      project_path: z
        .string()
        .optional()
        .describe(
          "Absolute path to the project root. Defaults to the first registered project.",
        ),
    },
    async ({ project_path }) => {
      const repoRoot = resolveRepoRoot(project_path);
      const sessions = await listSessions(repoRoot);
      const summary = sessions.map((ws) => ({
        session_id: ws.id,
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
  // delete_session
  // -------------------------------------------------------------------------

  server.tool(
    "delete_session",
    "Delete a session (git worktree). Kills any running agent and terminals, removes the worktree from disk.",
    {
      session: z.string().describe("Session ID, branch name, or display name"),
      delete_branch: z
        .boolean()
        .optional()
        .describe("Also delete the git branch (default: false)"),
    },
    async ({ session, delete_branch }) => {
      const ws = resolveSession(session);
      if (!ws) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Session not found: ${session}`,
            },
          ],
          isError: true,
        };
      }
      const wsId = ws.id;
      const wsName = ws.display_name ?? ws.branch;
      await deleteSession(wsId, delete_branch ?? false);

      return {
        content: [
          {
            type: "text" as const,
            text: `Deleted session '${wsName}' (${wsId})`,
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
    "Start a new Claude Code agent in a session. The agent runs as an independent process with its own conversation. Use this to delegate work to a parallel agent in another worktree. Pass your own agent_id as parent_agent_id so the relationship is tracked.",
    {
      session: z
        .string()
        .describe(
          "Session ID, branch name, or display name to run the agent in",
        ),
      prompt: z
        .string()
        .describe("Initial message/instructions to send to the agent"),
      permission_mode: z
        .enum(["default", "auto", "acceptEdits", "bypassPermissions", "plan"])
        .optional()
        .describe(
          "Permission mode for the agent. 'auto' uses Claude's smart classifier to auto-approve safe actions and ask for risky ones. 'default' prompts per tool; 'acceptEdits' auto-accepts file edits; 'plan' is read-only exploration plus AskUserQuestion/ExitPlanMode requiring an approved plan before writes; 'bypassPermissions' skips all prompts. Defaults to the app's setting.",
        ),
      model: z
        .string()
        .optional()
        .describe(
          "Optional model id override for this agent (runner-specific shape). When omitted the cascade falls through to the session, project, and app defaults — set this only when delegating a child to a different model than its parent. The session's runner is fixed at session creation and is *not* overridable here.",
        ),
      platforms: z
        .array(z.enum(["ios", "android", "web"]))
        .optional()
        .describe(
          "Runtime platforms this child agent should target (e.g. ['ios']). Narrows the system prompt so the agent only sees iOS/Android/Web sections relevant to its task. Defaults to the project's `.argus.json` `platforms` field, or all three if unset.",
        ),
      parent_agent_id: z
        .string()
        .optional()
        .describe(
          "Agent ID of the orchestrator/parent agent spawning this child. Used for tracking the parent-child relationship in the UI and for cascade cleanup.",
        ),
      attachments: z
        .array(mcpAttachmentSchema)
        .optional()
        .describe(
          "Optional attachments (images/screenshots) to forward to the child agent's initial message. When the user sends you an image, include its absolute path here so the child agent sees the actual image, not just a text description. Use { path: '/abs/path/to/file.png' } for files on disk, or { data: '<base64>', mime_type: 'image/png' } for inline bytes.",
        ),
    },
    async ({
      session,
      prompt,
      permission_mode,
      model,
      platforms,
      parent_agent_id,
      attachments,
    }) => {
      const ws = resolveSession(session);
      if (!ws) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Session not found: ${session}`,
            },
          ],
          isError: true,
        };
      }

      let images;
      try {
        images = resolveAttachments(attachments);
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: (e as Error).message }],
          isError: true,
        };
      }

      // Sessions created by `create_session` return immediately with status
      // `initializing` — the worktree is still being provisioned in the
      // background. Block here until it's ready so `startAgent` finds a real
      // working directory.
      try {
        await waitForSessionReady(ws.id);
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: String(e) }],
          isError: true,
        };
      }

      const agentInfo = await startAgent(
        ws.id,
        model, // model override — undefined falls through to session/project/app default
        permission_mode,
        undefined, // resumeSessionId
        undefined, // appendSystemPrompt
        platforms, // platformsOverride
        parent_agent_id, // parentAgentId
      );

      // Notify the renderer so the agent store and event listeners pick up
      // the new agent — normally done by the UI-initiated start_agent path.
      getMainWindow()?.webContents.send("agent:started", {
        agent_id: agentInfo.agent_id,
        session_id: agentInfo.session_id,
        status: agentInfo.status,
        permission_mode,
        parent_agent_id: agentInfo.parent_agent_id,
        created_at: agentInfo.created_at,
        initial_prompt: prompt,
        model: agentInfo.model,
      });

      // Send the initial prompt after startup.
      sendAgentMessage(agentInfo.agent_id, prompt, images);

      // Surface the orchestrator's prompt in the child agent's conversation UI.
      emitMcpSystemMessage(agentInfo.agent_id, {
        tool: "spawn_agent",
        message: prompt,
        images,
        parentAgentId: parent_agent_id,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                agent_id: agentInfo.agent_id,
                session_id: ws.id,
                branch: ws.branch,
                status: agentInfo.status,
                parent_agent_id: agentInfo.parent_agent_id,
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
  // spawn_agents_batch
  // -------------------------------------------------------------------------

  server.tool(
    "spawn_agents_batch",
    "Create multiple sessions and spawn agents in them in parallel. Each entry creates a new worktree and starts an agent with the given prompt. Agents may target different projects — set `project_path` per-agent to spawn across projects in one call. Much more efficient than sequential create_session + spawn_agent calls. Returns all agent IDs at once.",
    {
      project_path: z
        .string()
        .optional()
        .describe(
          "Default project path used when an agent entry doesn't specify its own `project_path`. Optional if every agent specifies its own.",
        ),
      agents: z
        .array(
          z.object({
            name: z
              .string()
              .describe(
                "Display name for the session (slugified into a branch name)",
              ),
            description: z
              .string()
              .optional()
              .describe("What this agent/session is for"),
            prompt: z.string().describe("Initial instructions for the agent"),
            project_path: z
              .string()
              .optional()
              .describe(
                "Override the top-level `project_path` for this agent only — use to spawn agents into different projects in a single batch.",
              ),
            platforms: z
              .array(z.enum(["ios", "android", "web"]))
              .optional()
              .describe("Runtime platforms this agent targets"),
            model: z
              .string()
              .optional()
              .describe(
                "Optional model id override for this agent (runner-specific shape). When omitted the cascade falls through to the session/project/app defaults. The runner is fixed at session creation and is not overridable here.",
              ),
            attachments: z
              .array(mcpAttachmentSchema)
              .optional()
              .describe(
                "Optional attachments (images) to forward to this agent's initial message. Same shape as spawn_agent.attachments.",
              ),
          }),
        )
        .describe("Array of agents to spawn, each in its own session"),
      permission_mode: z
        .enum(["default", "auto", "acceptEdits", "bypassPermissions", "plan"])
        .optional()
        .describe(
          "Permission mode for all agents. Use 'plan' for planning-only agents that must call ExitPlanMode before any writes. See spawn_agent for other values. Defaults to app setting.",
        ),
      parent_agent_id: z
        .string()
        .optional()
        .describe("Agent ID of the orchestrator spawning these agents."),
      base_branch: z
        .string()
        .optional()
        .describe("Branch to fork all sessions from. Defaults to HEAD."),
    },
    async ({
      project_path,
      agents: agentSpecs,
      permission_mode,
      parent_agent_id,
      base_branch,
    }) => {
      // Resolve each agent's project_path up-front: prefer the per-agent
      // override, fall back to the top-level default. Callers passing only
      // top-level `project_path` and no per-agent overrides still work.
      const resolvedRepoRoots: string[] = [];
      const missing: string[] = [];
      agentSpecs.forEach((spec, idx) => {
        const resolved = spec.project_path ?? project_path;
        if (!resolved) {
          missing.push(spec.name || `agents[${idx}]`);
        }
        resolvedRepoRoots.push(resolved ?? "");
      });
      if (missing.length > 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `spawn_agents_batch: no project_path resolved for agent(s): ${missing.join(", ")}. Provide a top-level \`project_path\` as default, or set \`project_path\` on each agent entry. No sessions were created.`,
            },
          ],
          isError: true,
        };
      }

      // Register each unique repo once, notifying the renderer when it's new.
      const registered = new Set<string>();
      for (const rr of resolvedRepoRoots) {
        if (registered.has(rr)) {
          continue;
        }
        registered.add(rr);
        const isNew = !appState.repoRoots.has(rr);
        ensureRepoRegistered(rr);
        if (isNew) {
          getMainWindow()?.webContents.send("project:added", rr);
        }
      }

      // Create all sessions in parallel.
      const sessionResults = await Promise.allSettled(
        agentSpecs.map(async (spec, idx) => {
          const suffix = crypto.randomUUID().slice(0, 6);
          const uniqueName = `${spec.name}-${suffix}`;
          const ws = await createSession(
            resolvedRepoRoots[idx],
            uniqueName,
            spec.description ?? "",
            false,
            base_branch,
          );

          // `createSession` already broadcasts `session:created`, so don't
          // re-emit here.

          return { session: ws, spec };
        }),
      );

      // Spawn agents in the successfully created sessions.
      const results: {
        agent_id: string;
        session_id: string;
        branch: string;
        name: string;
        status: string;
        error?: string;
      }[] = [];

      const spawnPromises = sessionResults.map(async (wsResult, idx) => {
        const spec = agentSpecs[idx];
        if (wsResult.status === "rejected") {
          results.push({
            agent_id: "",
            session_id: "",
            branch: "",
            name: spec.name,
            status: "error",
            error: `Session creation failed: ${String(wsResult.reason)}`,
          });

          return;
        }

        const { session: ws } = wsResult.value;

        let images;
        try {
          images = resolveAttachments(spec.attachments);
        } catch (e) {
          results.push({
            agent_id: "",
            session_id: ws.id,
            branch: ws.branch,
            name: spec.name,
            status: "error",
            error: `Attachment error: ${(e as Error).message}`,
          });

          return;
        }

        try {
          // Wait for the freshly-created worktree to land on disk before
          // spawning the agent — otherwise Claude would launch with `cwd: ""`.
          await waitForSessionReady(ws.id);

          const agentInfo = await startAgent(
            ws.id,
            spec.model,
            permission_mode,
            undefined,
            undefined,
            spec.platforms,
            parent_agent_id,
          );

          getMainWindow()?.webContents.send("agent:started", {
            agent_id: agentInfo.agent_id,
            session_id: agentInfo.session_id,
            status: agentInfo.status,
            permission_mode,
            parent_agent_id: agentInfo.parent_agent_id,
            created_at: agentInfo.created_at,
            initial_prompt: spec.prompt,
            model: agentInfo.model,
          });

          sendAgentMessage(agentInfo.agent_id, spec.prompt, images);

          emitMcpSystemMessage(agentInfo.agent_id, {
            tool: "spawn_agents_batch",
            message: spec.prompt,
            images,
            parentAgentId: parent_agent_id,
          });

          results.push({
            agent_id: agentInfo.agent_id,
            session_id: ws.id,
            branch: ws.branch,
            name: spec.name,
            status: "running",
          });
        } catch (e) {
          results.push({
            agent_id: "",
            session_id: ws.id,
            branch: ws.branch,
            name: spec.name,
            status: "error",
            error: `Agent spawn failed: ${String(e)}`,
          });
        }
      });

      await Promise.allSettled(spawnPromises);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                total: agentSpecs.length,
                spawned: results.filter((r) => r.status === "running").length,
                failed: results.filter((r) => r.status === "error").length,
                agents: results,
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
    "List all running agents across all sessions, or for a specific session.",
    {
      session: z
        .string()
        .optional()
        .describe(
          "Optional session ID, branch name, or display name to filter by",
        ),
    },
    async ({ session }) => {
      let agents;
      if (session) {
        const ws = resolveSession(session);
        if (!ws) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Session not found: ${session}`,
              },
            ],
            isError: true,
          };
        }
        agents = listAgents(ws.id);
      } else {
        // Collect agents across all sessions.
        agents = [];
        for (const ws of appState.sessions.values()) {
          agents.push(...listAgents(ws.id));
        }
      }

      // Enrich with session info.
      const enriched = agents.map((a) => {
        const ws = appState.sessions.get(a.session_id);

        return {
          agent_id: a.agent_id,
          session_id: a.session_id,
          branch: ws?.branch,
          display_name: ws?.display_name,
          status: a.status,
          parent_agent_id: a.parent_agent_id,
        };
      });

      return {
        content: [
          {
            type: "text" as const,
            text:
              enriched.length > 0
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
          content: [
            { type: "text" as const, text: `Agent not found: ${agent_id}` },
          ],
          isError: true,
        };
      }

      const ws = appState.sessions.get(session.sessionId);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                agent_id: session.agentId,
                session_id: session.sessionId,
                branch: ws?.branch,
                display_name: ws?.display_name,
                status: session.status,
                parent_agent_id: session.parentAgentId,
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
  // agent_vitals
  // -------------------------------------------------------------------------

  server.tool(
    "agent_vitals",
    'Batched health check for one or more agents. Returns each agent\'s status, turn count, lifetime tool-call count, and timestamps for last CLI event, last tool use, and last worktree file modification — enough to tell an actively iterating child from a parked one without pulling its transcript. Note: `status` reflects CLI turn boundaries (it flips to `idle` between turns), so `last_tool_use_at` and `last_file_change_at` are the truer signals of forward progress. `time_since_last_*_ms` are convenience deltas. Set `include_file_mtime: false` to skip the worktree stat call when checking many agents in a hot loop. Unknown agent IDs come back with `status: "not_found"` instead of failing the whole call.',
    {
      agent_ids: z
        .array(z.string())
        .min(1)
        .describe(
          "Agent IDs to check. Pass the full list of children from your fan-out for a single round-trip health check.",
        ),
      include_file_mtime: z
        .boolean()
        .optional()
        .describe(
          "Include the most recent file mtime in each agent's worktree (`last_file_change_at`). Defaults to true. Set false to skip the per-session stat calls when polling tightly.",
        ),
    },
    async ({ agent_ids, include_file_mtime }) => {
      const now = Date.now();
      const includeMtime = include_file_mtime ?? true;
      const vitals = await Promise.all(
        agent_ids.map(async (id) => {
          const session = appState.agents.get(id);
          if (!session) {
            return { agent_id: id, status: "not_found" as const };
          }
          const ws = appState.sessions.get(session.sessionId);

          let lastFileChangeAt: number | null = null;
          if (includeMtime && ws) {
            lastFileChangeAt = await latestWorktreeMtime(ws.id, ws.path);
          }

          return {
            agent_id: id,
            session_id: session.sessionId,
            branch: ws?.branch,
            display_name: ws?.display_name,
            status: session.status,
            parent_agent_id: session.parentAgentId,
            created_at: session.createdAt,
            last_event_at: session.lastEventAt,
            time_since_last_event_ms: now - session.lastEventAt,
            last_tool_use_at: session.lastToolUseAt,
            time_since_last_tool_use_ms:
              session.lastToolUseAt !== null
                ? now - session.lastToolUseAt
                : null,
            last_tool_name: session.lastToolName,
            tool_uses_total: session.toolUsesTotal,
            last_file_change_at: lastFileChangeAt,
            time_since_last_file_change_ms:
              lastFileChangeAt !== null ? now - lastFileChangeAt : null,
            turns_completed: session.turnsCompleted,
            has_result: session.resultSummary !== null,
          };
        }),
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                checked_at: now,
                count: vitals.length,
                vitals,
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
  // get_agent_result
  // -------------------------------------------------------------------------

  server.tool(
    "get_agent_result",
    "Get the result summary of a completed agent. Returns the final output, cost, and duration from the agent's last conversation turn. Only available after the agent has finished (status: stopped or error).",
    {
      agent_id: z.string().describe("The agent ID returned by spawn_agent"),
    },
    async ({ agent_id }) => {
      const session = appState.agents.get(agent_id);
      if (!session) {
        return {
          content: [
            { type: "text" as const, text: `Agent not found: ${agent_id}` },
          ],
          isError: true,
        };
      }

      if (session.status !== "stopped" && session.status !== "error") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Agent is still ${session.status}. Wait for it to finish before reading its result.`,
            },
          ],
          isError: true,
        };
      }

      const ws = appState.sessions.get(session.sessionId);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                agent_id: session.agentId,
                session_id: session.sessionId,
                branch: ws?.branch,
                status: session.status,
                result: session.resultSummary,
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
  // wait_for_agent
  // -------------------------------------------------------------------------

  server.tool(
    "wait_for_agent",
    "Block until a spawned agent finishes its current turn (becomes idle) or exits, then return its status and latest result summary. Returns immediately if the agent is already idle, stopped, or errored. Use this instead of polling agent_status in a loop.",
    {
      agent_id: z.string().describe("The agent ID returned by spawn_agent"),
      timeout_seconds: z
        .number()
        .optional()
        .describe(
          "Maximum seconds to wait before timing out. Defaults to no timeout (wait indefinitely).",
        ),
    },
    async ({ agent_id, timeout_seconds }, extra) => {
      // Emit progress notifications periodically so the transport sees traffic
      // while the wait blocks. Protects against intermediate idle timeouts
      // even when the per-tool call timeout is disabled on the client.
      const progressToken = extra?._meta?.progressToken;
      let ticks = 0;
      const keepalive = progressToken
        ? setInterval(() => {
            ticks += 1;
            extra
              .sendNotification({
                method: "notifications/progress",
                params: {
                  progressToken,
                  progress: ticks,
                  message: `waiting for agent ${agent_id}`,
                },
              })
              .catch(() => {});
          }, 30_000)
        : null;
      try {
        const { status, result } = await waitForAgent(
          agent_id,
          timeout_seconds ? timeout_seconds * 1000 : undefined,
        );

        const session = appState.agents.get(agent_id);
        const ws = session
          ? appState.sessions.get(session.sessionId)
          : undefined;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  agent_id,
                  session_id: session?.sessionId,
                  branch: ws?.branch,
                  status,
                  result,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: String(e) }],
          isError: true,
        };
      } finally {
        if (keepalive) {
          clearInterval(keepalive);
        }
      }
    },
  );

  // -------------------------------------------------------------------------
  // wait_for_any_agent
  // -------------------------------------------------------------------------

  server.tool(
    "wait_for_any_agent",
    "Block until the FIRST of several agents finishes its current turn or exits, then return which one settled along with its status and result. Use this when you've fanned out to multiple children and want to react as soon as any one of them is ready — `wait_for_agent` only watches a single agent and would force you to pick one to block on. Returns immediately if any of the listed agents is already idle/stopped/errored.",
    {
      agent_ids: z
        .array(z.string())
        .min(1)
        .describe("Agent IDs to race. Must be non-empty."),
      timeout_seconds: z
        .number()
        .optional()
        .describe(
          "Maximum seconds to wait before timing out. Defaults to no timeout (wait indefinitely).",
        ),
    },
    async ({ agent_ids, timeout_seconds }, extra) => {
      const progressToken = extra?._meta?.progressToken;
      let ticks = 0;
      const keepalive = progressToken
        ? setInterval(() => {
            ticks += 1;
            extra
              .sendNotification({
                method: "notifications/progress",
                params: {
                  progressToken,
                  progress: ticks,
                  message: `waiting for any of ${agent_ids.length} agents`,
                },
              })
              .catch(() => {});
          }, 30_000)
        : null;

      try {
        const { agentId, status, result } = await waitForAnyAgent(
          agent_ids,
          timeout_seconds ? timeout_seconds * 1000 : undefined,
        );

        const session = appState.agents.get(agentId);
        const ws = session
          ? appState.sessions.get(session.sessionId)
          : undefined;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  agent_id: agentId,
                  session_id: session?.sessionId,
                  branch: ws?.branch,
                  status,
                  result,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: String(e) }],
          isError: true,
        };
      } finally {
        if (keepalive) {
          clearInterval(keepalive);
        }
      }
    },
  );

  // -------------------------------------------------------------------------
  // send_agent_message
  // -------------------------------------------------------------------------

  server.tool(
    "send_agent_message",
    "Send a follow-up message to a running agent. Use this to provide additional instructions or context to an agent you previously spawned. When the user sends you an image that the child agent should see, pass its absolute path in `attachments`.",
    {
      agent_id: z.string().describe("The agent ID returned by spawn_agent"),
      message: z.string().describe("The message to send to the agent"),
      attachments: z
        .array(mcpAttachmentSchema)
        .optional()
        .describe(
          "Optional attachments (images/screenshots) to attach to this message. Use { path: '/abs/path/to/file.png' } for files on disk, or { data: '<base64>', mime_type: 'image/png' } for inline bytes. Only image types are supported (image/png, image/jpeg, image/gif, image/webp).",
        ),
      parent_agent_id: z
        .string()
        .optional()
        .describe(
          "Your own agent_id, so the recipient's UI can show who the message came from. Optional but strongly recommended.",
        ),
    },
    async ({ agent_id, message, attachments, parent_agent_id }) => {
      let images;
      try {
        images = resolveAttachments(attachments);
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: (e as Error).message }],
          isError: true,
        };
      }

      sendAgentMessage(agent_id, message, images);

      emitMcpSystemMessage(agent_id, {
        tool: "send_agent_message",
        message,
        images,
        parentAgentId: parent_agent_id,
      });

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
  // stop_agent
  // -------------------------------------------------------------------------

  server.tool(
    "stop_agent",
    "Terminate a running agent immediately. Kills the underlying Claude Code subprocess, releases any reserved devices, and removes the agent from active state. Use this for runaway children, course corrections that warrant a clean restart, or cleanup of completed orchestration phases. The session/worktree itself is preserved — call `delete_session` to remove that too. Idempotent: returns success if the agent is already gone.",
    {
      agent_id: z.string().describe("The agent ID returned by spawn_agent"),
    },
    async ({ agent_id }) => {
      try {
        await stopAgent(agent_id);

        return {
          content: [
            { type: "text" as const, text: `Stopped agent ${agent_id}.` },
          ],
        };
      } catch (e) {
        // stopAgent throws when the agent isn't found. Treat that as success
        // for idempotency — the orchestrator's intent (the agent is gone) is
        // satisfied either way.
        const msg = String(e);
        if (msg.includes("No agent found")) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Agent ${agent_id} was already stopped or never existed.`,
              },
            ],
          };
        }

        return {
          content: [{ type: "text" as const, text: msg }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // interrupt_agent
  // -------------------------------------------------------------------------

  server.tool(
    "interrupt_agent",
    "Interrupt an agent's current turn without killing it. The agent stops the work it is currently doing, returns to idle, and remains ready to receive a new message via `send_agent_message`. Use this when you want to redirect a child mid-task instead of tearing it down. Prefer `stop_agent` when you no longer need the agent at all.",
    {
      agent_id: z.string().describe("The agent ID returned by spawn_agent"),
    },
    async ({ agent_id }) => {
      try {
        await interruptAgent(agent_id);

        return {
          content: [
            { type: "text" as const, text: `Interrupted agent ${agent_id}.` },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: String(e) }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // read_agent_transcript
  // -------------------------------------------------------------------------

  server.tool(
    "read_agent_transcript",
    "Read the conversation transcript of another agent — the messages it sent and received, including its tool calls and their outputs. Use this to review what a child agent actually did before merging or to debug why a child got stuck. Returns the live in-memory snapshot if the agent is still active, falling back to the on-disk chat history for completed agents. `get_agent_result` only returns the final summary; this returns the full conversation. For long sessions, use `tail_messages`, `head_messages`, or `offset`+`limit` to pull a subset into your own context. The response includes `total_messages`, `start_index`, and `end_index` (half-open, end-exclusive) so you can paginate across follow-up calls.",
    {
      agent_id: z.string().describe("The agent ID returned by spawn_agent"),
      tail_messages: z
        .number()
        .int()
        .optional()
        .describe(
          "Return only the last N messages. Defaults to 50 when no other slicing param is given. Pass 0 for the full transcript. Ignored if `head_messages` or `offset` is set.",
        ),
      head_messages: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          "Return only the first N messages of the conversation. Useful for inspecting the initial prompt and early planning steps. Ignored if `offset` is set.",
        ),
      offset: z
        .number()
        .int()
        .optional()
        .describe(
          "Start index of the slice to return. 0 is the first message. Negative values count from the end (e.g. -20 starts 20 messages before the end). Combine with `limit` to page through the transcript.",
        ),
      limit: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          "Maximum number of messages to return starting from `offset`. Defaults to all messages from `offset` onward. Only used when `offset` is set.",
        ),
    },
    async ({ agent_id, tail_messages, head_messages, offset, limit }) => {
      const snapshotJson = appState.agentSnapshots.get(agent_id);
      if (!snapshotJson) {
        const agentSession = appState.agents.get(agent_id);
        if (agentSession) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Agent ${agent_id} has not published a transcript snapshot yet — wait for it to produce messages and try again, or open its tab in the UI.`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `No transcript available for agent ${agent_id}. The agent has stopped and its in-memory snapshot was released; use \`get_agent_result\` for the final result summary instead.`,
            },
          ],
          isError: true,
        };
      }

      let conv: { messages?: unknown[]; title?: string } = {};
      try {
        conv = JSON.parse(snapshotJson);
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to parse transcript snapshot for agent ${agent_id}.`,
            },
          ],
          isError: true,
        };
      }

      const agentSession = appState.agents.get(agent_id);
      const sessionMeta = agentSession
        ? appState.sessions.get(agentSession.sessionId)
        : undefined;
      const messages = Array.isArray(conv.messages) ? conv.messages : [];
      const total = messages.length;

      let startIndex = 0;
      let endIndex = total;
      if (offset !== undefined) {
        const normalizedOffset =
          offset < 0 ? Math.max(0, total + offset) : Math.min(offset, total);
        startIndex = normalizedOffset;
        endIndex =
          limit === undefined
            ? total
            : Math.min(total, normalizedOffset + Math.max(0, limit));
      } else if (head_messages !== undefined) {
        startIndex = 0;
        endIndex = Math.min(total, head_messages);
      } else {
        const tail =
          tail_messages === undefined ? 50 : Math.max(0, tail_messages);
        startIndex = tail > 0 && total > tail ? total - tail : 0;
        endIndex = total;
      }

      const trimmed = messages.slice(startIndex, endIndex);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                agent_id,
                session_id: agentSession?.sessionId ?? null,
                branch: sessionMeta?.branch ?? null,
                title: conv.title ?? null,
                total_messages: total,
                start_index: startIndex,
                end_index: endIndex,
                returned_messages: trimmed.length,
                messages: trimmed,
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
  // list_run_commands
  // -------------------------------------------------------------------------

  server.tool(
    "list_run_commands",
    "List the run commands configured in a session's .argus.json. Use this to discover what `trigger_run` can launch (dev server, watcher, test runner, etc.) before deciding whether to start a runtime — the user has likely already configured the right command. Returns each entry's title, shell command, working dir, and restart-on-rerun flag.",
    {
      session: z.string().describe("Session ID, branch name, or display name"),
    },
    async ({ session }) => {
      const ws = resolveSession(session);
      if (!ws) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Session not found: ${session}`,
            },
          ],
          isError: true,
        };
      }

      try {
        const config = readArgusConfig(ws.repo_root);
        const commands = (config.run ?? []).map((r) => ({
          title: r.title,
          command: r.command,
          cwd: r.cwd,
          restartOnRerun: r.restartOnRerun,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  session_id: ws.id,
                  branch: ws.branch,
                  run_commands: commands,
                  hint:
                    commands.length === 0
                      ? "No run commands configured. Ask the user to add one to .argus.json rather than spawning a dev server via Bash."
                      : "Use `trigger_run` with one of these titles to (re)start the runtime in the Argus UI.",
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: String(e) }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // trigger_run
  // -------------------------------------------------------------------------

  server.tool(
    "trigger_run",
    "Start (or restart) one of the project's configured run commands from .argus.json — its dev server, watcher, test runner, simulator boot script, etc. ALWAYS use this instead of running `npm run dev`, `pnpm start`, `expo start`, `bun run`, `next dev`, `vite`, `cargo run`, `python manage.py runserver`, or any equivalent long-running process via the Bash tool. The user already has the runtime open in the Argus UI on the project's configured port; spawning your own copy from Bash collides on that port, fragments output the user can't see, and leaves orphaned processes. The command runs in a visible UI terminal the user can inspect. Pass `title` to pick a specific entry; omit to run the first configured command. If you don't know what's configured, call `list_run_commands` first. Returns a `terminal_session_id` — pair it with `wait_for_terminal` (block until a 'ready' regex appears or the process exits) and `read_terminal` (snapshot captured output) to observe the run.",
    {
      session: z.string().describe("Session ID, branch name, or display name"),
      title: z
        .string()
        .optional()
        .describe(
          "Title of the run command from .argus.json. Defaults to the first entry.",
        ),
    },
    async ({ session, title }) => {
      const ws = resolveSession(session);
      if (!ws) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Session not found: ${session}`,
            },
          ],
          isError: true,
        };
      }

      try {
        const result = createRunTerminal(ws.id, title);
        // Boot the primary terminal plus every auto-spawned dependency so
        // their PTYs actually start producing output — `createRunTerminal`
        // only allocates the sessions.
        for (const dep of result.dependencies) {
          startTerminal(dep.sessionId, 120, 40);
        }
        startTerminal(result.sessionId, 120, 40);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  terminal_session_id: result.sessionId,
                  started: result.started,
                  title: result.title,
                  session_id: ws.id,
                  branch: ws.branch,
                  dependencies: result.dependencies.map((d) => ({
                    terminal_session_id: d.sessionId,
                    title: d.title,
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: String(e) }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // read_terminal
  // -------------------------------------------------------------------------

  server.tool(
    "read_terminal",
    "Snapshot the captured output of a terminal session (typically one started via `trigger_run`). Returns the tail of the captured log, whether the process is still running, and its exit code if it has exited. ANSI escape codes are stripped by default so the output is plain text. Output capture is bounded (~256KB per terminal); `dropped_bytes` indicates how many older bytes were truncated from the front. Use this for non-blocking peeks; use `wait_for_terminal` when you want to block until something specific appears or the process exits.",
    {
      terminal_session_id: z
        .string()
        .describe(
          "Terminal session id returned by `trigger_run` (NOT the worktree session id).",
        ),
      tail_bytes: z
        .number()
        .int()
        .optional()
        .describe(
          "Return only the last N bytes of captured output. Defaults to ~16KB. Pass 0 for the full capture (capped at the per-terminal maximum).",
        ),
      strip_ansi: z
        .boolean()
        .optional()
        .describe(
          "Strip ANSI escape sequences (color codes, cursor moves, progress redraws). Defaults to true.",
        ),
    },
    async ({ terminal_session_id, tail_bytes, strip_ansi }) => {
      try {
        const result = readTerminalOutput(terminal_session_id, {
          tailBytes: tail_bytes,
          stripAnsi: strip_ansi,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  terminal_session_id,
                  session_id: result.sessionId,
                  run_title: result.runTitle,
                  running: result.running,
                  exit_code: result.exitCode,
                  total_bytes: result.totalBytes,
                  dropped_bytes: result.droppedBytes,
                  output: result.output,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: String(e) }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // wait_for_terminal
  // -------------------------------------------------------------------------

  server.tool(
    "wait_for_terminal",
    "Block until a terminal session (typically one started via `trigger_run`) emits output matching `until_pattern`, exits, or hits `timeout_ms`. Use this for: waiting for a dev server's 'ready'/'compiled' line before navigating, waiting for a one-shot command (tests, build, codegen run via a configured run command) to finish, or simply blocking until a process dies. Returns the reason for unblocking (`match` | `exit` | `timeout`), the exit code if exited, and the captured output snapshot. The pattern is matched against ANSI-stripped output. If the pattern is already present in already-captured output when you call, it returns immediately.",
    {
      terminal_session_id: z
        .string()
        .describe(
          "Terminal session id returned by `trigger_run` (NOT the worktree session id).",
        ),
      until_pattern: z
        .string()
        .optional()
        .describe(
          "Regex tested against captured (ANSI-stripped) output. Common 'ready' patterns: `ready in \\d+`, `compiled successfully`, `Local:\\s+http`, `Listening on`, `Metro waiting`. Omit to wait purely for exit/timeout.",
        ),
      timeout_ms: z
        .number()
        .int()
        .optional()
        .describe(
          "Maximum time to block, in milliseconds. Defaults to 30000 (30s). Capped at 600000 (10 min). Resolves with `reason: 'timeout'` if neither match nor exit happens in time.",
        ),
    },
    async ({ terminal_session_id, until_pattern, timeout_ms }) => {
      try {
        const result = await waitForTerminal(terminal_session_id, {
          untilPattern: until_pattern,
          timeoutMs: timeout_ms,
        });
        // Trim to a reasonable tail so we don't blast 256KB of build output
        // into the agent's context on every wait. Callers who need more can
        // follow up with `read_terminal`.
        const TAIL = 16 * 1024;
        const tail =
          result.output.length > TAIL
            ? result.output.slice(result.output.length - TAIL)
            : result.output;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  terminal_session_id,
                  reason: result.reason,
                  exit_code: result.exitCode,
                  total_bytes: result.totalBytes,
                  dropped_bytes: result.droppedBytes,
                  output_tail: stripAnsi(tail),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: String(e) }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // check_conflicts
  // -------------------------------------------------------------------------

  server.tool(
    "check_conflicts",
    "Check whether a session's branch would conflict if merged into its base branch. Returns a list of conflicting files, or an empty list if the merge would be clean.",
    {
      session: z.string().describe("Session ID, branch name, or display name"),
    },
    async ({ session }) => {
      const ws = resolveSession(session);
      if (!ws) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Session not found: ${session}`,
            },
          ],
          isError: true,
        };
      }

      const conflicts = await getSessionConflicts(ws.id);

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
                      session_branch: ws.branch,
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
  // session_diff
  // -------------------------------------------------------------------------

  server.tool(
    "session_diff",
    'Return the git diff for a session\'s worktree so you can review what a child agent actually changed before merging. `scope: "branch"` (default) shows the full divergence vs the session\'s base branch — committed, staged, and unstaged together — and is what an orchestrator usually wants. Other scopes: `"unstaged"`, `"staged"`, `"head"` (staged + unstaged vs HEAD), `"untracked"` (synthetic diff for new files). Output is truncated to `max_bytes` (default 64KB) — pull a specific file with `read_session_file` for the full content.',
    {
      session: z
        .string()
        .describe("Session ID, branch name, or display name to diff"),
      scope: z
        .enum(["branch", "unstaged", "staged", "head", "untracked"])
        .optional()
        .describe(
          "Which diff to compute. Defaults to 'branch' (the full divergence vs base_branch).",
        ),
      max_bytes: z
        .number()
        .int()
        .optional()
        .describe(
          "Maximum bytes of diff to return. Defaults to 65536. Pass 0 for unbounded (use sparingly — large diffs blow out context).",
        ),
    },
    async ({ session, scope, max_bytes }) => {
      const ws = resolveSession(session);
      if (!ws) {
        return {
          content: [
            { type: "text" as const, text: `Session not found: ${session}` },
          ],
          isError: true,
        };
      }

      const chosen = scope ?? "branch";
      let diff: string;
      try {
        switch (chosen) {
          case "branch":
            diff = await getSessionBranchDiff(ws.id);
            break;
          case "unstaged":
            diff = await getSessionDiff(ws.id);
            break;
          case "staged":
            diff = await getSessionStagedDiff(ws.id);
            break;
          case "head":
            diff = await getSessionFullDiff(ws.id);
            break;
          case "untracked":
            diff = await getSessionUntrackedDiff(ws.id);
            break;
          default:
            diff = "";
        }
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: String(e) }],
          isError: true,
        };
      }

      const cap = max_bytes === undefined ? 65536 : Math.max(0, max_bytes);
      const truncated = cap > 0 && diff.length > cap;
      const body = truncated ? diff.slice(0, cap) : diff;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                session_id: ws.id,
                branch: ws.branch,
                base_branch: ws.base_branch,
                scope: chosen,
                total_bytes: diff.length,
                returned_bytes: body.length,
                truncated,
                diff: body,
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
  // list_session_changes
  // -------------------------------------------------------------------------

  server.tool(
    "list_session_changes",
    "List the files changed in a session's worktree (`git status --short`). Cheap, structured overview of what a child agent has touched — use before pulling full diffs or reading individual files. Returns parsed entries with index/worktree status codes (e.g. `M` modified, `A` added, `??` untracked, `D` deleted).",
    {
      session: z.string().describe("Session ID, branch name, or display name"),
    },
    async ({ session }) => {
      const ws = resolveSession(session);
      if (!ws) {
        return {
          content: [
            { type: "text" as const, text: `Session not found: ${session}` },
          ],
          isError: true,
        };
      }

      let raw: string;
      try {
        raw = await getSessionStatus(ws.id);
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: String(e) }],
          isError: true,
        };
      }

      const entries = raw
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => {
          // `git status --short` uses two leading status chars then a space
          // then the path. Renames look like "R  old -> new".
          const indexStatus = line.charAt(0);
          const worktreeStatus = line.charAt(1);
          const rest = line.slice(3);
          const arrow = rest.indexOf(" -> ");

          return arrow >= 0
            ? {
                index_status: indexStatus,
                worktree_status: worktreeStatus,
                path: rest.slice(arrow + 4),
                from_path: rest.slice(0, arrow),
              }
            : {
                index_status: indexStatus,
                worktree_status: worktreeStatus,
                path: rest,
              };
        });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                session_id: ws.id,
                branch: ws.branch,
                base_branch: ws.base_branch,
                changed_count: entries.length,
                changes: entries,
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
  // read_session_file
  // -------------------------------------------------------------------------

  server.tool(
    "read_session_file",
    "Read a file from a session's worktree. Use this to inspect a child agent's work in detail without spawning Bash or another agent — verify implementations, check generated configs, audit migrations, etc. The path must resolve inside the session's worktree (no traversal outside). Output is truncated to `max_bytes` (default 64KB).",
    {
      session: z.string().describe("Session ID, branch name, or display name"),
      file_path: z
        .string()
        .describe(
          "Path to the file. Either relative to the session worktree (e.g. 'src/index.ts') or an absolute path under the worktree.",
        ),
      max_bytes: z
        .number()
        .int()
        .optional()
        .describe(
          "Maximum bytes to return. Defaults to 65536. Pass 0 for unbounded.",
        ),
    },
    async ({ session, file_path, max_bytes }) => {
      const ws = resolveSession(session);
      if (!ws) {
        return {
          content: [
            { type: "text" as const, text: `Session not found: ${session}` },
          ],
          isError: true,
        };
      }

      const wtRoot = path.resolve(ws.path);
      const absRequested = path.isAbsolute(file_path)
        ? path.resolve(file_path)
        : path.resolve(wtRoot, file_path);

      const rel = path.relative(wtRoot, absRequested);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Refusing to read ${file_path}: resolved path is outside the session worktree.`,
            },
          ],
          isError: true,
        };
      }

      let stat;
      try {
        stat = fs.statSync(absRequested);
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: String(e) }],
          isError: true,
        };
      }
      if (stat.isDirectory()) {
        return {
          content: [
            {
              type: "text" as const,
              text: `${file_path} is a directory, not a file.`,
            },
          ],
          isError: true,
        };
      }

      const cap = max_bytes === undefined ? 65536 : Math.max(0, max_bytes);
      let content: string;
      try {
        content = fs.readFileSync(absRequested, "utf8");
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: String(e) }],
          isError: true,
        };
      }

      const truncated = cap > 0 && content.length > cap;
      const body = truncated ? content.slice(0, cap) : content;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                session_id: ws.id,
                branch: ws.branch,
                path: rel,
                total_bytes: content.length,
                returned_bytes: body.length,
                truncated,
                content: body,
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
  // merge_status
  // -------------------------------------------------------------------------

  server.tool(
    "merge_status",
    "Comprehensive merge-readiness report for a session. Returns ahead/behind commit counts vs the base branch, uncommitted/staged/untracked counts, predicted conflicts (from a `git merge-tree` dry-run), and whether the worktree is currently mid-merge or mid-rebase (with the conflicting file list). Use this before deciding whether to call `merge_session` (clean), `attempt_merge` (resumable), or `continue_merge` (resolve in-flight).",
    {
      session: z.string().describe("Session ID, branch name, or display name"),
    },
    async ({ session }) => {
      const ws = resolveSession(session);
      if (!ws) {
        return {
          content: [
            { type: "text" as const, text: `Session not found: ${session}` },
          ],
          isError: true,
        };
      }

      try {
        const status = await getSessionMergeStatus(ws.id);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  session_id: ws.id,
                  branch: ws.branch,
                  ...status,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: String(e) }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // attempt_merge
  // -------------------------------------------------------------------------

  server.tool(
    "attempt_merge",
    'Try to merge a session\'s branch into its base branch. On a clean rebase the merge completes (squash + fast-forward base) and returns `{ state: "merged" }`. If a conflict appears during the rebase the worktree is LEFT PAUSED with conflict markers in place — returns `{ state: "conflicted", conflicting_files: [...] }`. The orchestrator can then read each conflicted file via `read_session_file`, write a resolution via `write_session_file` (with `stage: true`), and call `continue_merge` to finish. Call `abort_merge` to give up and roll back. Use plain `merge_session` instead when you want clean-only behaviour that throws on conflict.',
    {
      session: z.string().describe("Session ID, branch name, or display name"),
    },
    async ({ session }) => {
      const ws = resolveSession(session);
      if (!ws) {
        return {
          content: [
            { type: "text" as const, text: `Session not found: ${session}` },
          ],
          isError: true,
        };
      }

      try {
        const result = await attemptSessionMerge(ws.id);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  session_id: ws.id,
                  branch: ws.branch,
                  base_branch: ws.base_branch,
                  ...result,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: String(e) }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // continue_merge
  // -------------------------------------------------------------------------

  server.tool(
    "continue_merge",
    'Continue an in-progress session merge after the orchestrator wrote conflict resolutions. Stages all worktree changes, runs `git rebase --continue` (or `git commit --no-edit` for a plain merge), and finalises with squash + fast-forward base on success. If git still reports unresolved conflicts the call returns `{ state: "conflicted", conflicting_files: [...] }` and the orchestrator can iterate. Returns `{ state: "no-merge-in-progress" }` if nothing is paused.',
    {
      session: z.string().describe("Session ID, branch name, or display name"),
    },
    async ({ session }) => {
      const ws = resolveSession(session);
      if (!ws) {
        return {
          content: [
            { type: "text" as const, text: `Session not found: ${session}` },
          ],
          isError: true,
        };
      }

      try {
        const result = await continueSessionMerge(ws.id);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  session_id: ws.id,
                  branch: ws.branch,
                  base_branch: ws.base_branch,
                  ...result,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: String(e) }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // abort_merge
  // -------------------------------------------------------------------------

  server.tool(
    "abort_merge",
    "Abort an in-progress merge or rebase, restoring the worktree to a clean state. No-op when nothing is paused. Use after `attempt_merge` returned `conflicted` and the orchestrator decides resolution is too risky to attempt automatically.",
    {
      session: z.string().describe("Session ID, branch name, or display name"),
    },
    async ({ session }) => {
      const ws = resolveSession(session);
      if (!ws) {
        return {
          content: [
            { type: "text" as const, text: `Session not found: ${session}` },
          ],
          isError: true,
        };
      }

      try {
        await abortSessionMerge(ws.id);

        return {
          content: [
            {
              type: "text" as const,
              text: `Aborted any in-progress merge/rebase in '${ws.branch}'.`,
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: String(e) }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // write_session_file
  // -------------------------------------------------------------------------

  server.tool(
    "write_session_file",
    "Write content to a file inside a session's worktree. Creates parent directories as needed. Path must resolve inside the worktree (no traversal). Set `stage: true` to also `git add` the file — required for the merge-conflict-resolution flow so the next `continue_merge` picks up the resolution. For ordinary editing inside an agent's own session, prefer spawning an agent or using `Edit/Write` tools — this is for orchestrator-level intervention (resolving a conflict in a child's worktree, dropping a config file, etc).",
    {
      session: z.string().describe("Session ID, branch name, or display name"),
      file_path: z
        .string()
        .describe(
          "Relative path inside the session worktree (e.g. 'src/foo.ts') or an absolute path under it.",
        ),
      content: z.string().describe("Full file content. Overwrites if exists."),
      stage: z
        .boolean()
        .optional()
        .describe(
          "Run `git add` on the file after writing. Defaults to false. Pass true when resolving a merge conflict so `continue_merge` picks up the resolution.",
        ),
    },
    async ({ session, file_path, content, stage }) => {
      const ws = resolveSession(session);
      if (!ws) {
        return {
          content: [
            { type: "text" as const, text: `Session not found: ${session}` },
          ],
          isError: true,
        };
      }

      try {
        const result = await writeSessionFile(
          ws.id,
          file_path,
          content,
          stage ?? false,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  session_id: ws.id,
                  branch: ws.branch,
                  ...result,
                  staged: stage ?? false,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: String(e) }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // merge_session
  // -------------------------------------------------------------------------

  server.tool(
    "merge_session",
    "Merge a session's branch into its base branch. Commits any staged changes first, checks for conflicts, then performs a --no-ff merge. The session's base branch was set when the worktree was created.",
    {
      session: z.string().describe("Session ID, branch name, or display name"),
    },
    async ({ session }) => {
      const ws = resolveSession(session);
      if (!ws) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Session not found: ${session}`,
            },
          ],
          isError: true,
        };
      }

      await mergeSessionIntoBase(ws.id);

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

  // -------------------------------------------------------------------------
  // complete_session
  // -------------------------------------------------------------------------

  server.tool(
    "complete_session",
    'Finish off a child session in one shot: clean-merge it into base, then delete the worktree (and optionally the branch). Throws on conflict — call `attempt_merge` + `continue_merge` first if you need to resolve. Use this for the happy-path "child finished, ship it" flow at the end of a fan-out.',
    {
      session: z.string().describe("Session ID, branch name, or display name"),
      delete_branch: z
        .boolean()
        .optional()
        .describe(
          "Also delete the merged branch (default: true — the branch is fully reachable from base after a successful merge so keeping it around is rarely useful).",
        ),
    },
    async ({ session, delete_branch }) => {
      const ws = resolveSession(session);
      if (!ws) {
        return {
          content: [
            { type: "text" as const, text: `Session not found: ${session}` },
          ],
          isError: true,
        };
      }
      const wsId = ws.id;
      const wsBranch = ws.branch;
      const baseBranch = ws.base_branch;

      try {
        await mergeSessionIntoBase(wsId);
      } catch (e) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Merge failed — session not deleted. ${String(e)}`,
            },
          ],
          isError: true,
        };
      }

      try {
        await deleteSession(wsId, delete_branch ?? true);
      } catch (e) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Merged into '${baseBranch}' but failed to delete session: ${String(e)}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                session_id: wsId,
                branch: wsBranch,
                base_branch: baseBranch,
                merged: true,
                deleted: true,
                branch_deleted: delete_branch ?? true,
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
  // list_organizations
  // -------------------------------------------------------------------------

  server.tool(
    "list_organizations",
    "List all user-defined organizations. An organization groups several repos/projects that collaborate on the same product (e.g. backend + frontend + mobile). Each org has a system prompt describing the product and a list of member repos with their roles. Use this to discover which repos are part of the same product and how work should be divided between them.",
    {},
    async () => {
      const orgs = listOrganizations();

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(orgs, null, 2) },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // create_organization
  // -------------------------------------------------------------------------

  server.tool(
    "create_organization",
    "Create a new organization grouping related repos. Organizations carry a system prompt shared by all member-repo agents and can host orchestrator agents that fan work out across repos. Returns the created organization including its generated id.",
    {
      name: z.string().describe("User-facing organization name."),
      description: z
        .string()
        .optional()
        .describe("Short description of the product/org."),
      system_prompt: z
        .string()
        .optional()
        .describe(
          "System prompt describing the overall product and how each repo fits in. Injected into all member-repo agents.",
        ),
      accent: z
        .string()
        .optional()
        .describe("Hex color used to visually group the org in the UI."),
      members: z
        .array(
          z.object({
            project_path: z
              .string()
              .describe("Absolute path to the member project root."),
            role: z
              .string()
              .describe(
                "What this project implements within the org (e.g. 'Backend API', 'iOS app').",
              ),
          }),
        )
        .optional()
        .describe("Member projects and their roles."),
    },
    async ({ name, description, system_prompt, accent, members }) => {
      const org = createOrganization({
        name,
        description,
        system_prompt,
        accent,
        members: members?.map((m) => ({
          repo_root: m.project_path,
          role: m.role,
        })),
      });

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(org, null, 2) },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // update_organization
  // -------------------------------------------------------------------------

  server.tool(
    "update_organization",
    "Update fields on an existing organization. Only provided fields are changed; omitted fields stay as-is. Pass `members` to fully replace the member list.",
    {
      id: z.string().describe("Organization id."),
      name: z.string().optional(),
      description: z.string().optional(),
      system_prompt: z.string().optional(),
      accent: z.string().optional(),
      members: z
        .array(
          z.object({
            project_path: z.string(),
            role: z.string(),
          }),
        )
        .optional(),
    },
    async ({ id, name, description, system_prompt, accent, members }) => {
      const org = updateOrganization(id, {
        name,
        description,
        system_prompt,
        accent,
        members: members?.map((m) => ({
          repo_root: m.project_path,
          role: m.role,
        })),
      });

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(org, null, 2) },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // delete_organization
  // -------------------------------------------------------------------------

  server.tool(
    "delete_organization",
    "Delete an organization. Member repos themselves are not removed — only the grouping is deleted.",
    { id: z.string().describe("Organization id.") },
    async ({ id }) => {
      deleteOrganization(id);

      return {
        content: [
          { type: "text" as const, text: `Deleted organization ${id}` },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // add_repo_to_organization
  // -------------------------------------------------------------------------

  server.tool(
    "add_repo_to_organization",
    "Add a project as a member of an organization, or update its role if already a member. The project is auto-registered.",
    {
      id: z.string().describe("Organization id."),
      project_path: z.string().describe("Absolute path to the project root."),
      role: z
        .string()
        .describe(
          "What this project implements within the org (e.g. 'Backend API').",
        ),
    },
    async ({ id, project_path, role }) => {
      const org = addRepoToOrganization(id, { repo_root: project_path, role });

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(org, null, 2) },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // remove_repo_from_organization
  // -------------------------------------------------------------------------

  server.tool(
    "remove_repo_from_organization",
    "Remove a project from an organization's member list. The project itself is not deleted.",
    {
      id: z.string().describe("Organization id."),
      project_path: z.string().describe("Absolute path to the project root."),
    },
    async ({ id, project_path }) => {
      const org = removeRepoFromOrganization(id, project_path);

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(org, null, 2) },
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
 * Start the Argus MCP server on a random localhost port.
 *
 * Returns the port number so it can be passed to agents via `--mcp-config`.
 */
export async function startMcpServer(): Promise<number> {
  if (httpServer) {
    throw new Error("MCP server is already running");
  }

  // Generate a fresh per-launch bearer token. Only spawned subprocesses learn
  // it (via env vars and --mcp-config headers); other local processes cannot.
  mcpAuthToken = crypto.randomBytes(32).toString("hex");

  // Track transports per session for proper lifecycle management.
  const transports = new Map<string, StreamableHTTPServerTransport>();

  httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost`);

    // All endpoints require the per-launch bearer token. This blocks any
    // unauthenticated local process (malicious npm postinstall, drive-by
    // browser fetch, etc.) from invoking MCP tools or the device resolver.
    if (!authorizeRequest(req, res)) {
      return;
    }

    // Lazy device resolver — called by the conductor shim the first time an
    // agent runs `conductor --device ios|web`. Acquires the device on demand
    // so agents that never use a given runtime don't pay for one.
    if (url.pathname === "/argus/acquire-device") {
      if (req.method !== "POST") {
        res.writeHead(405);
        res.end("Method Not Allowed");

        return;
      }
      try {
        const body = await readJsonBody(req);
        const agentId = String(body.agent_id ?? "");
        const platform = String(body.platform ?? "");
        if (!agentId || (platform !== "ios" && platform !== "web")) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: "agent_id and platform (ios|web) required",
            }),
          );

          return;
        }
        const agentEntry = appState.agents.get(agentId);
        if (!agentEntry) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: `Unknown agent: ${agentId}` }));

          return;
        }
        const session = appState.sessions.get(agentEntry.sessionId);
        if (!session) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Session not found for agent" }));

          return;
        }

        const deviceId =
          platform === "ios"
            ? await ensureSimulatorForAgent(agentId, session.repo_root)
            : await ensureWebBrowserForAgent(agentId);

        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ device_id: deviceId }));
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
        );
      }

      return;
    }

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
          if (sid) {
            transports.delete(sid);
          }
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

  // MCP tool calls can legitimately block for a long time (wait_for_agent,
  // send_agent_message, etc.). Disable Node's default 5 min requestTimeout
  // so long-polling responses don't get torn down mid-call.
  httpServer.requestTimeout = 0;
  httpServer.headersTimeout = 0;

  return new Promise((resolve, reject) => {
    httpServer!.listen(0, "127.0.0.1", () => {
      const addr = httpServer!.address();
      if (typeof addr === "object" && addr) {
        mcpPort = addr.port;
        info(`[mcp] Argus MCP server listening on 127.0.0.1:${mcpPort}`);
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
    mcpAuthToken = null;
    info("[mcp] Argus MCP server stopped");
  }
}

/** Get the port the MCP server is listening on, or null if not running. */
export function getMcpPort(): number | null {
  return mcpPort;
}

/**
 * Get the per-launch bearer token required for MCP requests, or null if the
 * server is not running. Pass this to spawned agent subprocesses only.
 */
export function getMcpAuthToken(): string | null {
  return mcpAuthToken;
}
