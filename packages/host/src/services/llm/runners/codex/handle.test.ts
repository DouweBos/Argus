import type { ChildProcess } from "node:child_process";
import EventEmitter from "node:events";
import readline from "node:readline";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { CodexHandle } from "./handle";

interface Msg {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
}

/** A scripted `codex app-server`: records what it's sent, answers handshakes. */
function fakeServer() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr,
    exitCode: null,
    killed: false,
    pid: undefined,
    kill: () => true,
  }) as unknown as ChildProcess;
  const received: Msg[] = [];
  const replies = new Map<string, (m: Msg) => unknown>([
    ["initialize", () => ({ userAgent: "codex", codexHome: "/h" })],
    [
      "thread/start",
      (m) => ({
        thread: { id: "thread-1" },
        model: (m.params?.model as string) ?? "gpt-5.5",
        reasoningEffort: null,
      }),
    ],
    [
      "thread/resume",
      (m) => ({
        thread: { id: m.params?.threadId },
        model: "gpt-5.5",
        reasoningEffort: null,
      }),
    ],
    [
      "model/list",
      () => ({
        data: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            description: "Frontier",
            hidden: false,
            isDefault: true,
            supportedReasoningEfforts: [
              { reasoningEffort: "low" },
              { reasoningEffort: "high" },
            ],
            defaultReasoningEffort: "medium",
          },
          {
            id: "x",
            model: "x",
            displayName: "X",
            description: "",
            hidden: true,
            isDefault: false,
            supportedReasoningEfforts: [],
            defaultReasoningEffort: "low",
          },
        ],
        nextCursor: null,
      }),
    ],
    ["turn/start", () => ({ turn: { id: "turn-1", status: "inProgress" } })],
    ["turn/steer", () => ({ turnId: "turn-1" })],
    ["turn/interrupt", () => ({})],
  ]);
  readline.createInterface({ input: stdin }).on("line", (line) => {
    const msg = JSON.parse(line) as Msg;
    received.push(msg);
    const reply = msg.method ? replies.get(msg.method) : undefined;
    if (reply && msg.id !== undefined) {
      stdout.write(JSON.stringify({ id: msg.id, result: reply(msg) }) + "\n");
    }
  });
  const send = (m: object) => stdout.write(JSON.stringify(m) + "\n");
  const nextRequest = async (method: string) => {
    for (let i = 0; i < 50; i++) {
      const found = received.find((m) => m.method === method);
      if (found) {
        return found;
      }
      await tick();
    }
    throw new Error(`no ${method}`);
  };

  return { child, received, send, nextRequest };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

function makeHandle(
  server: ReturnType<typeof fakeServer>,
  over: Partial<ConstructorParameters<typeof CodexHandle>[0]> = {},
) {
  return new CodexHandle({
    agentId: "agent-1",
    child: server.child,
    cwd: "/repo",
    model: null,
    permissionMode: "auto",
    resumeRef: null,
    developerInstructions: "Be helpful",
    mcpServers: { argus: { url: "http://127.0.0.1/mcp" } },
    clientVersion: "1.0.0",
    ...over,
  });
}

describe("codexHandle", () => {
  it("starts a thread with the agent's prompt, mode and MCP servers", async () => {
    const server = fakeServer();
    const handle = makeHandle(server);
    const lines: string[] = [];
    handle.on("stream-event", (l) => lines.push(l));
    await handle.waitForInit();

    const start = await server.nextRequest("thread/start");
    expect(start.params).toMatchObject({
      cwd: "/repo",
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
      developerInstructions: "Be helpful",
      config: { mcp_servers: { argus: { url: "http://127.0.0.1/mcp" } } },
    });
    expect(JSON.parse(lines[0]!)).toMatchObject({
      type: "system",
      subtype: "init",
      session_id: "thread-1",
      model: "gpt-5.5",
    });
    expect(handle.initializeResponse()?.models).toEqual([
      {
        value: "gpt-5.5",
        displayName: "GPT-5.5",
        description: "Frontier",
        supportsEffort: true,
        supportedEffortLevels: ["low", "high"],
      },
    ]);
  });

  it("resumes the thread named by the resume ref", async () => {
    const server = fakeServer();
    const handle = makeHandle(server, { resumeRef: "thread-9" });
    await handle.waitForInit();

    expect((await server.nextRequest("thread/resume")).params).toMatchObject({
      threadId: "thread-9",
    });
  });

  it("starts a turn with pending model, effort and mode, then steers", async () => {
    const server = fakeServer();
    const handle = makeHandle(server);
    await handle.waitForInit();
    await handle.setModel("gpt-5.5-mini");
    await handle.setEffort("max");
    await handle.setPermissionMode("review");

    handle.send("Fix the bug");
    const turn = await server.nextRequest("turn/start");
    expect(turn.params).toMatchObject({
      threadId: "thread-1",
      model: "gpt-5.5-mini",
      effort: "xhigh",
      approvalPolicy: "untrusted",
      sandboxPolicy: { type: "workspaceWrite", writableRoots: ["/repo"] },
      input: [{ type: "text", text: "Fix the bug" }],
    });

    server.send({
      method: "turn/started",
      params: { threadId: "thread-1", turn: { id: "turn-1" } },
    });
    await tick();
    handle.send("Also the test");
    expect((await server.nextRequest("turn/steer")).params).toMatchObject({
      expectedTurnId: "turn-1",
    });

    await handle.interrupt();
    expect((await server.nextRequest("turn/interrupt")).params).toEqual({
      threadId: "thread-1",
      turnId: "turn-1",
    });
  });

  it("asks before a command and answers with the user's decision", async () => {
    const server = fakeServer();
    const handle = makeHandle(server);
    const asks: Record<string, unknown>[] = [];
    handle.on("permission-request", (p) =>
      asks.push(p as Record<string, unknown>),
    );
    await handle.waitForInit();

    server.send({
      id: 77,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "cmd-1",
        command: "rm -rf build",
        reason: "Clean the build",
      },
    });
    await tick();
    expect(asks[0]).toEqual({
      request_id: "77",
      tool_name: "Bash",
      tool_use_id: "cmd-1",
      tool_input: { command: "rm -rf build", description: "Clean the build" },
    });

    handle.respondToPermission({
      toolUseId: "cmd-1",
      decision: "allow",
      allowAll: true,
    });
    await tick();
    expect(server.received.find((m) => m.id === 77)?.result).toEqual({
      decision: "acceptForSession",
    });
  });

  it("refuses a disallowed command without asking", async () => {
    const server = fakeServer();
    const handle = makeHandle(server, {
      disallowedTools: ["Bash(git push:*)"],
    });
    const asks: unknown[] = [];
    handle.on("permission-request", (p) => asks.push(p));
    await handle.waitForInit();

    expect(
      (await server.nextRequest("thread/start")).params?.approvalPolicy,
    ).toBe("untrusted");
    server.send({
      id: 5,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thread-1",
        turnId: "t",
        itemId: "c",
        command: "git push",
      },
    });
    await tick();

    expect(asks).toEqual([]);
    expect(server.received.find((m) => m.id === 5)?.result).toEqual({
      decision: "decline",
    });
  });

  it("lets the pre-hook answer in Claude's control_response shape", async () => {
    const server = fakeServer();
    const handle = makeHandle(server, {
      permissionPreHook: (req) => {
        req.approveRaw(
          JSON.stringify({
            type: "control_response",
            response: {
              subtype: "success",
              request_id: "x",
              response: { behavior: "deny", message: "no" },
            },
          }),
        );

        return { kind: "handled" };
      },
    });
    await handle.waitForInit();

    server.send({
      id: 9,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1", turnId: "t", itemId: "c", command: "ls" },
    });
    await tick();

    expect(server.received.find((m) => m.id === 9)?.result).toEqual({
      decision: "decline",
    });
  });

  it("withdraws an approval the server resolved itself", async () => {
    const server = fakeServer();
    const handle = makeHandle(server);
    const cancels: unknown[] = [];
    handle.on("permission-cancel", (p) => cancels.push(p));
    await handle.waitForInit();

    server.send({
      id: 3,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1", turnId: "t", itemId: "c", command: "ls" },
    });
    server.send({
      method: "serverRequest/resolved",
      params: { threadId: "thread-1", requestId: 3 },
    });
    await tick();

    expect(cancels).toEqual([{ request_id: "3", tool_use_id: "c" }]);
  });

  it("refuses requests nothing in Argus can answer", async () => {
    const server = fakeServer();
    const handle = makeHandle(server);
    await handle.waitForInit();

    server.send({ id: 11, method: "item/tool/requestUserInput", params: {} });
    await tick();

    expect(
      (server.received.find((m) => m.id === 11) as { error?: unknown })?.error,
    ).toBeDefined();
  });
});
