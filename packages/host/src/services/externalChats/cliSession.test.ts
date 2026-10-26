import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isCliSessionId, readCliSession, trimMessages } from "./cliSession";

const ID = "2a542c2c-60c4-4fb8-9357-8206da2b931d";

function write(lines: object[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-session-"));
  const file = path.join(dir, `${ID}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n"));

  return file;
}

const base = { sessionId: ID, cwd: "/repo", gitBranch: "main" };

describe("readCliSession", () => {
  it("keeps the conversation text and drops tools, sidechains and CLI noise", async () => {
    const file = write([
      {
        ...base,
        type: "user",
        timestamp: "2026-10-01T10:00:00Z",
        message: { content: "Fix the login bug\nmore detail" },
      },
      {
        ...base,
        type: "user",
        isMeta: true,
        message: { content: "Caveat: ignore" },
      },
      {
        ...base,
        type: "user",
        message: { content: "<command-name>/clear</command-name>" },
      },
      {
        ...base,
        type: "assistant",
        timestamp: "2026-10-01T10:00:05Z",
        message: {
          model: "claude-opus-5-5",
          content: [
            { type: "text", text: "Looking." },
            { type: "tool_use", name: "Read" },
          ],
        },
      },
      {
        ...base,
        type: "assistant",
        timestamp: "2026-10-01T10:00:06Z",
        message: { content: [{ type: "text", text: "Found it." }] },
      },
      {
        ...base,
        type: "user",
        message: { content: [{ type: "tool_result", content: "file text" }] },
      },
      {
        ...base,
        type: "assistant",
        isSidechain: true,
        message: { content: [{ type: "text", text: "subagent" }] },
      },
    ]);
    const s = await readCliSession(file, "fallback");
    expect(s).toMatchObject({
      sessionId: ID,
      cwd: "/repo",
      gitBranch: "main",
      model: "claude-opus-5-5",
      title: "Fix the login bug",
      ranInArgus: false,
      firstAt: Date.parse("2026-10-01T10:00:00Z"),
      lastAt: Date.parse("2026-10-01T10:00:06Z"),
    });
    expect(s.messages.map((m) => [m.role, m.text])).toEqual([
      ["user", "Fix the login bug\nmore detail"],
      ["assistant", "Looking.\n\nFound it."],
    ]);
  });

  it("prefers a custom title and spots Argus's own agents", async () => {
    const file = write([
      { type: "custom-title", customTitle: "Login work", sessionId: ID },
      {
        type: "attachment",
        attachment: { tools: ["mcp__argus__list_sessions"] },
      },
      { ...base, type: "user", message: { content: "hello" } },
    ]);
    const s = await readCliSession(file, "fallback");
    expect(s.title).toBe("Login work");
    expect(s.ranInArgus).toBe(true);
  });
});

describe("oneShotPrint", () => {
  const sdk = { ...base, entrypoint: "sdk-cli", promptSource: "sdk" };
  const reply = (content: object[]) => ({
    ...sdk,
    type: "assistant",
    message: { content },
  });

  it("flags a single SDK prompt answered without tools", async () => {
    const file = write([
      { ...sdk, type: "user", message: { content: "Summarise this" } },
      reply([{ type: "text", text: "Done" }]),
    ]);
    expect((await readCliSession(file, "x")).oneShotPrint).toBe(true);
  });

  it("keeps interactive, multi-turn and tool-using chats", async () => {
    const cli = { ...base, entrypoint: "cli" };
    const interactive = write([
      { ...cli, type: "user", message: { content: "Fix it" } },
      { ...cli, type: "assistant", message: { content: "Ok" } },
    ]);
    const multiTurn = write([
      { ...sdk, type: "user", message: { content: "Fix it" } },
      reply([{ type: "text", text: "Ok" }]),
      { ...sdk, type: "user", message: { content: "Now test it" } },
    ]);
    const tools = write([
      { ...sdk, type: "user", message: { content: "Fix it" } },
      reply([
        { type: "text", text: "Looking" },
        { type: "tool_use", name: "Read" },
      ]),
      {
        ...sdk,
        type: "user",
        message: { content: [{ type: "tool_result", content: "x" }] },
      },
    ]);
    for (const file of [interactive, multiTurn, tools]) {
      expect((await readCliSession(file, "x")).oneShotPrint).toBe(false);
    }
  });
});

describe("trimMessages", () => {
  it("keeps the opening user message and the newest tail", () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: `m${i}`,
      at: i,
    }));
    expect(trimMessages(messages, 4).map((m) => m.text)).toEqual([
      "m0",
      "m7",
      "m8",
      "m9",
    ]);
  });
});

describe("isCliSessionId", () => {
  it("recognises CLI session ids", () => {
    expect(isCliSessionId(ID)).toBe(true);
    expect(isCliSessionId("agent-1")).toBe(false);
  });
});
