/**
 * The `argus` CLI's commands, each a few calls to the host's MCP tools — the
 * same tools Argus's own agents orchestrate with. I/O is injected so the flows
 * and exit codes are unit-tested without a host.
 */

import { HELP, STDIN, type CliCommand } from "./args";

export const EXIT = {
  ok: 0,
  failed: 1,
  usage: 2,
  waiting: 3,
  unreachable: 4,
  timeout: 124,
} as const;

export interface ToolResult {
  isError: boolean;
  text: string;
}

export interface CliIo {
  call: (tool: string, args: Record<string, unknown>) => Promise<ToolResult>;
  out: (text: string) => void;
  err: (text: string) => void;
  readStdin: () => Promise<string>;
  /** The project root `dir` belongs to (the main checkout, not a worktree). */
  projectRoot: (dir: string) => Promise<string>;
  version: string;
  now?: () => number;
}

/** How long one `wait_for_agent` call blocks before the loop looks again. */
const WAIT_SLICE_S = 15;

class CliFailure extends Error {
  constructor(
    message: string,
    readonly code: number = EXIT.failed,
  ) {
    super(message);
  }
}

interface AgentState {
  agent_id: string;
  session_id?: string;
  branch?: string;
  display_name?: string;
  status: string;
  result?: { subtype?: string; result?: string } | null;
}

async function callJson<T>(
  io: CliIo,
  tool: string,
  args: Record<string, unknown>,
): Promise<T> {
  const res = await io.call(tool, args);
  if (res.isError) {
    throw new CliFailure(res.text);
  }
  try {
    return JSON.parse(res.text) as T;
  } catch {
    throw new CliFailure(res.text);
  }
}

function exitFor(state: AgentState): number {
  if (state.status === "requires_action") {
    return EXIT.waiting;
  }
  if (state.status === "error" || state.result?.subtype === "error") {
    return EXIT.failed;
  }

  return EXIT.ok;
}

function print(io: CliIo, json: boolean, state: AgentState): void {
  if (json) {
    io.out(JSON.stringify(state, null, 2));

    return;
  }
  const where = state.branch ? `  ${state.branch}` : "";
  io.out(`${state.agent_id}  ${state.status}${where}`);
  if (state.status === "requires_action") {
    io.err("The agent is waiting for input — answer it in Argus.");
  }
  if (state.result?.result) {
    io.out("");
    io.out(state.result.result);
  }
}

/** Wait for the agent's turn to end, noticing when it stops to ask instead. */
async function waitFor(
  io: CliIo,
  agentId: string,
  timeout: number | null,
): Promise<AgentState> {
  const now = io.now ?? Date.now;
  const deadline = timeout === null ? Infinity : now() + timeout * 1000;
  for (;;) {
    const status = await callJson<AgentState>(io, "agent_status", {
      agent_id: agentId,
    });
    if (status.status === "requires_action") {
      return status;
    }
    const left = (deadline - now()) / 1000;
    if (left <= 0) {
      throw new CliFailure(
        `still ${status.status} after --timeout`,
        EXIT.timeout,
      );
    }
    const res = await io.call("wait_for_agent", {
      agent_id: agentId,
      timeout_seconds: Math.max(1, Math.min(WAIT_SLICE_S, Math.ceil(left))),
    });
    if (!res.isError) {
      return { ...status, ...(JSON.parse(res.text) as AgentState) };
    }
    if (!/timeout/i.test(res.text)) {
      throw new CliFailure(res.text);
    }
  }
}

async function text(io: CliIo, value: string): Promise<string> {
  const body = value === STDIN ? await io.readStdin() : value;
  if (!body.trim()) {
    throw new CliFailure("nothing to send", EXIT.usage);
  }

  return body;
}

/** A session name from the prompt's first words; the host slugifies it. */
export function nameFromPrompt(prompt: string): string {
  const words = prompt.trim().split(/\s+/).slice(0, 6).join(" ");

  return words.slice(0, 48) || "cli";
}

async function settle(
  io: CliIo,
  cmd: { json: boolean; wait: boolean; timeout: number | null },
  started: AgentState,
): Promise<number> {
  if (!cmd.wait) {
    io.out(cmd.json ? JSON.stringify(started, null, 2) : started.agent_id);

    return EXIT.ok;
  }
  if (!cmd.json) {
    io.err(`${started.agent_id} started — waiting for it to finish`);
  }
  const done = await waitFor(io, started.agent_id, cmd.timeout);
  print(io, cmd.json, done);

  return exitFor(done);
}

async function execute(cmd: CliCommand, io: CliIo): Promise<number> {
  switch (cmd.kind) {
    case "help":
      io.out(HELP);

      return EXIT.ok;
    case "version":
      io.out(io.version);

      return EXIT.ok;
    case "new": {
      const prompt = await text(io, cmd.prompt);
      const project = await io.projectRoot(cmd.dir);
      const agentArgs = {
        prompt,
        ...(cmd.model ? { model: cmd.model } : {}),
        ...(cmd.mode ? { permission_mode: cmd.mode } : {}),
      };
      const started =
        cmd.worktree === null
          ? await callJson<AgentState>(io, "spawn_agent", {
              session: "root",
              project_path: project,
              ...agentArgs,
            })
          : await callJson<AgentState & { agent_id?: string }>(
              io,
              "create_session",
              {
                name: cmd.name ?? nameFromPrompt(prompt),
                project_path: project,
                ...(cmd.worktree === "HEAD"
                  ? {}
                  : { base_branch: cmd.worktree }),
                ...agentArgs,
              },
            );
      if (!started.agent_id) {
        throw new CliFailure("the session started without an agent");
      }

      return settle(io, cmd, started);
    }
    case "send": {
      const message = await text(io, cmd.message);
      const res = await io.call("send_agent_message", {
        agent_id: cmd.agentId,
        message,
      });
      if (res.isError) {
        throw new CliFailure(res.text);
      }

      return settle(io, cmd, { agent_id: cmd.agentId, status: "running" });
    }
    case "wait": {
      const done = await waitFor(io, cmd.agentId, cmd.timeout);
      print(io, cmd.json, done);

      return exitFor(done);
    }
    case "show": {
      const status = await callJson<AgentState>(io, "agent_status", {
        agent_id: cmd.agentId,
      });
      const result = await io.call("get_agent_result", {
        agent_id: cmd.agentId,
      });
      const state = result.isError
        ? status
        : { ...status, ...(JSON.parse(result.text) as AgentState) };
      print(io, cmd.json, state);

      return exitFor(state);
    }
    case "stop": {
      const res = await io.call("stop_agent", { agent_id: cmd.agentId });
      if (res.isError) {
        throw new CliFailure(res.text);
      }
      io.out(cmd.json ? JSON.stringify({ agent_id: cmd.agentId }) : res.text);

      return EXIT.ok;
    }
    case "list": {
      const project = await io.projectRoot(cmd.dir);
      const res = await io.call("list_agents", { project_path: project });
      if (res.isError) {
        throw new CliFailure(res.text);
      }
      const agents = res.text.startsWith("[")
        ? (JSON.parse(res.text) as AgentState[])
        : [];
      if (cmd.json) {
        io.out(JSON.stringify(agents, null, 2));
      } else {
        for (const a of agents) {
          io.out(
            `${a.agent_id}  ${a.status.padEnd(15)}  ${a.display_name ?? a.branch ?? ""}`,
          );
        }
      }

      return EXIT.ok;
    }
  }
}

export async function runCli(cmd: CliCommand, io: CliIo): Promise<number> {
  try {
    return await execute(cmd, io);
  } catch (e) {
    const failure =
      e instanceof CliFailure ? e : new CliFailure(String(e), EXIT.failed);
    io.err(`argus: ${failure.message}`);

    return failure.code;
  }
}
