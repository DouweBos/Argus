/**
 * ACP `session/update`s → Claude Code stream-json lines.
 *
 * Every consumer of an agent's stream reads Claude's shape, so ACP agents
 * speak it too: message chunks gather into one assistant text block per
 * stretch, tool calls become the cards the clients already draw (`Bash`,
 * `Edit`/`Write`, `Read`, ...), plans `TodoWrite`, and a finished prompt a
 * `result` with whatever usage the agent reported.
 */

import type {
  AcpContentBlock,
  AcpPlanEntry,
  AcpPromptResult,
  AcpSessionUpdate,
  AcpToolCall,
  AcpToolContent,
} from "./protocol";

type Block = Record<string, unknown>;

export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface CallState {
  call: AcpToolCall;
  /** Card ids drawn so far; empty until the call has enough to draw. */
  drawn: string[];
  done: boolean;
}

export class AcpTranscript {
  private model: string | null = null;
  private sessionId: string | null = null;
  private text = "";
  private thought = "";
  private lastText = "";
  private planSeq = 0;
  private turnStartedAt = 0;
  private contextWindow: number | null = null;
  private contextUsed: number | null = null;
  /** The session's running cost as last reported; null until the agent reports one. */
  private costUsd: number | null = null;
  /** Running cost at the last result, so each result carries only its turn's spend. */
  private costBilled = 0;
  private readonly calls = new Map<string, CallState>();

  setModel(model: string | null): void {
    this.model = model;
  }

  /** The `system:init` line: session id, model and mode for the reducer. */
  init(sessionId: string, model: string | null, mode: string): string[] {
    this.sessionId = sessionId;
    this.model = model;

    return [
      line({
        type: "system",
        subtype: "init",
        session_id: sessionId,
        model: model ?? "default",
        permissionMode: mode,
        tools: [],
        slash_commands: [],
        mcp_servers: [],
      }),
    ];
  }

  turnStarted(): string[] {
    this.turnStartedAt = Date.now();
    this.lastText = "";

    return [state("running", this.sessionId)];
  }

  update(u: AcpSessionUpdate): string[] {
    switch (u.sessionUpdate) {
      case "agent_message_chunk": {
        // Thinking that came before this text closes first.
        const out = this.flushThought();
        this.text += textOf(u.content);

        return out;
      }
      case "agent_thought_chunk":
        this.thought += textOf(u.content);

        return this.flushText();
      case "tool_call":
      case "tool_call_update":
        return [...this.flush(), ...this.toolCall(u)];
      case "plan":
        return [...this.flush(), ...this.plan(u.entries)];
      case "usage_update":
        this.contextUsed = u.used ?? this.contextUsed;
        this.contextWindow = u.size ?? this.contextWindow;
        if (u.cost?.currency === "USD" && typeof u.cost.amount === "number") {
          this.costUsd = u.cost.amount;
        }

        return [];
      default:
        return [];
    }
  }

  /** Merge a permission request's view of a call, so its card can draw. */
  noteCall(call: AcpToolCall): string[] {
    return [...this.flush(), ...this.toolCall(call)];
  }

  /** Card id a permission request answers to: the call's first card. */
  cardId(toolCallId: string): string {
    return this.calls.get(toolCallId)?.drawn[0] ?? toolCallId;
  }

  /** Everything the agent has said about a call so far. */
  call(toolCallId: string): AcpToolCall | null {
    return this.calls.get(toolCallId)?.call ?? null;
  }

  turnCompleted(res: AcpPromptResult | null, error: string | null): string[] {
    const out = [...this.flush(), ...this.closeOpenCalls(error !== null)];
    const failed = error !== null;
    const interrupted = res?.stopReason === "cancelled";
    const usage = res?.usage ?? null;
    const model = this.model ?? "default";
    const input = usage?.inputTokens ?? 0;
    const cached = usage?.cachedReadTokens ?? 0;
    // `usage_update` cost is the session's running total; a result reports its turn.
    const turnCost =
      this.costUsd === null
        ? null
        : Math.max(0, this.costUsd - this.costBilled);
    this.costBilled = this.costUsd ?? this.costBilled;
    out.push(
      line({
        type: "result",
        subtype: failed || interrupted ? "error_during_execution" : "success",
        is_error: failed,
        result: failed ? error : this.lastText,
        duration_ms: Date.now() - this.turnStartedAt,
        num_turns: 1,
        session_id: this.sessionId,
        ...(turnCost === null ? {} : { total_cost_usd: turnCost }),
        usage: usage
          ? {
              input_tokens: Math.max(0, input - cached),
              cache_read_input_tokens: cached,
              output_tokens: usage.outputTokens ?? 0,
            }
          : undefined,
        modelUsage: {
          [model]: {
            inputTokens: usage ? input : (this.contextUsed ?? 0),
            outputTokens: usage?.outputTokens ?? 0,
            cacheReadInputTokens: cached,
            contextWindow: this.contextWindow ?? undefined,
          },
        },
      }),
      state("idle", this.sessionId),
    );

    return out;
  }

  // -------------------------------------------------------------------------

  private flush(): string[] {
    return [...this.flushThought(), ...this.flushText()];
  }

  private flushText(): string[] {
    const text = this.text;
    this.text = "";
    if (!text.trim()) {
      return [];
    }
    this.lastText = text;

    return [this.assistant([{ type: "text", text }])];
  }

  private flushThought(): string[] {
    const thinking = this.thought;
    this.thought = "";

    return thinking.trim()
      ? [this.assistant([{ type: "thinking", thinking, signature: "" }])]
      : [];
  }

  private toolCall(update: AcpToolCall): string[] {
    const prev = this.calls.get(update.toolCallId);
    const call = merge(prev?.call, update);
    const s: CallState = prev ?? { call, drawn: [], done: false };
    s.call = call;
    this.calls.set(call.toolCallId, s);
    const out: string[] = [];
    const terminal = call.status === "completed" || call.status === "failed";
    if (s.drawn.length === 0 && (drawable(call) || terminal)) {
      const uses = toolUses(call);
      s.drawn = uses.map((u) => u.id);
      out.push(this.assistant(uses.map(toolUseBlock)));
    }
    if (terminal && !s.done && s.drawn.length > 0) {
      s.done = true;
      const failed = call.status === "failed";
      const content = resultText(call);
      for (const id of s.drawn) {
        out.push(toolResult(id, content, failed));
      }
    }

    return out;
  }

  /** Calls the agent never finished when the prompt ended. */
  private closeOpenCalls(failed: boolean): string[] {
    const out: string[] = [];
    for (const s of this.calls.values()) {
      if (s.done) {
        continue;
      }
      if (s.drawn.length === 0) {
        s.drawn = toolUses(s.call).map((u) => u.id);
        out.push(this.assistant(toolUses(s.call).map(toolUseBlock)));
      }
      for (const id of s.drawn) {
        out.push(toolResult(id, failed ? "Failed" : "Stopped", true));
      }
      s.done = true;
    }
    this.calls.clear();

    return out;
  }

  private plan(entries: AcpPlanEntry[]): string[] {
    const id = `acp-plan-${++this.planSeq}`;
    const todos = entries.map((e) => ({
      content: e.content,
      activeForm: e.content,
      status: e.status,
    }));

    return [
      this.assistant([
        toolUseBlock({ id, name: "TodoWrite", input: { todos } }),
      ]),
      toolResult(id, "Plan updated", false),
    ];
  }

  private assistant(content: Block[]): string {
    return line({
      type: "assistant",
      session_id: this.sessionId,
      parent_tool_use_id: null,
      message: { role: "assistant", model: this.model, content },
    });
  }
}

function merge(prev: AcpToolCall | undefined, next: AcpToolCall): AcpToolCall {
  if (!prev) {
    return { ...next };
  }
  const out: AcpToolCall = { ...prev };
  for (const [k, v] of Object.entries(next)) {
    if (v !== undefined && v !== null) {
      (out as unknown as Record<string, unknown>)[k] = v;
    }
  }

  return out;
}

/** An edit's card needs its diff (or at least its path) before it can draw. */
function drawable(call: AcpToolCall): boolean {
  if (call.kind !== "edit") {
    return true;
  }

  return diffs(call).length > 0;
}

function diffs(call: AcpToolCall): Extract<AcpToolContent, { type: "diff" }>[] {
  return (call.content ?? []).filter(
    (c): c is Extract<AcpToolContent, { type: "diff" }> => c.type === "diff",
  );
}

/** The tool cards an ACP call renders as. */
export function toolUses(call: AcpToolCall): ToolUse[] {
  const id = call.toolCallId;
  const raw = asRecord(call.rawInput);
  const title = call.title ?? "";
  const path =
    call.locations?.[0]?.path ?? str(raw.path) ?? str(raw.file_path) ?? null;
  switch (call.kind) {
    case "execute":
      return [
        {
          id,
          name: "Bash",
          input: {
            command: str(raw.command) ?? commandOf(raw) ?? title,
            ...(title && str(raw.command) ? { description: title } : {}),
          },
        },
      ];
    case "edit": {
      const ds = diffs(call);
      if (ds.length === 0) {
        return [{ id, name: "Edit", input: { file_path: path ?? title } }];
      }

      return ds.map((d, i) => ({
        id: ds.length === 1 ? id : `${id}:${i}`,
        ...(d.oldText
          ? {
              name: "Edit",
              input: {
                file_path: d.path,
                old_string: d.oldText,
                new_string: d.newText,
              },
            }
          : {
              name: "Write",
              input: { file_path: d.path, content: d.newText },
            }),
      }));
    }
    case "read":
      return [{ id, name: "Read", input: { file_path: path ?? title } }];
    case "delete":
      return [{ id, name: "Delete", input: { file_path: path ?? title } }];
    case "search":
      return [
        {
          id,
          name: "Grep",
          input: {
            pattern: str(raw.pattern) ?? str(raw.query) ?? title,
            ...(path ? { path } : {}),
          },
        },
      ];
    case "fetch":
      return str(raw.url)
        ? [{ id, name: "WebFetch", input: { url: str(raw.url) } }]
        : [
            {
              id,
              name: "WebSearch",
              input: { query: str(raw.query) ?? title },
            },
          ];
    default:
      return [
        {
          id,
          name: title || "Tool",
          input: Object.keys(raw).length > 0 ? raw : {},
        },
      ];
  }
}

function resultText(call: AcpToolCall): string {
  const parts: string[] = [];
  for (const c of call.content ?? []) {
    if (c.type === "content") {
      parts.push(textOf(c.content));
    } else if (c.type === "diff") {
      parts.push(`Updated ${c.path}`);
    }
  }
  const text = parts.filter(Boolean).join("\n");
  if (text) {
    return text;
  }
  if (call.rawOutput === undefined || call.rawOutput === null) {
    return call.status === "failed" ? "Failed" : "";
  }
  const raw = asRecord(call.rawOutput);

  return (
    str(raw.output) ??
    str(raw.stdout) ??
    str(raw.content) ??
    (typeof call.rawOutput === "string"
      ? call.rawOutput
      : JSON.stringify(call.rawOutput))
  );
}

export function textOf(block: AcpContentBlock | undefined): string {
  if (!block) {
    return "";
  }
  if (block.type === "text" && typeof block.text === "string") {
    return block.text;
  }
  if (block.type === "resource_link" && typeof block.uri === "string") {
    return block.uri;
  }

  return "";
}

function commandOf(raw: Record<string, unknown>): string | null {
  const cmd = raw.cmd ?? raw.argv;
  if (Array.isArray(cmd)) {
    return cmd.map(String).join(" ");
  }

  return str(cmd);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return value === undefined || value === null ? {} : { value };
}

function toolUseBlock(use: ToolUse): Block {
  return { type: "tool_use", id: use.id, name: use.name, input: use.input };
}

function toolResult(toolUseId: string, content: string, isError: boolean) {
  return line({
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content,
          is_error: isError,
        },
      ],
    },
  });
}

function state(value: "idle" | "running", sessionId: string | null): string {
  return line({
    type: "system",
    subtype: "session_state_changed",
    state: value,
    session_id: sessionId,
  });
}

function line(event: object): string {
  return JSON.stringify(event);
}
