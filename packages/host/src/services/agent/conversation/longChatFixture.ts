/**
 * A synthetic long chat for perf tests and benchmarks: turns of prose, tool
 * calls with big outputs, subagents, todos and the odd screenshot. Seeded, so
 * every run folds the same transcript. Never derived from a real one.
 */

import type {
  AgentConversation,
  LlmContentBlock,
  LlmStreamEvent,
  LlmToolResult,
} from "./types";
import { emptyConversation, reduceEvent, withUserMessage } from "./reducer";

export type LongChatStep =
  | { event: LlmStreamEvent; kind: "event" }
  | { kind: "user"; text: string };

export interface LongChatOptions {
  /** Roughly how many conversation messages to produce. */
  messages?: number;
  seed?: number;
  /** Upper bound of a tool output, in bytes. */
  maxToolOutput?: number;
}

const WORDS =
  "the agent reads a file then edits the component so the store renders a page of rows while the host folds every event into one conversation and the phone pages older history on scroll".split(
    " ",
  );

function rng(seed: number): () => number {
  let s = seed >>> 0;

  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;

    return s / 2 ** 32;
  };
}

function prose(rand: () => number, words: number): string {
  const out: string[] = [];
  for (let i = 0; i < words; i++) {
    out.push(WORDS[Math.floor(rand() * WORDS.length)]!);
    if (i % 14 === 13) {
      out.push("\n\n");
    }
  }

  return out.join(" ");
}

function output(rand: () => number, bytes: number): string {
  const line = "    at render (src/components/Transcript.tsx:42:17) ok\n";
  const lines: string[] = [];
  let size = 0;
  let n = 0;
  while (size < bytes) {
    const l = `${n++} ${line}`;
    lines.push(l);
    size += l.length;
  }
  if (rand() < 0.01) {
    lines.push("error: something failed\n");
  }

  return lines.join("");
}

/** A tiny but valid PNG's worth of base64, padded to `bytes`. */
function imageData(bytes: number): string {
  return "iVBORw0KGgo".padEnd(bytes, "A");
}

const TOOLS = ["Read", "Bash", "Grep", "Edit", "Write", "Glob"] as const;

function toolInput(
  name: string,
  rand: () => number,
  n: number,
): Record<string, unknown> {
  const file = `src/feature${n % 40}/module${Math.floor(rand() * 20)}.ts`;
  switch (name) {
    case "Bash":
      return { command: `pnpm test src/feature${n % 40}`, description: "Run" };
    case "Grep":
      return { pattern: "useConversation", path: "app" };
    case "Edit":
      return {
        file_path: file,
        old_string: prose(rand, 20),
        new_string: prose(rand, 24),
      };
    case "Write":
      return { file_path: file, content: prose(rand, 200) };
    case "Glob":
      return { pattern: "**/*.tsx" };
    default:
      return { file_path: file };
  }
}

function assistant(
  content: LlmContentBlock[],
  parent?: string,
): LlmStreamEvent {
  return {
    type: "assistant",
    parent_tool_use_id: parent ?? null,
    message: {
      content,
      model: "claude-opus-5-5",
      usage: { input_tokens: 1200, output_tokens: 300 },
    },
  };
}

function results(blocks: LlmToolResult[], parent?: string): LlmStreamEvent {
  return {
    type: "user",
    parent_tool_use_id: parent ?? null,
    message: { content: blocks },
  };
}

/** The steps a long chat streams, in order. */
export function longChatSteps(options: LongChatOptions = {}): LongChatStep[] {
  const target = options.messages ?? 4000;
  const maxOut = options.maxToolOutput ?? 120_000;
  const rand = rng(options.seed ?? 7);
  const steps: LongChatStep[] = [
    {
      kind: "event",
      event: {
        type: "system",
        subtype: "init",
        model: "claude-opus-5-5",
        session_id: "00000000-0000-4000-8000-000000000001",
        tools: TOOLS.map((name) => ({ name })),
        slash_commands: ["compact", "review"],
      },
    },
  ];
  let messages = 0;
  let call = 0;
  let turn = 0;
  while (messages < target) {
    turn += 1;
    steps.push({ kind: "user", text: `Turn ${turn}: ${prose(rand, 30)}` });
    messages += 1;
    const toolRounds = 1 + Math.floor(rand() * 6);
    for (let r = 0; r < toolRounds && messages < target; r++) {
      const id = `toolu_${String(++call).padStart(8, "0")}`;
      const name =
        rand() < 0.05 ? "Task" : TOOLS[Math.floor(rand() * TOOLS.length)]!;
      const blocks: LlmContentBlock[] = [
        { type: "thinking", thinking: "…" },
        { type: "text", text: prose(rand, 20 + Math.floor(rand() * 80)) },
        {
          type: "tool_use",
          id,
          name,
          input:
            name === "Task"
              ? { description: "Explore", prompt: prose(rand, 40) }
              : toolInput(name, rand, call),
        },
      ];
      if (rand() < 0.03) {
        blocks.push({
          type: "tool_use",
          id: `${id}_todo`,
          name: "TodoWrite",
          input: {
            todos: [
              { content: "Fold", status: "completed", activeForm: "Folding" },
              { content: "Page", status: "in_progress", activeForm: "Paging" },
            ],
          },
        });
      }
      steps.push({ kind: "event", event: assistant(blocks) });
      messages += 1;
      if (name === "Task") {
        for (let c = 0; c < 4; c++) {
          const child = `${id}_c${c}`;
          steps.push({
            kind: "event",
            event: assistant(
              [
                { type: "text", text: prose(rand, 15) },
                {
                  type: "tool_use",
                  id: child,
                  name: "Read",
                  input: toolInput("Read", rand, c),
                },
              ],
              id,
            ),
          });
          steps.push({
            kind: "event",
            event: results(
              [
                {
                  type: "tool_result",
                  tool_use_id: child,
                  content: output(rand, 2_000 + rand() * 8_000),
                },
              ],
              id,
            ),
          });
        }
      }
      const bytes =
        rand() < 0.1
          ? maxOut * (0.5 + rand() / 2)
          : 500 + rand() * (maxOut / 20);
      const content: unknown =
        rand() < 0.02
          ? [
              { type: "text", text: "Screenshot" },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: imageData(60_000),
                },
              },
            ]
          : output(rand, bytes);
      const resultBlocks: LlmToolResult[] = [
        { type: "tool_result", tool_use_id: id, content },
      ];
      if (blocks.length === 4) {
        resultBlocks.push({
          type: "tool_result",
          tool_use_id: `${id}_todo`,
          content: "Todos updated",
        });
      }
      steps.push({ kind: "event", event: results(resultBlocks) });
    }
    if (messages < target) {
      steps.push({
        kind: "event",
        event: assistant([{ type: "text", text: prose(rand, 120) }]),
      });
      messages += 1;
    }
    steps.push({
      kind: "event",
      event: {
        type: "result",
        subtype: "success",
        duration_ms: 20_000,
        total_cost_usd: 0.12,
        usage: { input_tokens: 1200, output_tokens: 300 },
      },
    });
  }

  return steps;
}

/** Fold steps into a conversation the way the host does. */
export function foldLongChat(
  steps: LongChatStep[],
  from: AgentConversation = emptyConversation(),
): AgentConversation {
  let conv = from;
  for (const step of steps) {
    conv =
      step.kind === "user"
        ? withUserMessage(conv, step.text)
        : reduceEvent(conv, step.event);
  }

  return conv;
}

/**
 * One more turn to stream on top of a long chat: the events of a typical turn
 * with text growing token by token is not what the CLI sends (it sends whole
 * blocks), so this is the CLI's real granularity.
 */
export function streamingTurn(seed = 99): LongChatStep[] {
  return longChatSteps({ messages: 40, seed, maxToolOutput: 40_000 }).slice(1);
}
