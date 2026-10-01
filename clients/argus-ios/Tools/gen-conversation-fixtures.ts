// Feeds recorded agent event sequences through the renderer's real
// conversationStore and the host's real `agents.transcript` handler, and writes
// what they produce as fixtures the Swift ConversationReducer is asserted
// against. Run:
//
//   pnpm exec vitest run --config clients/argus-ios/Tools/conversation-fixtures.vitest.config.ts
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, it, vi } from "vitest";
import type { GatewayContext } from "../../../packages/host/src/services/remote/capabilities";

vi.mock("../../../packages/host/src/state", () => ({
  appState: {
    agents: new Map(),
    agentSnapshots: new Map<string, string>(),
    agentPendingPermissions: new Map(),
    sessions: new Map(),
  },
}));
vi.mock("../../../packages/host/src/services/agent/agentService", () => ({}));
vi.mock("../../../packages/host/src/services/file/operations", () => ({}));
vi.mock("../../../packages/host/src/services/mcp/projectDiscovery", () => ({}));
vi.mock("../../../packages/host/src/services/session/sessionOps", () => ({}));
vi.mock("../../../packages/host/src/services/session/manager", () => ({}));

const { appState } = await import("../../../packages/host/src/state");
const { dispatch } = await import(
  "../../../packages/host/src/services/remote/capabilities"
);
const store = await import("../../../app/stores/conversationStore");

const OUT = path.resolve(
  __dirname,
  "../ArgusCore/Tests/ArgusCoreTests/Fixtures/conversation",
);
const AGENT = "agent-1";
const CLOCK_START = 1_760_000_000_000;

const ctx: GatewayContext = {
  device: {
    device_id: "dev-1",
    label: "Phone",
    dev_static_pub: "",
    capabilities: ["monitor"],
    created_at: 0,
    last_seen: null,
  },
  connectionId: "conn-1",
  outstandingPermissions: new Set(),
};

// The Swift side reproduces both sequences with an injected environment.
let idCounter = 0;
let clockCounter = 0;
beforeEach(() => {
  vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
    () => `uuid-${++idCounter}` as `${string}-${string}-${string}-${string}-${string}`,
  );
});
afterEach(() => vi.restoreAllMocks());

type Op =
  | { op: "event"; event: unknown }
  | {
      op: "userMessage";
      text: string;
      images?: { data: string; media_type: string }[];
      checkpointId?: string;
      author?: string;
    }
  | { op: "systemMessage"; message: store.ConversationMessage }
  | { op: "injectedPrompt"; message: store.ConversationMessage }
  | {
      op: "loadSaved";
      messages: store.ConversationMessage[];
      model?: string;
      sessionId?: string;
      resuming?: boolean;
      title?: string;
    }
  | { op: "setModel"; model: string }
  | { op: "setCapabilities"; capabilities: unknown }
  | { op: "permissionPending"; request: unknown }
  | { op: "clearPermission"; toolUseId: string }
  | { op: "cancelPermission"; toolUseId: string }
  | { op: "setTitle"; title: string }
  | { op: "clearTasks" }
  | { op: "clearTodos" }
  | { op: "migrate" };

const PAGES = [{}, { limit: 2 }, { after: 1, limit: 2 }, { before: 2, limit: 1 }];

function apply(op: Op): boolean | undefined {
  switch (op.op) {
    case "event":
      // agentEventService parses the channel's JSON string, then folds it.
      store.appendEvent(AGENT, JSON.parse(JSON.stringify(op.event)));
      return;
    case "userMessage":
      store.addUserMessage(AGENT, op.text, op.images, op.checkpointId, op.author);
      return;
    case "systemMessage":
      store.appendSystemMessage(AGENT, op.message);
      return;
    case "injectedPrompt":
      store.appendInjectedPrompt(AGENT, op.message);
      return;
    case "loadSaved":
      store.loadSavedMessages(
        AGENT,
        structuredClone(op.messages),
        op.model,
        op.sessionId,
        op.resuming,
        op.title,
      );
      return;
    case "setModel":
      store.setModel(AGENT, op.model);
      return;
    case "setCapabilities":
      store.setCapabilities(AGENT, structuredClone(op.capabilities) as never);
      return;
    case "permissionPending":
      return store.setPermissionPending(AGENT, op.request as never);
    case "clearPermission":
      store.clearPermission(AGENT, op.toolUseId);
      return;
    case "cancelPermission":
      store.cancelPermission(AGENT, op.toolUseId);
      return;
    case "setTitle":
      store.setConversationTitle(AGENT, op.title);
      return;
    case "clearTasks":
      store.clearAgentTasks(AGENT);
      return;
    case "clearTodos":
      store.clearAgentTodos(AGENT);
      return;
    case "migrate":
      store.migrateConversation(AGENT, "agent-2");
      store.migrateConversation("agent-2", AGENT);
      return;
  }
}

const json = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

async function generate(name: string, description: string, ops: Op[]) {
  store.setConversationState({ conversations: {}, pendingUnread: {} });
  idCounter = 0;
  clockCounter = 0;
  vi.spyOn(Date, "now").mockImplementation(
    () => CLOCK_START + 1000 * clockCounter++,
  );

  const steps = ops.map((op) => {
    const found = apply(op);
    const snapshot = json(store.getConversationState().conversations[AGENT]);
    return found === undefined ? { snapshot } : { snapshot, found };
  });
  vi.mocked(Date.now).mockRestore();

  const conv = store.getConversationState().conversations[AGENT];
  appState.agentSnapshots.set(AGENT, JSON.stringify(conv));
  const transcripts = [];
  for (const params of PAGES) {
    const result = await dispatch(
      "agents.transcript",
      { agent_id: AGENT, ...params },
      ctx,
    );
    transcripts.push({ params, result: json(result) });
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, `${name}.json`),
    JSON.stringify(
      { name, description, clockStart: CLOCK_START, ops, steps, transcripts },
      null,
      2,
    ) + "\n",
  );
}

// --- Event builders --------------------------------------------------------

const USAGE = { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 9000 };
const MODEL = "claude-opus-4-8";
// 1x1 transparent PNG.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

type Block = Record<string, unknown>;
const text = (t: string): Block => ({ type: "text", text: t });
const toolUse = (id: string, name: string, input: Record<string, unknown>): Block => ({
  type: "tool_use",
  id,
  name,
  input,
});
const assistant = (content: Block[], parent?: string | null): Op => ({
  op: "event",
  event: {
    type: "assistant",
    message: {
      id: "msg_01",
      type: "message",
      role: "assistant",
      model: MODEL,
      content,
      stop_reason: null,
      usage: { ...USAGE, service_tier: "standard" },
    },
    parent_tool_use_id: parent ?? null,
    session_id: "cli-session-1",
    uuid: "evt",
  },
});
const toolResult = (
  id: string,
  content: unknown,
  isError?: boolean,
): Block => ({
  type: "tool_result",
  tool_use_id: id,
  ...(content === undefined ? {} : { content }),
  ...(isError === undefined ? {} : { is_error: isError }),
});
const user = (content: unknown, parent?: string | null): Op => ({
  op: "event",
  event: {
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: parent ?? null,
    session_id: "cli-session-1",
  },
});
const init = (extra: Record<string, unknown> = {}): Op => ({
  op: "event",
  event: {
    type: "system",
    subtype: "init",
    cwd: "/tmp/worktree",
    session_id: "cli-session-1",
    model: MODEL,
    permissionMode: "default",
    tools: [{ name: "Read" }, { name: "Edit" }, { name: "Bash" }, { name: "Task" }],
    slash_commands: ["compact", "review", "commit"],
    skills: ["commit", "pdf"],
    ...extra,
  },
});
const state = (s: string): Op => ({
  op: "event",
  event: { type: "system", subtype: "session_state_changed", state: s },
});
const result = (extra: Record<string, unknown> = {}): Op => ({
  op: "event",
  event: {
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 4200,
    duration_api_ms: 3900,
    num_turns: 2,
    result: "Done.",
    session_id: "cli-session-1",
    total_cost_usd: 0.0123,
    usage: USAGE,
    modelUsage: {
      [MODEL]: { inputTokens: 1200, outputTokens: 80, contextWindow: 1_000_000 },
      "claude-haiku-4-5-20251001": { inputTokens: 300, contextWindow: 200_000 },
    },
    ...extra,
  },
});
const sysMsg = (
  id: string,
  textBlocks: string[],
  extra: Partial<store.ConversationMessage> = {},
): store.ConversationMessage => ({
  id,
  role: "system",
  textBlocks,
  toolCalls: [],
  timestamp: 1_750_000_000_000,
  ...extra,
});

// --- Scenarios -------------------------------------------------------------

it("generates conversation fixtures", async () => {
  await generate("plain-text-turn", "A typed prompt answered with text only.", [
    { op: "userMessage", text: "What does EpisodeLoader do?" },
    init(),
    state("running"),
    assistant([text("It loads episodes from the network client.")]),
    assistant([text("  "), text("Nothing is cached yet.")]),
    result(),
    state("idle"),
  ]);

  await generate(
    "tool-results",
    "tool_use + tool_result: text, error, image, tool_reference, object and missing content, deny-answer flow.",
    [
      { op: "userMessage", text: "Check the screenshot and fix the build." },
      init(),
      assistant([text("Reading the file."), toolUse("tu_read", "Read", { file_path: "src/a.ts" })]),
      user([toolResult("tu_read", "  1\texport const a = 1;")]),
      assistant([toolUse("tu_bash", "Bash", { command: "pnpm build", description: "Build" })]),
      user([toolResult("tu_bash", "error TS2304: Cannot find name 'b'.", true)]),
      assistant([toolUse("tu_shot", "Read", { file_path: "shot.png" })]),
      user([
        toolResult("tu_shot", [
          { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } },
          { type: "text", text: "Screenshot attached" },
        ]),
      ]),
      assistant([toolUse("tu_search", "ToolSearch", { query: "notebook" })]),
      user([
        toolResult("tu_search", [
          { type: "tool_reference", tool_name: "NotebookEdit" },
          { type: "tool_reference", tool_name: "NotebookRead" },
          { type: "unknown_block", value: 1 },
        ]),
      ]),
      assistant([toolUse("tu_obj", "mcp__x__status", {})]),
      // Keys sorted: Swift's JSONValue can't keep insertion order.
      user([toolResult("tu_obj", { status: { count: 3, ok: true, ratio: 0.5 } })]),
      assistant([toolUse("tu_empty", "Bash", { command: "true" })]),
      user([toolResult("tu_empty", undefined), toolResult("tu_missing", "no such call")]),
      assistant([
        toolUse("tu_ask", "AskUserQuestion", {
          questions: [{ question: "Which target?", options: [{ label: "iOS" }] }],
        }),
      ]),
      user([toolResult("tu_ask", "User answered: iOS", true)]),
      user([]),
      result(),
    ],
  );

  await generate("parallel-tools", "Several tool calls in one assistant message, results out of order.", [
    { op: "userMessage", text: "Look around." },
    assistant([
      text("Running three in parallel."),
      toolUse("p1", "Glob", { pattern: "**/*.swift" }),
      toolUse("p2", "Grep", { pattern: "TODO" }),
      toolUse("p3", "Read", { file_path: "README.md" }),
    ]),
    user([toolResult("p3", "# Readme"), toolResult("p1", "a.swift\nb.swift")]),
    user([toolResult("p2", "", false)]),
    result({ modelUsage: undefined }),
  ]);

  await generate(
    "subagent",
    "A Task sub-agent whose events nest via parent_tool_use_id, a nested Agent, a thinking block, a background result.",
    [
      { op: "userMessage", text: "Investigate the crash." },
      init(),
      assistant([
        text("Spawning an investigator."),
        toolUse("task_1", "Task", { description: "Investigate", prompt: "Find the crash", subagent_type: "general-purpose" }),
      ]),
      assistant(
        [
          { type: "thinking", thinking: "Let me look at logs.", signature: "sig" },
          text("Looking at logs."),
          toolUse("sub_1", "Bash", { command: "tail crash.log" }),
          toolUse("sub_2", "Agent", { description: "Deeper", prompt: "Dig in" }),
        ],
        "task_1",
      ),
      { op: "permissionPending", request: { request_id: "req-1", tool_name: "Bash", tool_input: { command: "tail crash.log" }, tool_use_id: "sub_1" } },
      { op: "clearPermission", toolUseId: "sub_1" },
      user([toolResult("sub_1", "Fatal error: index out of range")], "task_1"),
      assistant([toolUse("deep_1", "Read", { file_path: "Player.swift" })], "sub_2"),
      user([toolResult("deep_1", "func play() {}")], "sub_2"),
      assistant([text("orphan")], "nope"),
      user([toolResult("ghost", "x")], "task_1"),
      user([toolResult("sub_2", "Found it in Player.swift")], "task_1"),
      assistant([
        text("Starting a background agent while I continue."),
        toolUse("bg_1", "Agent", { description: "Background", prompt: "Watch", run_in_background: true }),
      ]),
      user([toolResult("task_1", [{ type: "text", text: "The crash is an index out of range in Player.swift." }])]),
      assistant([text("Fixed.")]),
      user([toolResult("bg_1", "Background done")]),
      result(),
    ],
  );

  await generate(
    "todos-tasks",
    "TodoWrite overwrite + dismiss, TaskCreate/TaskUpdate/TaskList/TaskGet folding, delete, clear and recovery.",
    [
      { op: "userMessage", text: "Plan the work." },
      assistant([
        toolUse("todo_1", "TodoWrite", {
          todos: [
            { id: "1", content: "Read code", status: "in_progress", priority: "high" },
            { content: "Write fix", status: "pending", activeForm: "Writing fix" },
          ],
        }),
      ]),
      user([toolResult("todo_1", "Todos have been modified successfully.")]),
      assistant([
        toolUse("todo_2", "TodoWrite", {
          todos: [
            { content: "Read code", status: "completed", activeForm: "Reading code" },
            { content: "Write fix", status: "in_progress", activeForm: "Writing fix" },
            { content: "", status: "pending" },
            { content: "Ship", status: "blocked" },
          ],
        }),
      ]),
      user([toolResult("todo_2", "ok")]),
      assistant([
        toolUse("tc_1", "TaskCreate", { subject: "Reproduce crash", description: "Run the app", activeForm: "Reproducing" }),
        toolUse("tc_2", "TaskCreate", { subject: "Write regression test" }),
        toolUse("tc_3", "TaskCreate", { subject: "Unresolved create" }),
      ]),
      user([
        toolResult("tc_1", "Task #1 created successfully: Reproduce crash"),
        toolResult("tc_2", JSON.stringify({ id: "2", subject: "Write regression test", status: "pending", owner: "me", metadata: { area: "player" } })),
        toolResult("tc_3", "created"),
      ]),
      assistant([
        toolUse("tu_1", "TaskUpdate", { taskId: "1", status: "in_progress", addBlocks: ["2"], owner: "agent" }),
        toolUse("tu_2", "TaskUpdate", { taskId: "2", addBlockedBy: ["1", 7] }),
      ]),
      user([toolResult("tu_1", "Updated task #1"), toolResult("tu_2", "Updated task #2")]),
      assistant([toolUse("tl_1", "TaskList", {})]),
      user([
        toolResult(
          "tl_1",
          JSON.stringify([
            { id: "1", subject: "Reproduce crash", status: "in_progress" },
            { id: "3", subject: "From list", status: "weird" },
            { id: "4", subject: "Gone", status: "deleted" },
            { subject: "No id" },
          ]),
        ),
      ]),
      assistant([toolUse("tg_1", "TaskGet", { taskId: "2" })]),
      user([toolResult("tg_1", JSON.stringify({ id: "2", subject: "Write regression test (renamed)", status: "completed", blocks: [] }))]),
      assistant([toolUse("tu_3", "TaskUpdate", { taskId: "3", status: "deleted" })]),
      user([toolResult("tu_3", "Deleted")]),
      { op: "clearTasks" },
      { op: "clearTodos" },
      assistant([toolUse("tu_4", "TaskUpdate", { taskId: "1", status: "completed" })]),
      user([toolResult("tu_4", "Updated task #1")]),
      assistant([toolUse("tu_5", "TaskUpdate", { taskId: "99", status: "completed" })]),
      user([toolResult("tu_5", "No such task")]),
      assistant([toolUse("todo_3", "TodoWrite", { todos: [{ content: "Again", status: "pending" }] })]),
      result(),
    ],
  );

  await generate(
    "permissions",
    "Permission request then resolve, one cancelled, one for an unknown tool call, one left pending.",
    [
      { op: "permissionPending", request: { request_id: "r0", tool_name: "Bash", tool_input: {}, tool_use_id: "nothing-yet" } },
      { op: "userMessage", text: "Deploy it." },
      assistant([toolUse("perm_bash", "Bash", { command: "./deploy.sh" })]),
      { op: "permissionPending", request: { request_id: "r1", tool_name: "Bash", tool_input: { command: "./deploy.sh" }, tool_use_id: "perm_bash", permission_suggestions: [{ type: "addRules", tool: "Bash", prefix: "./deploy.sh" }] } },
      { op: "clearPermission", toolUseId: "perm_bash" },
      user([toolResult("perm_bash", "Deployed")]),
      assistant([toolUse("perm_edit", "Edit", { file_path: "a.ts", old_string: "a", new_string: "b" })]),
      { op: "permissionPending", request: { request_id: "r2", tool_name: "Edit", tool_input: {}, tool_use_id: "perm_edit" } },
      { op: "cancelPermission", toolUseId: "perm_edit" },
      { op: "permissionPending", request: { request_id: "r3", tool_name: "Bash", tool_input: {}, tool_use_id: "unknown" } },
      { op: "cancelPermission", toolUseId: "unknown" },
      assistant([toolUse("perm_plan", "ExitPlanMode", { plan: "1. Do it" })]),
      { op: "permissionPending", request: { request_id: "r4", tool_name: "ExitPlanMode", tool_input: { plan: "1. Do it" }, tool_use_id: "perm_plan" } },
      state("requires_action"),
    ],
  );

  await generate(
    "system-result",
    "system:init merging slash commands, results with usage/cost/modelUsage context windows, api_retry, status, setModel, setCapabilities.",
    [
      {
        op: "setCapabilities",
        capabilities: {
          commands: [
            { name: "review", description: "Review the diff", argumentHint: "[pr]" },
            { name: "compact", description: "Compact context", argumentHint: "" },
          ],
          models: [{ value: "default", displayName: "Default", description: "Opus 4.8 with 1M context" }],
          account: { email: "dev@example.com" },
          agents: [],
          availableOutputStyles: ["default"],
          outputStyle: "default",
        },
      },
      init(),
      { op: "event", event: { type: "system", subtype: "status", status: "compacting" } },
      { op: "event", event: { type: "system", subtype: "api_retry", attempt: 1, max_retries: 10, retry_delay_ms: 1499, error_status: 529, error: "overloaded" } },
      { op: "event", event: { type: "system", subtype: "api_retry", attempt: 2, max_retries: 10, retry_delay_ms: 3000, error_status: null } },
      { op: "event", event: { type: "system", subtype: "hook_response", hook_name: "x" } },
      { op: "event", event: { type: "rate_limit_event", rate_limit_info: {} } },
      assistant([text("Working.")]),
      result(),
      { op: "setModel", model: "claude-sonnet-5" },
      result({
        total_cost_usd: 0.5,
        duration_ms: 1000,
        modelUsage: { "claude-haiku-4-5-20251001": { contextWindow: 200_000 }, "claude-x": { contextWindow: 400_000 }, bad: { contextWindow: 0 } },
      }),
      result({ total_cost_usd: undefined, duration_ms: undefined, modelUsage: {} }),
      { op: "event", event: { type: "result", subtype: "error", duration_ms: 10, total_cost_usd: 0, usage: USAGE, modelUsage: { "claude-sonnet-5": { contextWindow: 200_000 } } } },
      init({ model: "claude-sonnet-5", slash_commands: ["review", "new-one"], skills: undefined, tools: [{ name: "Read" }] }),
      state("idle"),
    ],
  );

  const saved: store.ConversationMessage[] = [
    { id: "s1", role: "user", textBlocks: ["Start the refactor"], toolCalls: [], timestamp: 1_750_000_000_000, checkpointId: "cp-1" },
    {
      id: "s2",
      role: "assistant",
      textBlocks: ["Planning."],
      timestamp: 1_750_000_001_000,
      usage: { input_tokens: 10, output_tokens: 5 },
      toolCalls: [
        { id: "st1", name: "TodoWrite", input: { todos: [{ content: "Refactor", status: "in_progress", activeForm: "Refactoring" }] }, result: "ok", isError: false },
        { id: "st2", name: "TaskCreate", input: { subject: "Split file" }, result: "Task #7 created successfully: Split file", isError: false },
        {
          id: "st3",
          name: "Task",
          input: { prompt: "help" },
          result: [{ type: "text", text: "sub done" }],
          isError: false,
          children: [
            { kind: "text", text: "sub text" },
            { kind: "tool_use", toolCall: { id: "st4", name: "TaskUpdate", input: { taskId: "7", status: "completed" }, result: "Updated", isError: false } },
          ],
        },
      ],
    },
  ];

  await generate(
    "resume",
    "loadSavedMessages for a --resume, the CLI's replay of the last turn dropped until the first result, then a fresh turn.",
    [
      { op: "loadSaved", messages: saved, model: MODEL, sessionId: "cli-session-0", resuming: true, title: "Refactor the player" },
      init({ session_id: "cli-session-1" }),
      assistant([text("Planning. (replayed)")]),
      user([toolResult("st1", "replayed")]),
      { op: "event", event: { type: "system", subtype: "api_retry", attempt: 1, max_retries: 3, retry_delay_ms: 500, error_status: null } },
      result({ total_cost_usd: 9 }),
      { op: "userMessage", text: "Continue." },
      assistant([text("Continuing.")]),
      result(),
      { op: "migrate" },
      assistant([text("Replay after restart")]),
      { op: "userMessage", text: "Again." },
      assistant([text("Live again.")]),
      { op: "loadSaved", messages: [] },
    ],
  );

  await generate(
    "user-images-injected",
    "A user message with images, checkpoint and author, an MCP-injected prompt ending a resume, stderr system messages, title.",
    [
      { op: "setTitle", title: "ignored, no conversation yet" },
      { op: "loadSaved", messages: [], sessionId: "cli-session-0", resuming: true },
      {
        op: "injectedPrompt",
        message: sysMsg("mcp-1", ["Please run the tests"], {
          images: [{ data: PNG, media_type: "image/png" }],
          source: { kind: "mcp", tool: "send_agent_message", parentAgentId: "parent-9", parentLabel: "Root agent" },
        }),
      },
      assistant([text("Running tests.")]),
      {
        op: "userMessage",
        text: "Here's what I see",
        images: [
          { data: PNG, media_type: "image/png" },
          { data: PNG, media_type: "image/jpeg" },
        ],
        checkpointId: "cp-42",
        author: "Sam",
      },
      { op: "userMessage", text: "No images", images: [] },
      { op: "systemMessage", message: sysMsg("err-1", ["Error: Invalid API key"], { tone: "error" }) },
      { op: "systemMessage", message: sysMsg("warn-1", ["Hook failed", "exit code 1"], { tone: "warning" }) },
      { op: "injectedPrompt", message: sysMsg("mcp-2", ["Spawned"], { source: { kind: "mcp", tool: "spawn_agent" } }) },
      { op: "setTitle", title: "Run the tests" },
    ],
  );

  await generate(
    "quirks",
    "Shapes the renderer handles by accident: string user content, init without model, assistant without usage, unknown types.",
    [
      { op: "userMessage", text: "hi" },
      { op: "event", event: { type: "system", subtype: "init", session_id: "s", tools: [] } },
      { op: "event", event: { type: "assistant", message: { content: [text("no usage, no model")] } } },
      assistant([toolUse("q1", "Bash", { command: "ls" })]),
      user("a replayed user prompt"),
      { op: "event", event: { type: "stream_event", event: { type: "content_block_delta" } } },
      { op: "event", event: { type: "user", message: { content: [toolResult("q1", null)] } } },
    ],
  );
});
