import type { ImplementTicketDeps } from "./implementTicketTool";
import type { AgentSession } from "../agent/models";
import type { Session } from "../session/models";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../../state";
import { registerImplementTicketTool } from "./implementTicketTool";

const REPO = "/repo";

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });

const deps = {
  spawn: vi.fn<ImplementTicketDeps["spawn"]>(async () => ok("spawned")),
  send: vi.fn<ImplementTicketDeps["send"]>(() => ok("sent")),
};

async function call(args: Record<string, unknown>) {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  registerImplementTicketTool(server, deps);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "caller", version: "1.0.0" });
  await client.connect(clientTransport);
  const result = await client.callTool({
    name: "implement_ticket",
    arguments: { project_path: REPO, ...args },
  });
  await client.close();

  return {
    text: (result.content as { text: string }[])[0]!.text,
    isError: Boolean(result.isError),
  };
}

function addAgent(status: AgentSession["status"]): void {
  appState.sessions.set("s1", {
    id: "s1",
    repo_root: REPO,
    branch: "feat-a",
  } as Session);
  appState.agents.set("a1", { sessionId: "s1", status } as AgentSession);
}

describe("implement_ticket", () => {
  beforeEach(() => {
    appState.sessions.clear();
    appState.agents.clear();
    deps.spawn.mockClear();
    deps.send.mockClear();
  });

  it("spawns in a session with the command as the prompt", async () => {
    const out = await call({
      ticket: " ENG-12 ",
      notes: "only the empty state",
      session: "current",
      model: "opus",
      devices: ["iPad"],
    });
    expect(out.text).toBe("spawned");
    expect(deps.spawn).toHaveBeenCalledWith({
      session: "current",
      project_path: REPO,
      prompt: "/implement-ticket ENG-12\n\nonly the empty state",
      model: "opus",
      permission_mode: undefined,
      devices: ["iPad"],
      tools: undefined,
    });
  });

  it("sends the command to an idle agent and returns its session", async () => {
    addAgent("idle");
    const out = await call({
      ticket: "https://linear.app/acme/issue/ENG-1/x",
      agent_id: "a1",
    });
    expect(deps.send).toHaveBeenCalledWith({
      agent_id: "a1",
      message: "/implement-ticket https://linear.app/acme/issue/ENG-1/x",
    });
    expect(JSON.parse(out.text)).toMatchObject({
      agent_id: "a1",
      session_id: "s1",
      branch: "feat-a",
    });
  });

  it("wants exactly one target", async () => {
    expect((await call({ ticket: "ENG-1" })).isError).toBe(true);
    addAgent("idle");
    expect(
      (await call({ ticket: "ENG-1", session: "current", agent_id: "a1" }))
        .isError,
    ).toBe(true);
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("refuses a busy agent, another project's, and spawn-only options", async () => {
    addAgent("running");
    expect((await call({ ticket: "ENG-1", agent_id: "a1" })).text).toMatch(
      /not idle/,
    );
    addAgent("idle");
    expect(
      (await call({ ticket: "ENG-1", agent_id: "a1", project_path: "/other" }))
        .text,
    ).toMatch(/belongs to project/);
    expect(
      (await call({ ticket: "ENG-1", agent_id: "a1", model: "opus" })).isError,
    ).toBe(true);
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("refuses a ticket that isn't one identifier", async () => {
    expect(
      (await call({ ticket: "ENG-1 ENG-2", session: "current" })).isError,
    ).toBe(true);
    expect(deps.spawn).not.toHaveBeenCalled();
  });
});
