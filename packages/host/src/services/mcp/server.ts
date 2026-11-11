/**
 * Argus MCP server — exposes session and agent orchestration tools to
 * Claude Code agents via the Model Context Protocol (streamable HTTP).
 *
 * Runs an HTTP server on a random localhost port. The port is passed to agents
 * via `--mcp-config` when they are spawned.
 *
 * # Architecture
 *
 * The MCP server runs inside the host process and has direct access
 * to `appState` and all service functions. No proxy layer or IPC needed.
 */

import type { Session } from "../session/models";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { z } from "zod";
import { emitHostEvent } from "@argus/host/bus";
import { createLogger, info } from "@argus/host/logger";
import { appState } from "../../state";
import { resolveDeviceRefs } from "../agent/agentDevices";
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
import { forgetAutomationSession } from "../automation/ownedSessions";
import { sendPushNotification } from "../notifications/push";
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
  addRelatedProject,
  writeSessionFile,
} from "../session/sessionOps";
import { waitForSessionReady } from "../session/waitForReady";
import {
  createRunTerminal,
  findRunSession,
  readTerminalOutput,
  resolveRunCommand,
  startTerminal,
  stripAnsi,
  waitForTerminal,
} from "../terminal/multiplexer";
import { stopTerminalGracefully } from "../terminal/stop";
import { TOOL_IDS, type ToolId } from "../tools/types";
import { worktreePurposeForCaller } from "./automationCaller";
import {
  automationMergeBlock,
  automationSessionToolBlock,
  automationWorkBlock,
  recordAutomationSessionForCaller,
} from "./automationGuards";
import { registerAutomationTools } from "./automationTools";
import { registerIntegrationTools } from "./integrationTools";
import { findPastAgent, registerPastAgentTools } from "./pastAgentTools";
import { registerPrWatchTools } from "./prWatchTools";
import { isGitRepo, collectAllProjects } from "./projectDiscovery";
import { ensureRepoRegistered } from "./projects";
import { registerSessionListTools } from "./sessionListTools";
import {
  addMcpSession,
  closeAllMcpSessions,
  getMcpSession,
  hasMcpSession,
  removeMcpSession,
  SPAWN_ID_HEADER,
} from "./sessions";
import { ArgusTaskStore } from "./taskStore";
import { registerTaskTool } from "./taskTools";
import { localAgentHint, registerTranscriptTools } from "./transcriptTools";

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
 * Reusable required `project_path` argument for session-scoped tools. Agents
 * typically reference a session by branch or display name, neither of which is
 * unique across projects — the project scopes the lookup so a shared name
 * can't resolve to the wrong project's session.
 */
const sessionProjectPathArg = z
  .string()
  .describe(
    "Absolute path to the project root the session belongs to. Use the project_path from your system prompt for the current project, or a path from list_projects for another. Required: branch and display names are only unique within a project.",
  );

/**
 * Resolve a session by ID, branch name, or display name within a single
 * project. Agents typically know the branch name, not the UUID — `projectPath`
 * scopes the branch/display-name search so a name shared across projects
 * resolves unambiguously.
 */
/** Aliases for the project-root session, which has no stable display name. */
const ROOT_SESSION_ALIASES = new Set(["root", "project_root", "project-root"]);

/** Aliases for "wherever the calling agent already is" — root or worktree. */
const CURRENT_SESSION_ALIASES = new Set(["current", "here", "self"]);

/**
 * A session by id, branch, display name, path or alias. On a miss it lists the
 * project once first: a worktree an agent just made with `git worktree add`
 * isn't a session until a listing adopts it.
 */
async function resolveSession(
  idOrBranch: string,
  projectPath: string,
  callerAgentId: string | null = null,
): Promise<Session | null> {
  const known = findSession(idOrBranch, projectPath, callerAgentId);
  if (known) {
    return known;
  }
  await listSessions(projectPath, "mcp_lookup").catch(() => []);

  return findSession(idOrBranch, projectPath, callerAgentId);
}

function findSession(
  idOrBranch: string,
  projectPath: string,
  callerAgentId: string | null = null,
): Session | null {
  // "current" is the caller's own checkout, whatever kind it is. An agent in a
  // worktree gets that worktree, not the project root — the two are only the
  // same session for an agent that happens to be running in the root.
  if (CURRENT_SESSION_ALIASES.has(idOrBranch) && callerAgentId) {
    const sessionId = appState.agents.get(callerAgentId)?.sessionId;
    const own = sessionId ? appState.sessions.get(sessionId) : undefined;
    if (own && own.repo_root === projectPath) {
      return own;
    }
  }

  // "root" addresses the checkout the user has open, so callers can delegate
  // into it without knowing its branch or inventing a worktree.
  if (ROOT_SESSION_ALIASES.has(idOrBranch)) {
    const root = [...appState.sessions.values()].find(
      (ws) => ws.repo_root === projectPath && ws.kind === "project_root",
    );
    if (root) {
      return root;
    }
  }

  // Try by ID first — session IDs are UUIDs. Validate it belongs to the
  // given project so a stale/cross-project ID surfaces as an error rather
  // than acting on the wrong project.
  const byId = appState.sessions.get(idOrBranch);
  if (byId) {
    if (byId.repo_root !== projectPath) {
      throw new Error(
        `Session "${idOrBranch}" belongs to project ${byId.repo_root}, not ${projectPath}. Pass the matching project_path.`,
      );
    }

    return byId;
  }

  const inProject = [...appState.sessions.values()].filter(
    (ws) => ws.repo_root === projectPath,
  );

  // Search by branch name — unique within a project.
  const byBranch = inProject.find((ws) => ws.branch === idOrBranch);
  if (byBranch) {
    return byBranch;
  }

  // Search by display_name, then by the worktree's path.
  const byName = inProject.find((ws) => ws.display_name === idOrBranch);
  if (byName) {
    return byName;
  }

  return (
    inProject.find(
      (ws) => ws.path && path.resolve(ws.path) === path.resolve(idOrBranch),
    ) ?? null
  );
}

/**
 * Wait for a session to finish initializing, then start a Claude Code agent
 * in it and dispatch the initial prompt. Shared by `create_session` (when a
 * prompt is supplied), `spawn_agent`, and `spawn_agents_batch`.
 *
 * Returns the spawned agent info on success. Throws on session-ready timeout
 * or agent startup failure — callers translate that into MCP error content.
 */
const devicesArg = z
  .array(z.string())
  .optional()
  .describe(
    "Devices to hand this agent for the run — simulator UDIDs or names, Android serials (from `conductor list-devices`). Its system prompt lists them and no other agent gets them; use it for a device matrix such as an iPhone plus an iPad instead of naming UDIDs in the prompt.",
  );

const toolsArg = z
  .object({ disabled: z.array(z.enum(TOOL_IDS)).optional() })
  .optional()
  .describe(
    'Tool profile for this agent: `{ disabled: ["device-control"] }` runs it without devices — no device guide in its prompt, `conductor` and `design_compare` refused. On top of the app and project Tools settings, which it can only narrow.',
  );

async function spawnAgentInSession(
  sessionId: string,
  prompt: string,
  opts: {
    images?: ReturnType<typeof resolveAttachments>;
    model?: string;
    permission_mode?:
      | "acceptEdits"
      | "auto"
      | "bypassPermissions"
      | "default"
      | "plan";
    platforms?: ("android" | "ios" | "web")[];
    parentAgentId?: string;
    resumeSessionId?: string;
    runnerId?: string;
    /** UDIDs, serials or names to hand the agent besides its pool simulator. */
    devices?: string[];
    /** Tools off for this agent only, on top of the app and project masks. */
    tools?: { disabled?: ToolId[] };
    sourceTool: "create_session" | "spawn_agent" | "spawn_agents_batch";
  },
): Promise<{
  agent_id: string;
  session_id: string;
  status: string;
  parent_agent_id?: string;
}> {
  await waitForSessionReady(sessionId);
  const disabledTools = opts.tools?.disabled ?? [];
  if (disabledTools.includes("device-control") && opts.devices?.length) {
    throw "Pass `devices` or turn `device-control` off, not both.";
  }
  const devices = await resolveDeviceRefs(opts.devices ?? []);
  const profile =
    devices.length > 0 || disabledTools.length > 0
      ? {
          ...(devices.length > 0 ? { devices } : {}),
          ...(disabledTools.length > 0 ? { disabledTools } : {}),
        }
      : undefined;

  const agentInfo = await startAgent(
    sessionId,
    opts.model,
    opts.permission_mode,
    opts.resumeSessionId,
    undefined,
    opts.platforms,
    opts.parentAgentId,
    undefined,
    undefined,
    opts.runnerId,
    true,
    profile,
  );

  emitHostEvent("agent:started", {
    agent_id: agentInfo.agent_id,
    session_id: agentInfo.session_id,
    status: agentInfo.status,
    permission_mode: opts.permission_mode,
    parent_agent_id: agentInfo.parent_agent_id,
    created_at: agentInfo.created_at,
    initial_prompt: prompt,
    model: agentInfo.model,
  });

  sendAgentMessage(agentInfo.agent_id, prompt, opts.images);

  emitMcpSystemMessage(agentInfo.agent_id, {
    tool: opts.sourceTool,
    message: prompt,
    images: opts.images,
    parentAgentId: opts.parentAgentId,
  });

  return {
    agent_id: agentInfo.agent_id,
    session_id: agentInfo.session_id,
    status: agentInfo.status,
    parent_agent_id: agentInfo.parent_agent_id ?? undefined,
  };
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

/**
 * Resolve the project_path for a call. Falls back to the sole registered
 * project when exactly one is registered; otherwise requires the caller to
 * pass `project_path` explicitly so cross-project agents can't silently
 * receive another project's data.
 */
function resolveRepoRoot(projectPath?: string): string {
  if (projectPath) {
    return projectPath;
  }
  if (appState.repoRoots.size === 0) {
    throw new Error("No projects registered");
  }
  if (appState.repoRoots.size > 1) {
    throw new Error(
      "Multiple projects are registered — pass `project_path` explicitly. Use `list_projects` to see available paths.",
    );
  }

  return appState.repoRoots.values().next().value as string;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/**
 * Build an MCP server bound to a single agent connection.
 *
 * `callerAgentId` is the agent that owns this connection — read from the
 * `X-Argus-Agent-Id` header on the connection's first request and fixed for
 * its lifetime. Tools that record a parent relationship (`spawn_agent`,
 * `spawn_agents_batch`, `create_session`, `send_agent_message`) default
 * `parent_agent_id` to it, so an agent's spawns are attributed to it without
 * the agent having to know (or pass) its own ID. An explicit `parent_agent_id`
 * argument still wins.
 *
 * Exported for testing via InMemoryTransport (call with no caller).
 */
export function createMcpServer(
  callerAgentId: string | null = null,
): McpServer {
  const taskStore = new ArgusTaskStore();
  const server = new McpServer(
    { name: "argus", version: "1.0.0" },
    {
      capabilities: {
        tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } },
      },
      taskStore,
    },
  );
  server.server.onclose = () => taskStore.clear();

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
    "Add a related project to a project's configuration (stored by Argus on this machine, layered over any checked-in .argus.json). Use this when you discover that work on your current project requires changes in another project that isn't yet listed as related.",
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

      addRelatedProject(repoRoot, { path: relativePath, description });

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
    "Create a new isolated git worktree session. Returns the session ID and branch name. Only needed when work must be isolated from the user's checkout — to run an agent on the current branch, skip this and call `spawn_agent` with `session: \"root\"`. The session is initialized with the project's setup pipeline (dependency installs, symlinks, etc.) in the background. Pass `prompt` to also spawn an agent with that prompt as soon as setup completes — equivalent to a follow-up `spawn_agent` call but lets you do it in one round-trip. Requires project_path — use the path from your system prompt for the current project, or a path from list_projects for another project. The project will be auto-registered if needed.",
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
      prompt: z
        .string()
        .optional()
        .describe(
          "If provided, also spawn an agent in the new session with this initial prompt — combining `create_session` and `spawn_agent` in one call. The call blocks until the worktree's setup pipeline completes and the agent has been started. Returned payload then includes `agent_id`. Omit if you want a session without an agent (rare for orchestrators).",
        ),
      permission_mode: z
        .enum(["default", "auto", "acceptEdits", "bypassPermissions", "plan"])
        .optional()
        .describe(
          "Permission mode for the spawned agent. Ignored when `prompt` is omitted. See spawn_agent for values.",
        ),
      model: z
        .string()
        .optional()
        .describe(
          "Optional model id override for the spawned agent. Ignored when `prompt` is omitted. See spawn_agent.",
        ),
      platforms: z
        .array(z.enum(["ios", "android", "web"]))
        .optional()
        .describe(
          "Runtime platforms for the spawned agent. Ignored when `prompt` is omitted. See spawn_agent.",
        ),
      devices: devicesArg,
      tools: toolsArg,
      parent_agent_id: z
        .string()
        .optional()
        .describe(
          "Optional override for the parent agent id. Defaults to the calling agent automatically. Ignored when `prompt` is omitted.",
        ),
      attachments: z
        .array(mcpAttachmentSchema)
        .optional()
        .describe(
          "Attachments to forward to the spawned agent's first message. Ignored when `prompt` is omitted. See spawn_agent.attachments.",
        ),
    },
    async ({
      name,
      description,
      project_path,
      base_branch,
      prompt,
      permission_mode,
      model,
      platforms,
      devices,
      tools,
      parent_agent_id,
      attachments,
    }) => {
      const repoRoot = project_path;

      // An automation run below `draft` may not create work, whatever its
      // playbook says. Same check as `emit_proposal`, different door.
      const blocked = automationWorkBlock(callerAgentId, repoRoot);
      if (blocked) {
        return {
          content: [{ type: "text" as const, text: blocked }],
          isError: true,
        };
      }

      // Auto-register the repo root if targeting a cross-project session.
      const isNew = !appState.repoRoots.has(repoRoot);
      ensureRepoRegistered(repoRoot);
      if (isNew) {
        emitHostEvent("project:added", repoRoot);
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
        undefined,
        { worktreePurpose: worktreePurposeForCaller(callerAgentId) },
      );

      // An automation's own session: it holds one of its concurrency slots
      // until it is merged away, and the shell guard recognises it as the
      // automation's.
      recordAutomationSessionForCaller(callerAgentId, ws.id);

      // Notify the renderer so the sidebar updates immediately.
      emitHostEvent("session:created", {
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

      let agentResult:
        | { agent_id: string; status: string; parent_agent_id?: string }
        | undefined;
      if (prompt !== undefined) {
        let images;
        try {
          images = resolveAttachments(attachments);
        } catch (e) {
          return {
            content: [{ type: "text" as const, text: (e as Error).message }],
            isError: true,
          };
        }

        try {
          agentResult = await spawnAgentInSession(ws.id, prompt, {
            images,
            model,
            permission_mode,
            platforms,
            devices,
            tools,
            parentAgentId: parent_agent_id ?? callerAgentId ?? undefined,
            sourceTool: "create_session",
          });
        } catch (e) {
          return {
            content: [{ type: "text" as const, text: String(e) }],
            isError: true,
          };
        }
      }

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
                ...(agentResult
                  ? {
                      agent_id: agentResult.agent_id,
                      agent_status: agentResult.status,
                      parent_agent_id: agentResult.parent_agent_id,
                    }
                  : {}),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  registerSessionListTools(server, resolveRepoRoot);

  // -------------------------------------------------------------------------
  // delete_session
  // -------------------------------------------------------------------------

  server.tool(
    "delete_session",
    "Delete a session (git worktree). Kills any running agent and terminals, removes the worktree from disk.",
    {
      session: z.string().describe("Session ID, branch name, or display name"),
      project_path: sessionProjectPathArg,
      delete_branch: z
        .boolean()
        .optional()
        .describe("Also delete the git branch (default: false)"),
    },
    async ({ session, project_path, delete_branch }) => {
      const ws = await resolveSession(session, project_path, callerAgentId);
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
      const blocked = automationSessionToolBlock(
        callerAgentId,
        ws,
        "delete_session",
      );
      if (blocked) {
        return {
          content: [{ type: "text" as const, text: blocked }],
          isError: true,
        };
      }

      const wsId = ws.id;
      const wsName = ws.display_name ?? ws.branch;
      await deleteSession(wsId, delete_branch ?? false);
      forgetAutomationSession(wsId);

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
    'Start a new Claude Code agent in a session. The agent runs as an independent process with its own conversation. The parent-child relationship is tracked automatically (the spawn is attributed to you), so you don\'t need to pass parent_agent_id.\n\nThis does NOT create a worktree — it runs the agent in a session that already exists. Pass `session: "current"` to run it in YOUR OWN checkout, whichever that is: if you are in a worktree the child joins that worktree, and only if you are the root agent does it mean the project root. Decide by whether the work is related to yours — a piece of the task you are already doing, or something touching the same code, belongs in your session where the child can see what you have already done and needs no merge afterwards.\n\nSpawn into a fresh worktree instead when the work is unrelated to what your session is for — a different feature, a separate bug, anything that would muddy your branch or that the user will want to review and merge on its own. Create it with `create_session` (optionally with a `prompt` to spawn in one round-trip), or `spawn_agents_batch` for several.\n\nThis call blocks internally until the session is ready — it will not return early with an `initializing` status, so do not poll/retry just because the session is freshly created.',
    {
      session: z
        .string()
        .describe(
          'Which session to run the agent in. `"current"` is your own checkout — your worktree if you are in one, the project root if you are the root agent. `"root"` is always the project root specifically. Otherwise a session ID, branch name, or display name. Prefer `"current"` for work related to your own task; use a fresh session for unrelated work.',
        ),
      project_path: sessionProjectPathArg,
      prompt: z
        .string()
        .describe(
          "Initial message/instructions to send to the agent. When resuming, this is the next message in its restored conversation — e.g. tell it to carry on where it stopped.",
        ),
      resume: z
        .string()
        .optional()
        .describe(
          "Continue a past agent instead of starting a fresh one: the `resume` value from `list_past_agents`. The new agent gets the old one's full conversation, runs on the same runner, and is attributed to you. Run it in the session it worked in.",
        ),
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
      devices: devicesArg,
      tools: toolsArg,
      parent_agent_id: z
        .string()
        .optional()
        .describe(
          "Optional override for the parent agent id. Defaults to the calling agent automatically, so you normally don't need to set this — only pass it to attribute the spawn to a different agent. Used for tracking the parent-child relationship in the UI and for cascade cleanup.",
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
      project_path,
      prompt,
      resume,
      permission_mode,
      model,
      platforms,
      devices,
      tools,
      parent_agent_id,
      attachments,
    }) => {
      const ws = await resolveSession(session, project_path, callerAgentId);
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

      const blocked = automationWorkBlock(callerAgentId, ws.repo_root);
      if (blocked) {
        return {
          content: [{ type: "text" as const, text: blocked }],
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

      const past = resume ? findPastAgent(ws.repo_root, resume) : null;
      if (resume && !past) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No past agent found for "${resume}". Use a \`resume\` value from list_past_agents.`,
            },
          ],
          isError: true,
        };
      }
      const liveAgent = past?.agentId
        ? appState.agents.get(past.agentId)
        : undefined;
      if (
        liveAgent &&
        liveAgent.status !== "stopped" &&
        liveAgent.status !== "error"
      ) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Agent ${past?.agentId} is still running — use send_agent_message instead.`,
            },
          ],
          isError: true,
        };
      }

      let agentResult;
      try {
        agentResult = await spawnAgentInSession(ws.id, prompt, {
          images,
          model,
          permission_mode,
          platforms,
          devices,
          tools,
          parentAgentId: parent_agent_id ?? callerAgentId ?? undefined,
          resumeSessionId: past?.sessionId,
          runnerId: past?.runnerId,
          sourceTool: "spawn_agent",
        });
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: String(e) }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                agent_id: agentResult.agent_id,
                session_id: ws.id,
                branch: ws.branch,
                status: agentResult.status,
                parent_agent_id: agentResult.parent_agent_id,
                ...(past ? { resumed_from: past.agentId ?? resume } : {}),
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
    'Create multiple ISOLATED sessions and spawn agents in them in parallel. Each entry creates a new git worktree on its own branch and starts an agent there.\n\nUse this only when the agents genuinely need separate checkouts — parallel attempts at the same files, or work that must not touch the user\'s working tree. To run several agents against the checkout the user already has open, call `spawn_agent` with `session: "root"` once per agent instead; that is the usual meaning of "spawn some agents" and it needs no worktree. Agents sharing the root session see each other\'s edits, so give them non-overlapping files. Agents may target different projects — set `project_path` per-agent to spawn across projects in one call. Much more efficient than sequential create_session + spawn_agent calls. Returns all agent IDs at once after each session has finished provisioning. If your MCP transport drops mid-call, sessions may already exist while their agents are still being started server-side; treat absent agents as "not yet visible" rather than "failed" and verify by polling `list_sessions` (status → ready) and `list_agents` for ~30s before respawning.',
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
            devices: devicesArg,
            tools: toolsArg,
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
        .describe(
          "Optional override for the parent agent id. Defaults to the calling agent automatically; only set it to attribute these spawns to a different agent.",
        ),
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

      for (const rr of resolvedRepoRoots) {
        const blocked = automationWorkBlock(callerAgentId, rr);
        if (blocked) {
          return {
            content: [{ type: "text" as const, text: blocked }],
            isError: true,
          };
        }
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
          emitHostEvent("project:added", rr);
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
            undefined,
            { worktreePurpose: worktreePurposeForCaller(callerAgentId) },
          );

          // `createSession` already broadcasts `session:created`, so don't
          // re-emit here.
          recordAutomationSessionForCaller(callerAgentId, ws.id);

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
          const agentResult = await spawnAgentInSession(ws.id, spec.prompt, {
            images,
            model: spec.model,
            permission_mode,
            platforms: spec.platforms,
            devices: spec.devices,
            tools: spec.tools,
            parentAgentId: parent_agent_id ?? callerAgentId ?? undefined,
            sourceTool: "spawn_agents_batch",
          });

          results.push({
            agent_id: agentResult.agent_id,
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
    "List all running agents across the project's sessions, or for a specific session. Agents that stopped or were lost to an app restart are not here — use `list_past_agents` to find and resume those. Note: an agent only appears here once its session has finished initializing and the agent process has actually started. If you just called `create_session` or `spawn_agents_batch`, the worktree may still be running setup (`git worktree add`, dependency installs, etc.) — during that window the session exists but `list_agents` will show nothing for it. Empty results immediately after a spawn do **not** mean the spawn failed; cross-check with `list_sessions` and look at each session's `status`. Sessions in `initializing` will spawn their queued agent automatically once ready.",
    {
      project_path: sessionProjectPathArg,
      session: z
        .string()
        .optional()
        .describe(
          "Optional session ID, branch name, or display name to filter by. Omit to list every agent in the project.",
        ),
    },
    async ({ project_path, session }) => {
      let agents;
      if (session) {
        const ws = await resolveSession(session, project_path, callerAgentId);
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
        // Collect agents across every session in the project.
        agents = [];
        for (const ws of appState.sessions.values()) {
          if (ws.repo_root === project_path) {
            agents.push(...listAgents(ws.id));
          }
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
    "Get the result summary of a completed agent. Returns the final output, cost, and duration from the agent's last conversation turn. Available once the agent has finished a turn (status: stopped, error, or idle after completing at least one turn).",
    {
      agent_id: z.string().describe("The agent ID returned by spawn_agent"),
    },
    async ({ agent_id }) => {
      const session = appState.agents.get(agent_id);
      if (!session) {
        return {
          content: [
            {
              type: "text" as const,
              text: localAgentHint(agent_id) ?? `Agent not found: ${agent_id}`,
            },
          ],
          isError: true,
        };
      }

      // Result is available once the process has exited (stopped/error) or the
      // agent has finished a turn while still alive (idle with turnsCompleted > 0).
      // Mirror the gate in waitForAgent so a finished-but-alive agent isn't blocked.
      const finishedTurn =
        session.status === "idle" && session.turnsCompleted > 0;
      if (
        session.status !== "stopped" &&
        session.status !== "error" &&
        !finishedTurn
      ) {
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

  registerTaskTool(server, taskStore, {
    name: "wait_for_agent",
    description:
      "Block until a spawned agent finishes its current turn (becomes idle) or exits, then return its status and latest result summary. Returns immediately if the agent is already idle, stopped, or errored. Use this instead of polling agent_status in a loop.",
    shape: {
      agent_id: z.string().describe("The agent ID returned by spawn_agent"),
      timeout_seconds: z
        .number()
        .optional()
        .describe(
          "Maximum seconds to wait before timing out. Defaults to no timeout (wait indefinitely).",
        ),
    },
    progress: ({ agent_id }) => `waiting for agent ${agent_id}`,
    run: async ({ agent_id, timeout_seconds }) => {
      const hint = !appState.agents.has(agent_id)
        ? localAgentHint(agent_id)
        : null;
      if (hint) {
        return {
          content: [{ type: "text" as const, text: hint }],
          isError: true,
        };
      }

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
      }
    },
  });

  // -------------------------------------------------------------------------
  // wait_for_any_agent
  // -------------------------------------------------------------------------

  registerTaskTool(server, taskStore, {
    name: "wait_for_any_agent",
    description:
      "Block until the FIRST of several agents finishes its current turn or exits, then return which one settled along with its status and result. Use this when you've fanned out to multiple children and want to react as soon as any one of them is ready — `wait_for_agent` only watches a single agent and would force you to pick one to block on. Returns immediately if any of the listed agents is already idle/stopped/errored.",
    shape: {
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
    progress: ({ agent_ids }) =>
      `waiting for any of ${agent_ids.length} agents`,
    run: async ({ agent_ids, timeout_seconds }) => {
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
      }
    },
  });

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
          "Optional override for the sender agent id, shown in the recipient's UI. Defaults to the calling agent automatically.",
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
        parentAgentId: parent_agent_id ?? callerAgentId ?? undefined,
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
  // list_run_commands
  // -------------------------------------------------------------------------

  server.tool(
    "list_run_commands",
    "List the run commands configured in a session's .argus.json. Use this to discover what `trigger_run` can launch (dev server, watcher, test runner, etc.) before deciding whether to start a runtime — the user has likely already configured the right command. Returns each entry's title, shell command, working dir, and restart-on-rerun flag.",
    {
      session: z.string().describe("Session ID, branch name, or display name"),
      project_path: sessionProjectPathArg,
    },
    async ({ session, project_path }) => {
      const ws = await resolveSession(session, project_path, callerAgentId);
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
                      ? "No run commands configured. Ask the user to add one in Project Settings rather than spawning a dev server via Bash."
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
    "Start (or restart) one of the project's configured run commands from .argus.json — its dev server, watcher, test runner, simulator boot script, etc. ALWAYS use this instead of running `npm run dev`, `pnpm start`, `expo start`, `bun run`, `next dev`, `vite`, `cargo run`, `python manage.py runserver`, or any equivalent long-running process via the Bash tool. The user already has the runtime open in the Argus UI on the project's configured port; spawning your own copy from Bash collides on that port, fragments output the user can't see, and leaves orphaned processes. The command runs in a visible UI terminal the user can inspect. Pass `title` to pick a specific entry; omit to run the first configured command. If you don't know what's configured, call `list_run_commands` first. Returns a `terminal_session_id` — pair it with `wait_for_terminal` (block until a 'ready' regex appears or the process exits) and `read_terminal` (snapshot captured output) to observe the run, and `stop_terminal` to shut it down.",
    {
      session: z.string().describe("Session ID, branch name, or display name"),
      project_path: sessionProjectPathArg,
      title: z
        .string()
        .optional()
        .describe(
          "Title of the run command from .argus.json. Defaults to the first entry.",
        ),
    },
    async ({ session, project_path, title }) => {
      const ws = await resolveSession(session, project_path, callerAgentId);
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

      const blocked = automationSessionToolBlock(
        callerAgentId,
        ws,
        "trigger_run",
      );
      if (blocked) {
        return {
          content: [{ type: "text" as const, text: blocked }],
          isError: true,
        };
      }

      try {
        const result = await createRunTerminal(ws.id, title);
        // Boot the primary terminal plus every auto-spawned dependency so
        // their PTYs actually start producing output — `createRunTerminal`
        // only allocates the sessions.
        for (const dep of result.dependencies) {
          startTerminal(dep.sessionId, 120, 40);
        }
        startTerminal(result.sessionId, 120, 40);

        // Surface the run in the bottom terminal panel as if the user had
        // pressed the Run button themselves: the renderer subscribes to this
        // event and registers tabs / opens the panel for `ws.id`.
        emitHostEvent("run:triggered", {
          sessionId: ws.id,
          title: result.title,
          terminalSessionId: result.sessionId,
          dependencies: result.dependencies.map((d) => ({
            sessionId: d.sessionId,
            title: d.title,
          })),
        });

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
  // stop_terminal
  // -------------------------------------------------------------------------

  server.tool(
    "stop_terminal",
    "Stop a running terminal — typically a dev server or watcher started with `trigger_run` — the way Ctrl-C in that terminal would. ALWAYS use this instead of finding PIDs with `lsof`/`ps` and sending `kill` from Bash: Argus sends SIGINT to the terminal's foreground process group (so wrappers like `pnpm` → `turbo` → `vite` all get it), escalates to SIGTERM and then SIGKILL on the whole process tree if it doesn't exit, and keeps the UI terminal in sync. Killing processes yourself leaves the UI showing a run that is gone, and can miss children that then hold the port. Identify the run by `terminal_session_id`, or by `session` + `project_path` (+ optional `title`, defaulting to the first configured run command). Blocks until the run has exited; returns whether it stopped, the exit code or signal, which escalation step (`SIGINT` | `SIGTERM` | `SIGKILL`) finished it, and the output tail. A later `trigger_run` of the same title starts a fresh copy.",
    {
      terminal_session_id: z
        .string()
        .optional()
        .describe(
          "Terminal session id returned by `trigger_run` (NOT the worktree session id). Takes precedence over `session` / `title`.",
        ),
      session: z
        .string()
        .optional()
        .describe(
          "Session ID, branch name, or display name whose run to stop. Use with `project_path` when you don't have the terminal session id.",
        ),
      project_path: sessionProjectPathArg.optional(),
      title: z
        .string()
        .optional()
        .describe(
          "Title of the run command from .argus.json. Defaults to the first entry. Only used with `session`.",
        ),
      grace_ms: z
        .number()
        .int()
        .optional()
        .describe(
          "How long to wait after each signal before escalating (SIGINT → SIGTERM → SIGKILL). Defaults to 3000. Capped at 30000.",
        ),
      tail_bytes: z
        .number()
        .int()
        .optional()
        .describe(
          "Return only the last N bytes of captured output. Defaults to ~16KB. Pass 0 for the full capture.",
        ),
    },
    async ({
      terminal_session_id,
      session,
      project_path,
      title,
      grace_ms,
      tail_bytes,
    }) => {
      const fail = (text: string) => ({
        content: [{ type: "text" as const, text }],
        isError: true,
      });

      let terminalId: string;
      let ws = null;
      if (terminal_session_id) {
        terminalId = terminal_session_id;
        const terminal = appState.terminals.get(terminalId);
        if (!terminal) {
          return fail(`Terminal session not found: ${terminalId}`);
        }
        ws = appState.sessions.get(terminal.sessionId) ?? null;
      } else {
        if (!session || !project_path) {
          return fail(
            "Pass `terminal_session_id`, or `session` + `project_path` (and optionally `title`).",
          );
        }
        ws = await resolveSession(session, project_path, callerAgentId);
        if (!ws) {
          return fail(`Session not found: ${session}`);
        }
        let runTitle: string;
        try {
          runTitle = title ?? resolveRunCommand(ws.id).title;
        } catch (e) {
          return fail(String(e));
        }
        const running = findRunSession(ws.id, runTitle);
        if (!running) {
          return fail(
            `No running '${runTitle}' terminal in session ${ws.display_name || ws.branch}. Nothing to stop.`,
          );
        }
        terminalId = running.id;
      }

      if (ws) {
        const blocked = automationSessionToolBlock(
          callerAgentId,
          ws,
          "stop_terminal",
        );
        if (blocked) {
          return fail(blocked);
        }
      }

      try {
        const outcome = await stopTerminalGracefully(
          terminalId,
          "mcp",
          grace_ms,
        );
        const result = readTerminalOutput(terminalId, {
          tailBytes: tail_bytes,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  terminal_session_id: terminalId,
                  session_id: result.sessionId,
                  run_title: result.runTitle,
                  stopped: outcome.stopped,
                  already_exited: outcome.alreadyExited,
                  step: outcome.step,
                  running: result.running,
                  exit_code: outcome.exitCode,
                  exit_signal: outcome.exitSignal,
                  surviving_pids: outcome.survivors,
                  total_bytes: result.totalBytes,
                  dropped_bytes: result.droppedBytes,
                  output: result.output,
                },
                null,
                2,
              ),
            },
          ],
          ...(outcome.stopped ? {} : { isError: true }),
        };
      } catch (e) {
        return fail(String(e));
      }
    },
  );

  // -------------------------------------------------------------------------
  // wait_for_terminal
  // -------------------------------------------------------------------------

  registerTaskTool(server, taskStore, {
    name: "wait_for_terminal",
    description:
      "Block until a terminal session (typically one started via `trigger_run`) emits output matching `until_pattern`, exits, or hits `timeout_ms`. Use this for: waiting for a dev server's 'ready'/'compiled' line before navigating, waiting for a one-shot command (tests, build, codegen run via a configured run command) to finish, or simply blocking until a process dies. Returns the reason for unblocking (`match` | `exit` | `timeout`), the exit code if exited, and the captured output snapshot. The pattern is matched against ANSI-stripped output. If the pattern is already present in already-captured output when you call, it returns immediately.",
    shape: {
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
    run: async ({ terminal_session_id, until_pattern, timeout_ms }) => {
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
  });

  // -------------------------------------------------------------------------
  // check_conflicts
  // -------------------------------------------------------------------------

  server.tool(
    "check_conflicts",
    "Check whether a session's branch would conflict if merged into its base branch. Returns a list of conflicting files, or an empty list if the merge would be clean.",
    {
      session: z.string().describe("Session ID, branch name, or display name"),
      project_path: sessionProjectPathArg,
    },
    async ({ session, project_path }) => {
      const ws = await resolveSession(session, project_path, callerAgentId);
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
      project_path: sessionProjectPathArg,
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
    async ({ session, project_path, scope, max_bytes }) => {
      const ws = await resolveSession(session, project_path, callerAgentId);
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
      project_path: sessionProjectPathArg,
    },
    async ({ session, project_path }) => {
      const ws = await resolveSession(session, project_path, callerAgentId);
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
      project_path: sessionProjectPathArg,
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
    async ({ session, project_path, file_path, max_bytes }) => {
      const ws = await resolveSession(session, project_path, callerAgentId);
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
      project_path: sessionProjectPathArg,
    },
    async ({ session, project_path }) => {
      const ws = await resolveSession(session, project_path, callerAgentId);
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
      project_path: sessionProjectPathArg,
    },
    async ({ session, project_path }) => {
      const ws = await resolveSession(session, project_path, callerAgentId);
      if (!ws) {
        return {
          content: [
            { type: "text" as const, text: `Session not found: ${session}` },
          ],
          isError: true,
        };
      }

      const mergeBlocked = await automationMergeBlock(callerAgentId, ws);
      if (mergeBlocked) {
        return {
          content: [{ type: "text" as const, text: mergeBlocked }],
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
      project_path: sessionProjectPathArg,
    },
    async ({ session, project_path }) => {
      const ws = await resolveSession(session, project_path, callerAgentId);
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
      project_path: sessionProjectPathArg,
    },
    async ({ session, project_path }) => {
      const ws = await resolveSession(session, project_path, callerAgentId);
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
      project_path: sessionProjectPathArg,
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
    async ({ session, project_path, file_path, content, stage }) => {
      const ws = await resolveSession(session, project_path, callerAgentId);
      if (!ws) {
        return {
          content: [
            { type: "text" as const, text: `Session not found: ${session}` },
          ],
          isError: true,
        };
      }

      const blocked = automationSessionToolBlock(
        callerAgentId,
        ws,
        "write_session_file",
      );
      if (blocked) {
        return {
          content: [{ type: "text" as const, text: blocked }],
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

  registerTaskTool(server, taskStore, {
    name: "merge_session",
    description:
      "Merge a session's branch into its base branch. Commits any staged changes first, checks for conflicts, then performs a --no-ff merge. The session's base branch was set when the worktree was created.",
    shape: {
      session: z.string().describe("Session ID, branch name, or display name"),
      project_path: sessionProjectPathArg,
    },
    run: async ({ session, project_path }) => {
      const ws = await resolveSession(session, project_path, callerAgentId);
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

      const mergeBlocked = await automationMergeBlock(callerAgentId, ws);
      if (mergeBlocked) {
        return {
          content: [{ type: "text" as const, text: mergeBlocked }],
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
  });

  // -------------------------------------------------------------------------
  // complete_session
  // -------------------------------------------------------------------------

  registerTaskTool(server, taskStore, {
    name: "complete_session",
    description:
      'Finish off a child session in one shot: clean-merge it into base, then delete the worktree (and optionally the branch). Throws on conflict — call `attempt_merge` + `continue_merge` first if you need to resolve. Use this for the happy-path "child finished, ship it" flow at the end of a fan-out.',
    shape: {
      session: z.string().describe("Session ID, branch name, or display name"),
      project_path: sessionProjectPathArg,
      delete_branch: z
        .boolean()
        .optional()
        .describe(
          "Also delete the merged branch (default: true — the branch is fully reachable from base after a successful merge so keeping it around is rarely useful).",
        ),
    },
    run: async ({ session, project_path, delete_branch }) => {
      const ws = await resolveSession(session, project_path, callerAgentId);
      if (!ws) {
        return {
          content: [
            { type: "text" as const, text: `Session not found: ${session}` },
          ],
          isError: true,
        };
      }
      const mergeBlocked = await automationMergeBlock(callerAgentId, ws);
      if (mergeBlocked) {
        return {
          content: [{ type: "text" as const, text: mergeBlocked }],
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
  });

  // -------------------------------------------------------------------------
  // push_notification
  // -------------------------------------------------------------------------

  server.tool(
    "push_notification",
    "Nudge the user with a notification on their desktop and paired phones and browsers. Argus already notifies when you finish or need approval; use this for other milestones worth knowing while they're away — a long build or test run completing, a deploy landing, a watched process changing state — even when you know how to proceed and carry on. It is tagged with your project/session and tapping it opens your chat. Keep `title` short (a few words) and put the detail in `body`. Set `urgency` to `critical` only for events the user needs to react to right now. One nudge per real milestone — never routine progress updates.",
    {
      title: z
        .string()
        .min(1)
        .describe("Short headline (a few words). Shown bold by the OS."),
      body: z
        .string()
        .min(1)
        .describe("Notification body — the actionable detail."),
      agent_id: z
        .string()
        .optional()
        .describe(
          "Defaults to you. Only pass it to attribute the notification to another agent.",
        ),
      urgency: z
        .enum(["normal", "critical"])
        .optional()
        .describe(
          "Linux-only urgency hint. 'critical' notifications stay on screen until dismissed on supporting desktops. Defaults to 'normal'.",
        ),
    },
    async ({ title, body, agent_id, urgency }) => {
      const result = sendPushNotification({
        title,
        body,
        agentId: agent_id ?? callerAgentId ?? undefined,
        urgency,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: !result.delivered,
      };
    },
  );

  // Automation-only tools, registered against caller identity rather than
  // advertised to everyone and refused later.
  registerAutomationTools(server, callerAgentId);
  registerPastAgentTools(server);
  registerTranscriptTools(server);
  registerPrWatchTools(server, callerAgentId, resolveSession);
  registerIntegrationTools(server, callerAgentId);

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
      let transport = sessionId ? getMcpSession(sessionId) : undefined;
      const spawnId =
        (req.headers[SPAWN_ID_HEADER] as string | undefined) ?? null;

      if (!transport) {
        // New session — create a fresh McpServer + transport pair.
        // Each session needs its own McpServer because the MCP SDK's
        // Server class only supports one active transport at a time.
        // Bind the connection to the calling agent (set by agentService in the
        // per-agent MCP config) so parent-relationship tools can attribute
        // spawns without the agent knowing its own ID.
        const callerAgentId =
          (req.headers["x-argus-agent-id"] as string | undefined) ?? null;
        const mcpServer = createMcpServer(callerAgentId);
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
        });

        transport.onclose = () => {
          const sid = transport!.sessionId;
          if (sid) {
            removeMcpSession(sid);
          }
        };

        await mcpServer.connect(transport);
      }

      await transport.handleRequest(req, res);

      // Store after handleRequest — the session ID is generated during
      // the initialize handshake inside handleRequest, not during connect.
      if (transport.sessionId && !hasMcpSession(transport.sessionId)) {
        addMcpSession(transport.sessionId, transport, spawnId);
      }
    } else if (req.method === "GET") {
      // SSE stream for server-initiated messages.
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const transport = sessionId ? getMcpSession(sessionId) : undefined;
      if (!transport) {
        res.writeHead(400);
        res.end("No active session");

        return;
      }
      await transport.handleRequest(req, res);
    } else if (req.method === "DELETE") {
      // Session termination.
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const transport = sessionId ? getMcpSession(sessionId) : undefined;
      if (transport) {
        await transport.handleRequest(req, res);
        removeMcpSession(sessionId!);
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
    closeAllMcpSessions();
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
