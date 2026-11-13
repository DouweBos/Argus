import type {
  AgentConversation,
  ConversationMessage,
  ToolCallInfo,
} from "../conversation/types";
import { describe, expect, it } from "vitest";
import {
  INLINE_SEED_TOKENS,
  MCP_SEED_TOKENS,
  buildHandoffSeed,
  buildHistorySeed,
  estimateTokens,
  withHistorySeed,
} from "./seed";

function msg(
  role: ConversationMessage["role"],
  text: string,
  toolCalls: ToolCallInfo[] = [],
): ConversationMessage {
  return {
    id: crypto.randomUUID(),
    role,
    textBlocks: [text],
    toolCalls,
    timestamp: 0,
  };
}

function bash(command: string, result: string, isError = false): ToolCallInfo {
  return {
    id: crypto.randomUUID(),
    name: "Bash",
    input: { command },
    result,
    isError,
  };
}

function seed(conversation: AgentConversation, mcp = true) {
  return buildHandoffSeed({
    conversation,
    fromAgentId: "agent-1",
    fromRunner: "Claude Code",
    mcp,
  });
}

describe("buildHandoffSeed", () => {
  it("carries the request, todos, edits, commands and recent turns", () => {
    const { text, omittedMessages } = seed({
      todos: [
        { content: "Add the endpoint", status: "completed" },
        { content: "Write tests", status: "in_progress" },
      ],
      messages: [
        msg("user", "Add a /health endpoint"),
        msg("assistant", "Adding it.", [
          {
            id: "e1",
            name: "Edit",
            input: { file_path: "src/server.ts" },
            result: "ok",
          },
          bash("pnpm test", "1 failed\nExpected 200, got 404", true),
        ]),
        msg("system", "stderr noise"),
      ],
    });

    expect(text).toContain("## Original request\n\nAdd a /health endpoint");
    expect(text).toContain("- [x] Add the endpoint");
    expect(text).toContain("- [~] Write tests");
    expect(text).toContain("- src/server.ts");
    expect(text).toContain("`pnpm test` → failed");
    expect(text).toContain("Expected 200, got 404");
    expect(text).toContain("**Claude Code:** Adding it.");
    expect(text).not.toContain("stderr noise");
    expect(text).toContain('read_agent_transcript` with `agent_id: "agent-1"');
    expect(omittedMessages).toBe(0);
  });

  it("leaves the transcript tool out for agents that can't reach MCP", () => {
    const { text } = seed({ messages: [msg("user", "Hi")] }, false);

    expect(text).not.toContain("read_agent_transcript");
  });

  it("keeps the newest turns within budget and the inline seed larger", () => {
    const messages = [msg("user", "Original ask")];
    for (let i = 0; i < 400; i++) {
      messages.push(
        msg(i % 2 ? "assistant" : "user", `turn ${i} ${"x".repeat(900)}`),
      );
    }
    const lean = seed({ messages });
    const inline = seed({ messages }, false);

    expect(estimateTokens(lean.text)).toBeLessThanOrEqual(
      MCP_SEED_TOKENS * 1.05,
    );
    expect(estimateTokens(inline.text)).toBeLessThanOrEqual(
      INLINE_SEED_TOKENS * 1.05,
    );
    expect(inline.omittedMessages).toBeLessThan(lean.omittedMessages);
    expect(lean.text).toContain("turn 399");
    expect(lean.text).toContain("Original ask");
    expect(lean.text).toMatch(/_\d+ earlier messages left out\._/);
  });

  it("keeps a long command output's tail, where the error is", () => {
    const { text } = seed({
      messages: [
        msg("user", "Build it"),
        msg("assistant", "", [
          bash(
            "pnpm build",
            `${"noise\n".repeat(500)}error TS2322: boom`,
            true,
          ),
        ]),
      ],
    });

    expect(text).toContain("error TS2322: boom");
  });
});

describe("buildHistorySeed", () => {
  it("keeps the chat inline, with no transcript tool to page past the cut", () => {
    const { text } = buildHistorySeed(
      [
        msg("user", "Add a login page"),
        msg("assistant", "Done", [bash("pnpm test", "ok")]),
      ],
      "Gemini CLI",
    );
    expect(text).toContain("Add a login page");
    expect(text).toContain("**Gemini CLI:** Done");
    expect(text).toContain("`pnpm test` → ok");
    expect(text).not.toContain("read_agent_transcript");
  });

  it("puts the seed ahead of the message it rides on", () => {
    const sent = withHistorySeed("HISTORY", "Now try again");
    expect(sent.indexOf("HISTORY")).toBeLessThan(sent.indexOf("Now try"));
    expect(sent.endsWith("Now try again")).toBe(true);
  });
});
