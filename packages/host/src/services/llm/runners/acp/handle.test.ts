import type { AcpPreset } from "./preset";
import type { ChildProcess } from "node:child_process";
import EventEmitter from "node:events";
import readline from "node:readline";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { AcpHandle } from "./handle";

interface Msg {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

const PRESET: AcpPreset = {
  id: "fake",
  displayName: "Fake",
  bins: ["fake"],
  args: [],
  installHint: "",
  loginHint: "Run `fake login`.",
  loginCommand: "fake login",
};

/** A scripted ACP agent: records what it's sent, answers what it's asked. */
function fakeAgent(
  overrides: Record<string, (m: Msg) => unknown> = {},
  initCaps: Record<string, unknown> = {},
) {
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
  const replies: Record<string, (m: Msg) => unknown> = {
    initialize: () => ({
      protocolVersion: 1,
      authMethods: [{ id: "login", name: "Login" }],
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true },
        mcpCapabilities: { http: true },
        ...initCaps,
      },
    }),
    "session/new": () => ({
      sessionId: "s-1",
      modes: {
        currentModeId: "default",
        availableModes: [
          { id: "default", name: "Default" },
          { id: "plan", name: "Plan" },
        ],
      },
      models: {
        currentModelId: "m-1",
        availableModels: [
          { modelId: "m-1", name: "Model One" },
          { modelId: "m-2", name: "Model Two" },
        ],
      },
    }),
    "session/load": () => ({}),
    "session/set_mode": () => ({}),
    "session/set_model": () => ({}),
    "session/prompt": () => ({ stopReason: "end_turn" }),
    ...overrides,
  };
  const pending: Msg[] = [];
  readline.createInterface({ input: stdin }).on("line", (l) => {
    const msg = JSON.parse(l) as Msg;
    received.push(msg);
    if (msg.method && msg.id !== undefined) {
      const reply = replies[msg.method];
      if (reply === undefined) {
        return;
      }
      const result = reply(msg);
      if (result === HOLD) {
        pending.push(msg);

        return;
      }
      const r = result as { error?: unknown };
      stdout.write(
        JSON.stringify(
          r && typeof r === "object" && "error" in r
            ? { jsonrpc: "2.0", id: msg.id, error: r.error }
            : { jsonrpc: "2.0", id: msg.id, result },
        ) + "\n",
      );
    }
  });
  const send = (m: object) =>
    stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");

  return {
    child,
    received,
    send,
    update: (update: object) =>
      send({
        method: "session/update",
        params: { sessionId: "s-1", update },
      }),
    finish: (stopReason = "end_turn") => {
      const msg = pending.shift();
      if (msg) {
        send({ id: msg.id, result: { stopReason } });
      }
    },
  };
}

const HOLD = Symbol("hold");

function handle(
  agent: ReturnType<typeof fakeAgent>,
  extra: Partial<ConstructorParameters<typeof AcpHandle>[0]> = {},
) {
  const h = new AcpHandle({
    agentId: "a1",
    child: agent.child,
    preset: PRESET,
    cwd: "/work",
    model: null,
    permissionMode: "ask",
    resumeRef: null,
    systemPrompt: "Be helpful",
    mcpServers: {
      argus: { url: "http://127.0.0.1:1/mcp", headers: { A: "b" } },
    } as never,
    clientVersion: "1.0",
    ...extra,
  });
  const lines: Record<string, unknown>[] = [];
  const asks: Record<string, unknown>[] = [];
  h.on("stream-event", (l: string) => lines.push(JSON.parse(l)));
  h.on("permission-request", (p: unknown) =>
    asks.push(p as Record<string, unknown>),
  );

  return { h, lines, asks };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

describe("acpHandle", () => {
  it("opens a session with argus's mcp server and reports the agent's models", async () => {
    const agent = fakeAgent();
    const { h, lines } = handle(agent);
    await h.waitForInit();

    const init = agent.received.find((m) => m.method === "initialize");
    expect(init?.jsonrpc).toBe("2.0");
    expect(init?.params?.protocolVersion).toBe(1);
    const opened = agent.received.find((m) => m.method === "session/new");
    expect(opened?.params).toMatchObject({
      cwd: "/work",
      mcpServers: [
        {
          type: "http",
          name: "argus",
          url: "http://127.0.0.1:1/mcp",
          headers: [{ name: "A", value: "b" }],
        },
      ],
    });
    expect(lines[0]).toMatchObject({
      type: "system",
      subtype: "init",
      session_id: "s-1",
      model: "m-1",
    });
    expect(h.initializeResponse()?.models.map((m) => m.value)).toEqual([
      "m-1",
      "m-2",
    ]);
  });

  it("sends the system prompt once, then streams text into one assistant message", async () => {
    const agent = fakeAgent({ "session/prompt": () => HOLD });
    const { h, lines } = handle(agent);
    await h.waitForInit();
    h.send("hi");
    await tick();
    agent.update({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Hel" },
    });
    agent.update({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "lo" },
    });
    await tick();
    agent.finish();
    await tick();

    const prompt = agent.received.find((m) => m.method === "session/prompt");
    const blocks = prompt?.params?.prompt as { text: string }[];
    expect(blocks[0]!.text).toContain("Be helpful");
    expect(blocks.at(-1)!.text).toBe("hi");
    const texts = lines.filter((l) => l.type === "assistant");
    expect(texts).toHaveLength(1);
    expect(JSON.stringify(texts[0])).toContain("Hello");
    const result = lines.find((l) => l.type === "result");
    expect(result).toMatchObject({ subtype: "success", result: "Hello" });

    h.send("again");
    await tick();
    const second = agent.received.filter((m) => m.method === "session/prompt");
    expect(second[1]?.params?.prompt as unknown[]).toHaveLength(1);
  });

  it("queues a message sent mid-turn until the turn ends", async () => {
    const agent = fakeAgent({ "session/prompt": () => HOLD });
    const { h } = handle(agent);
    await h.waitForInit();
    h.send("one");
    h.send("two");
    await tick();
    expect(
      agent.received.filter((m) => m.method === "session/prompt"),
    ).toHaveLength(1);
    agent.finish();
    await tick();
    expect(
      agent.received.filter((m) => m.method === "session/prompt"),
    ).toHaveLength(2);
  });

  it("asks the user under ask mode and answers with the picked option", async () => {
    const agent = fakeAgent({ "session/prompt": () => HOLD });
    const { h, asks } = handle(agent);
    await h.waitForInit();
    h.send("run it");
    await tick();
    agent.send({
      id: 99,
      method: "session/request_permission",
      params: {
        sessionId: "s-1",
        toolCall: {
          toolCallId: "t1",
          title: "ls",
          kind: "execute",
          rawInput: { command: "ls -la" },
        },
        options: [
          { optionId: "yes", name: "Allow", kind: "allow_once" },
          { optionId: "always", name: "Always", kind: "allow_always" },
          { optionId: "no", name: "Reject", kind: "reject_once" },
        ],
      },
    });
    await tick();
    expect(asks[0]).toMatchObject({
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
      tool_use_id: "t1",
    });

    h.respondToPermission({
      toolUseId: "t1",
      decision: "allow",
      allowAll: true,
    });
    await tick();
    const answer = agent.received.find((m) => m.id === 99);
    expect(answer?.result).toEqual({
      outcome: { outcome: "selected", optionId: "always" },
    });
  });

  it("lets worktree edits through without asking under review mode", async () => {
    const agent = fakeAgent({ "session/prompt": () => HOLD });
    const { h, asks } = handle(agent, { permissionMode: "review" });
    await h.waitForInit();
    h.send("edit");
    await tick();
    agent.send({
      id: 7,
      method: "session/request_permission",
      params: {
        sessionId: "s-1",
        toolCall: {
          toolCallId: "e1",
          title: "Edit a.ts",
          kind: "edit",
          content: [
            { type: "diff", path: "/work/a.ts", oldText: "a", newText: "b" },
          ],
        },
        options: [
          { optionId: "yes", name: "Allow", kind: "allow_once" },
          { optionId: "no", name: "Reject", kind: "reject_once" },
        ],
      },
    });
    await tick();
    expect(asks).toHaveLength(0);
    expect(agent.received.find((m) => m.id === 7)?.result).toEqual({
      outcome: { outcome: "selected", optionId: "yes" },
    });
  });

  it("cancels the turn and every pending request on interrupt", async () => {
    const agent = fakeAgent({ "session/prompt": () => HOLD });
    const { h } = handle(agent);
    await h.waitForInit();
    h.send("go");
    await tick();
    agent.send({
      id: 5,
      method: "session/request_permission",
      params: {
        sessionId: "s-1",
        toolCall: { toolCallId: "t9", title: "rm", kind: "execute" },
        options: [{ optionId: "yes", name: "Allow", kind: "allow_once" }],
      },
    });
    await tick();
    await h.interrupt();
    await tick();
    expect(agent.received.some((m) => m.method === "session/cancel")).toBe(
      true,
    );
    expect(agent.received.find((m) => m.id === 5)?.result).toEqual({
      outcome: { outcome: "cancelled" },
    });
  });

  it("switches into the agent's plan mode and back", async () => {
    const agent = fakeAgent();
    const { h } = handle(agent, { permissionMode: "plan" });
    await h.waitForInit();
    await h.setPermissionMode("ask");
    const modes = agent.received
      .filter((m) => m.method === "session/set_mode")
      .map((m) => m.params?.modeId);
    expect(modes).toEqual(["plan", "default"]);
  });

  it("resumes with session/load and keeps the replay out of the transcript", async () => {
    const agent = fakeAgent({
      "session/load": () => {
        agent.update({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "old" },
        });

        return HOLD;
      },
    });
    const { h, lines } = handle(agent, { resumeRef: "s-1" });
    await tick();
    agent.finish();
    await h.waitForInit();
    expect(
      agent.received.find((m) => m.method === "session/load")?.params,
    ).toMatchObject({ sessionId: "s-1" });
    expect(JSON.stringify(lines)).not.toContain("old");
  });

  it("signs in through the agent's method when the session needs it", async () => {
    let tries = 0;
    const agent = fakeAgent({
      "session/new": () =>
        ++tries === 1
          ? { error: { code: -32000, message: "auth required" } }
          : { sessionId: "s-1" },
      authenticate: () => ({}),
    });
    const { h } = handle(agent);
    // The preset names no method: the user is told how to sign in.
    await expect(h.waitForInit()).rejects.toContain("Run `fake login`");

    tries = 0;
    const again = fakeAgent({
      "session/new": () =>
        ++tries === 1
          ? { error: { code: -32000, message: "auth required" } }
          : { sessionId: "s-2" },
      authenticate: () => ({}),
    });
    const signed = new AcpHandle({
      agentId: "a2",
      child: again.child,
      preset: { ...PRESET, authMethodId: "login" },
      cwd: "/work",
      model: null,
      permissionMode: "ask",
      resumeRef: null,
      systemPrompt: "",
      mcpServers: {},
      clientVersion: "1",
    });
    await signed.waitForInit();
    expect(again.received.some((m) => m.method === "authenticate")).toBe(true);
  });

  it("writes the preset's mode on start even when the agent already reports it", async () => {
    const agent = fakeAgent({
      "session/new": () => ({
        sessionId: "s-1",
        modes: {
          currentModeId: "ask",
          availableModes: [
            { id: "ask", name: "Ask" },
            { id: "code", name: "Code" },
          ],
        },
      }),
    });
    const h = new AcpHandle({
      agentId: "a3",
      child: agent.child,
      preset: {
        ...PRESET,
        modeIds: { ask: "ask", trusted: ["auto", "code"] },
        setModeOnStart: true,
      },
      cwd: "/work",
      model: null,
      permissionMode: "ask",
      resumeRef: null,
      systemPrompt: "",
      mcpServers: {},
      clientVersion: "1",
    });
    await h.waitForInit();
    await h.setPermissionMode("trusted");
    const modes = agent.received
      .filter((m) => m.method === "session/set_mode")
      .map((m) => m.params?.modeId);
    // The first mode the agent offers wins: `code` on an fx without `auto`.
    expect(modes).toEqual(["ask", "code"]);
  });
});
