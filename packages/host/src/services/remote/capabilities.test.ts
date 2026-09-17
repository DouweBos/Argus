import type { GatewayContext } from "./capabilities";
import type { PairedDevice } from "./deviceStore";
import { MethodResult } from "@argus/remote-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the snapshot map matters here — seed it per test.
vi.mock("../../state", () => ({
  appState: {
    agents: new Map(),
    agentSnapshots: new Map<string, string>(),
    agentPendingPermissions: new Map(),
    sessions: new Map(),
  },
}));
vi.mock("../agent/agentService", () => ({
  respondToPermission: vi.fn(),
  sendAgentMessage: vi.fn(),
  interruptAgent: vi.fn(),
  setAgentModel: vi.fn(),
  setAgentPermissionMode: vi.fn(),
  setAgentEffort: vi.fn(),
  startAgent: vi.fn(),
}));
vi.mock("../file/operations", () => ({
  listSessionFiles: vi.fn(async () => []),
  resolveMentionPath: vi.fn(async () => ({ entries: [], resolvedPath: "" })),
}));
vi.mock("../mcp/projects", () => ({ collectAllProjects: vi.fn(() => []) }));
vi.mock("../session/sessionOps", () => ({
  getSessionBranchDiff: vi.fn(async () => ""),
  getSessionFullDiff: vi.fn(async () => ""),
}));
vi.mock("../session/manager", () => ({
  listSessions: vi.fn(async () => []),
  createSession: vi.fn(),
}));

const { appState } = await import("../../state");
const { dispatch } = await import("./capabilities");

const device: PairedDevice = {
  device_id: "dev-1",
  label: "Phone",
  dev_static_pub: "",
  capabilities: ["monitor"],
  created_at: 0,
  last_seen: null,
};
const ctx: GatewayContext = {
  device,
  connectionId: "conn-1",
  outstandingPermissions: new Set(),
};

// Snapshot exercising an Edit, a Bash, a Read + base64 image, a Task with
// children, message-level image attachment, and a todo/task list.
const SNAPSHOT = {
  model: "claude-opus-4-8",
  pendingToolName: "Bash",
  todos: [
    { content: "Write tests", status: "in_progress", activeForm: "Writing" },
  ],
  tasks: { t1: { id: "t1", subject: "Build kit", status: "completed" } },
  taskOrder: ["t1"],
  messages: [
    {
      id: "m1",
      role: "assistant",
      textBlocks: ["Doing work"],
      timestamp: 1,
      toolCalls: [
        {
          id: "e1",
          name: "Edit",
          input: { file_path: "/a.ts", old_string: "foo", new_string: "bar" },
          result: "applied",
        },
        {
          id: "b1",
          name: "Bash",
          input: { command: "ls" },
          result: [{ type: "text", text: "file.txt" }],
        },
        {
          id: "r1",
          name: "Read",
          input: { file_path: "/img.png" },
          result: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "AAAA" },
            },
          ],
        },
        {
          id: "task1",
          name: "Task",
          input: { description: "sub" },
          result: "done",
          children: [
            { kind: "text", text: "child thinking" },
            {
              kind: "tool_use",
              toolCall: {
                id: "c1",
                name: "Grep",
                input: { pattern: "x" },
                result: "match",
              },
            },
          ],
        },
      ],
    },
    {
      id: "m2",
      role: "user",
      textBlocks: ["look at this"],
      timestamp: 2,
      images: [{ data: "BBBB", media_type: "image/jpeg" }],
    },
  ],
};

const AGENT = {
  agentId: "a1",
  sessionId: "s1",
  status: "idle",
  model: "m",
  permissionMode: "ask",
  parentAgentId: null,
  createdAt: 0,
};

describe("agent status attention", () => {
  beforeEach(() => {
    appState.agents.clear();
    appState.agents.set("a1", AGENT as never);
    appState.agentSnapshots.clear();
    appState.agentPendingPermissions.clear();
  });

  async function statusOf() {
    const res = MethodResult["agents.status"].parse(
      await dispatch("agents.status", { agent_id: "a1" }, ctx),
    );

    return res.agent.awaiting;
  }

  it("is null when nothing is pending", async () => {
    await expect(statusOf()).resolves.toBeNull();
  });

  it("flags an outstanding permission prompt", async () => {
    appState.agentPendingPermissions.set(
      "a1",
      new Map([
        [
          "tu1",
          {
            request_id: "r1",
            tool_use_id: "tu1",
            tool_name: "Bash",
            tool_input: {},
          },
        ],
      ]),
    );
    await expect(statusOf()).resolves.toBe("permission");
  });

  it("flags an unanswered question even with no permission prompt", async () => {
    appState.agentSnapshots.set(
      "a1",
      JSON.stringify({
        messages: [
          {
            id: "m1",
            role: "assistant",
            toolCalls: [{ id: "q1", name: "AskUserQuestion", input: {} }],
          },
        ],
      }),
    );
    await expect(statusOf()).resolves.toBe("question");
  });

  it("flags a plan waiting for approval", async () => {
    appState.agentSnapshots.set(
      "a1",
      JSON.stringify({
        messages: [
          {
            id: "m1",
            role: "assistant",
            toolCalls: [{ id: "p1", name: "ExitPlanMode", input: {} }],
          },
        ],
      }),
    );
    await expect(statusOf()).resolves.toBe("plan");
  });

  it("ignores a tool that is merely still running", async () => {
    appState.agentSnapshots.set(
      "a1",
      JSON.stringify({
        messages: [
          {
            id: "m1",
            role: "assistant",
            toolCalls: [{ id: "b1", name: "Bash", input: {} }],
          },
        ],
      }),
    );
    await expect(statusOf()).resolves.toBeNull();
  });

  it("clears once the question has an answer", async () => {
    appState.agentSnapshots.set(
      "a1",
      JSON.stringify({
        messages: [
          {
            id: "m1",
            role: "assistant",
            toolCalls: [
              { id: "q1", name: "AskUserQuestion", input: {}, result: "ok" },
            ],
          },
        ],
      }),
    );
    await expect(statusOf()).resolves.toBeNull();
  });
});

describe("gateway transcript mapping", () => {
  beforeEach(() => {
    appState.agentSnapshots.clear();
    appState.agentSnapshots.set("a1", JSON.stringify(SNAPSHOT));
  });

  it("preserves structure, diffs, children, blocks and mints image ids", async () => {
    const raw = await dispatch("agents.transcript", { agent_id: "a1" }, ctx);
    const res = MethodResult["agents.transcript"].parse(raw);

    expect(res.messages).toHaveLength(2);
    const [m1, m2] = res.messages;

    // Edit input (old/new strings) is preserved for diff rendering.
    const edit = m1.tool_calls[0];
    expect(edit.name).toBe("Edit");
    expect(edit.status).toBe("done");
    expect(edit.input.old_string).toBe("foo");
    expect(edit.input.new_string).toBe("bar");
    expect(edit.result_blocks).toEqual([{ type: "text", text: "applied" }]);

    // Bash result blocks preserved.
    expect(m1.tool_calls[1].result_blocks).toEqual([
      { type: "text", text: "file.txt" },
    ]);

    // Read image → image reference with a stable minted id (no bytes inline).
    const read = m1.tool_calls[2];
    expect(read.result_blocks[0]).toEqual({
      type: "image",
      image_id: "m1:r1:0",
      media_type: "image/png",
    });

    // Task sub-agent children preserved (text + nested tool call).
    const task = m1.tool_calls[3];
    expect(task.children).toHaveLength(2);
    expect(task.children?.[0]).toEqual({
      kind: "text",
      text: "child thinking",
    });
    expect(task.children?.[1]).toMatchObject({
      kind: "tool_use",
      tool_call: {
        name: "Grep",
        result_blocks: [{ type: "text", text: "match" }],
      },
    });

    // Message-level image attachment → reference.
    expect(m2.images).toEqual([
      { image_id: "m2:msg:0", media_type: "image/jpeg" },
    ]);

    // Conversation-level state.
    expect(res.tasks).toEqual([
      { id: "t1", subject: "Build kit", status: "completed" },
    ]);
    expect(res.todos).toEqual([
      { content: "Write tests", status: "in_progress", activeForm: "Writing" },
    ]);
    expect(res.model).toBe("claude-opus-4-8");
    expect(res.pending_tool_name).toBe("Bash");
  });

  it("agents.image resolves minted ids back to their bytes", async () => {
    const toolImg = MethodResult["agents.image"].parse(
      await dispatch(
        "agents.image",
        { agent_id: "a1", image_id: "m1:r1:0" },
        ctx,
      ),
    );
    expect(toolImg).toEqual({ data: "AAAA", media_type: "image/png" });

    const msgImg = MethodResult["agents.image"].parse(
      await dispatch(
        "agents.image",
        { agent_id: "a1", image_id: "m2:msg:0" },
        ctx,
      ),
    );
    expect(msgImg).toEqual({ data: "BBBB", media_type: "image/jpeg" });
  });

  it("agents.image rejects an unknown id", async () => {
    await expect(
      dispatch("agents.image", { agent_id: "a1", image_id: "nope" }, ctx),
    ).rejects.toThrow(/no image/);
  });
});

describe("transcript pagination", () => {
  beforeEach(() => {
    // 5 assistant messages m0..m4.
    const conv = {
      messages: Array.from({ length: 5 }, (_, i) => ({
        id: `m${i}`,
        role: "assistant",
        textBlocks: [`msg ${i}`],
        toolCalls: [],
      })),
    };
    appState.agentSnapshots.clear();
    appState.agentSnapshots.set("p", JSON.stringify(conv));
  });

  it("returns the tail when no cursor is given", async () => {
    const res = MethodResult["agents.transcript"].parse(
      await dispatch("agents.transcript", { agent_id: "p", limit: 2 }, ctx),
    );
    expect(res.messages.map((m) => m.id)).toEqual(["m3", "m4"]);
    expect(res.total).toBe(5);
    expect(res.prev_before).toBe(3);
    expect(res.next_after).toBeNull();
  });

  it("pages backward with `before`", async () => {
    const res = MethodResult["agents.transcript"].parse(
      await dispatch(
        "agents.transcript",
        { agent_id: "p", before: 3, limit: 2 },
        ctx,
      ),
    );
    expect(res.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(res.prev_before).toBe(1);
  });
});
