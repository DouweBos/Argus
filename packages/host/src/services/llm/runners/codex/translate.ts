/**
 * Codex app-server notifications → Claude Code stream-json lines.
 *
 * Every consumer of an agent's stream (the host's conversation reducer,
 * vitals, the clients' transcript) reads Claude's shape, so Codex speaks it
 * too: commands become `Bash` cards, patches `Edit`/`Write`, MCP calls
 * `mcp__server__tool`, plan updates `TodoWrite`, and a finished turn a
 * `result` carrying its token usage.
 */

import type {
  CodexFileChange,
  CodexThreadItem,
  CodexThreadTokenUsage,
  CodexTurn,
} from "./protocol";

type Block = Record<string, unknown>;

interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export class CodexTranscript {
  private model: string | null = null;
  private usage: CodexThreadTokenUsage | null = null;
  private lastText = "";
  private planSeq = 0;
  private turnStartedAt = 0;

  constructor(private sessionId: string | null = null) {}

  setModel(model: string | null): void {
    this.model = model;
  }

  /** The `system:init` line: session id, model and mode for the reducer. */
  init(threadId: string, model: string, permissionMode: string): string[] {
    this.sessionId = threadId;
    this.model = model;

    return [
      line({
        type: "system",
        subtype: "init",
        session_id: threadId,
        model,
        permissionMode,
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

  tokenUsage(usage: CodexThreadTokenUsage): void {
    this.usage = usage;
  }

  itemStarted(item: CodexThreadItem): string[] {
    const uses = toolUses(item);

    return uses.length > 0 ? [this.assistant(uses.map(toolUseBlock))] : [];
  }

  itemCompleted(item: CodexThreadItem): string[] {
    switch (item.type) {
      case "agentMessage":
        if (!item.text) {
          return [];
        }
        this.lastText = item.text;

        return [this.assistant([{ type: "text", text: item.text }])];
      case "commandExecution":
        return [
          toolResult(
            item.id,
            item.aggregatedOutput ?? "",
            item.status !== "completed" || (item.exitCode ?? 0) !== 0,
          ),
        ];
      case "fileChange":
        return toolUses(item).map((use) =>
          toolResult(
            use.id,
            item.status === "completed" ? "Applied" : `Patch ${item.status}`,
            item.status !== "completed",
          ),
        );
      case "mcpToolCall":
        return [
          toolResult(
            item.id,
            item.error?.message ?? item.result?.content ?? "",
            item.status === "failed" || item.error !== null,
          ),
        ];
      case "dynamicToolCall":
        return [
          toolResult(item.id, item.contentItems ?? "", item.success === false),
        ];
      case "webSearch":
        return [toolResult(item.id, "", false)];
      default:
        return [];
    }
  }

  /** Codex's step list maps onto the todo panel `TodoWrite` drives. */
  planUpdated(
    plan: { step: string; status: "completed" | "inProgress" | "pending" }[],
  ): string[] {
    const id = `codex-plan-${++this.planSeq}`;
    const todos = plan.map((p) => ({
      content: p.step,
      activeForm: p.step,
      status: p.status === "inProgress" ? "in_progress" : p.status,
    }));

    return [
      this.assistant([
        toolUseBlock({ id, name: "TodoWrite", input: { todos } }),
      ]),
      toolResult(id, "Plan updated", false),
    ];
  }

  turnCompleted(turn: CodexTurn): string[] {
    const failed = turn.status === "failed";
    const interrupted = turn.status === "interrupted";
    const last = this.usage?.last;
    const model = this.model ?? "codex";

    return [
      line({
        type: "result",
        subtype: failed || interrupted ? "error_during_execution" : "success",
        is_error: failed,
        result: failed ? (turn.error?.message ?? "Turn failed") : this.lastText,
        duration_ms: turn.durationMs ?? Date.now() - this.turnStartedAt,
        num_turns: 1,
        session_id: this.sessionId,
        // Codex doesn't report spend; tokens are the usage it has.
        total_cost_usd: 0,
        usage: last ? claudeUsage(last) : undefined,
        modelUsage: {
          [model]: {
            inputTokens: last?.inputTokens ?? 0,
            outputTokens: last?.outputTokens ?? 0,
            cacheReadInputTokens: last?.cachedInputTokens ?? 0,
            contextWindow: this.usage?.modelContextWindow ?? undefined,
          },
        },
      }),
      state("idle", this.sessionId),
    ];
  }

  private assistant(content: Block[]): string {
    return line({
      type: "assistant",
      session_id: this.sessionId,
      parent_tool_use_id: null,
      message: {
        role: "assistant",
        model: this.model,
        content,
        usage: this.usage ? claudeUsage(this.usage.last) : undefined,
      },
    });
  }
}

/** The tool cards a Codex item renders as; empty for non-tool items. */
export function toolUses(item: CodexThreadItem): ToolUse[] {
  switch (item.type) {
    case "commandExecution":
      return [{ id: item.id, name: "Bash", input: { command: item.command } }];
    case "fileChange":
      return item.changes.map((change, i) => ({
        id: item.changes.length === 1 ? item.id : `${item.id}:${i}`,
        ...fileChangeTool(change),
      }));
    case "mcpToolCall":
      return [
        {
          id: item.id,
          name: `mcp__${item.server}__${item.tool}`,
          input: asRecord(item.arguments),
        },
      ];
    case "dynamicToolCall":
      return [
        { id: item.id, name: item.tool, input: asRecord(item.arguments) },
      ];
    case "webSearch":
      return [
        { id: item.id, name: "WebSearch", input: { query: item.query ?? "" } },
      ];
    default:
      return [];
  }
}

/** One patched file as the `Write`/`Edit` card the clients already draw. */
export function fileChangeTool(change: CodexFileChange): {
  name: string;
  input: Record<string, unknown>;
} {
  const file_path = change.kind.move_path ?? change.path;
  if (change.kind.type === "add") {
    const { added } = splitDiff(change.diff);

    return {
      name: "Write",
      input: { file_path, content: added ?? change.diff },
    };
  }
  if (change.kind.type === "delete") {
    return { name: "Delete", input: { file_path } };
  }
  const { removed, added } = splitDiff(change.diff);

  return {
    name: "Edit",
    input: {
      file_path,
      old_string: removed ?? "",
      new_string: added ?? change.diff,
    },
  };
}

/**
 * Old and new text of a unified diff, context lines in both and hunks
 * separated by a blank line. `null` when `diff` isn't a unified diff (Codex
 * sends a new file's plain content).
 */
export function splitDiff(diff: string): {
  removed: string | null;
  added: string | null;
} {
  const lines = diff.split("\n");
  if (!lines.some((l) => l.startsWith("@@"))) {
    return { removed: null, added: null };
  }
  const oldHunks: string[][] = [];
  const newHunks: string[][] = [];
  for (const l of lines) {
    if (l.startsWith("@@")) {
      oldHunks.push([]);
      newHunks.push([]);
      continue;
    }
    const oldHunk = oldHunks.at(-1);
    const newHunk = newHunks.at(-1);
    if (!oldHunk || !newHunk || l.startsWith("\\")) {
      continue;
    }
    if (l.startsWith("-")) {
      oldHunk.push(l.slice(1));
    } else if (l.startsWith("+")) {
      newHunk.push(l.slice(1));
    } else {
      const ctx = l.startsWith(" ") ? l.slice(1) : l;
      oldHunk.push(ctx);
      newHunk.push(ctx);
    }
  }
  const join = (hunks: string[][]) =>
    hunks.map((h) => trimTrailingBlank(h).join("\n")).join("\n\n");

  return { removed: join(oldHunks), added: join(newHunks) };
}

function trimTrailingBlank(lines: string[]): string[] {
  const out = [...lines];
  while (out.length > 0 && out.at(-1) === "") {
    out.pop();
  }

  return out;
}

function claudeUsage(u: CodexThreadTokenUsage["last"]): Record<string, number> {
  return {
    // OpenAI counts cached tokens inside input; Claude reports them apart.
    input_tokens: Math.max(0, u.inputTokens - u.cachedInputTokens),
    cache_read_input_tokens: u.cachedInputTokens,
    output_tokens: u.outputTokens,
  };
}

function toolUseBlock(use: ToolUse): Block {
  return { type: "tool_use", id: use.id, name: use.name, input: use.input };
}

function toolResult(
  toolUseId: string,
  content: unknown,
  isError: boolean,
): string {
  return line({
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content: typeof content === "string" ? content : asContent(content),
          is_error: isError,
        },
      ],
    },
  });
}

/** MCP content arrays already match Claude's; anything else becomes text. */
function asContent(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return value === undefined || value === null ? {} : { value };
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
