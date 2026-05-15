import { describe, expect, it } from "vitest";
import { truncateClaudeJsonl } from "./truncateClaudeJsonl";

function entry(obj: Record<string, unknown>): string {
  return JSON.stringify(obj);
}

function userEntry(
  text: string,
  opts: {
    sessionId?: string;
    cwd?: string;
    gitBranch?: string;
    timestamp?: string;
  } = {},
): string {
  return entry({
    type: "user",
    sessionId: opts.sessionId ?? "old-session",
    cwd: opts.cwd ?? "/old/cwd",
    gitBranch: opts.gitBranch ?? "old-branch",
    timestamp: opts.timestamp ?? "2026-04-01T00:00:00.000Z",
    message: { content: [{ type: "text", text }] },
  });
}

function assistantEntry(
  text: string,
  opts: { sessionId?: string; timestamp?: string } = {},
): string {
  return entry({
    type: "assistant",
    sessionId: opts.sessionId ?? "old-session",
    cwd: "/old/cwd",
    gitBranch: "old-branch",
    timestamp: opts.timestamp ?? "2026-04-01T00:00:01.000Z",
    message: { content: [{ type: "text", text }] },
  });
}

function toolResultEntry(opts: { timestamp?: string } = {}): string {
  // Claude encodes tool_result turns as role=user, but they are NOT real user
  // turns — the content starts with `type: "tool_result"`, not "text".
  return entry({
    type: "user",
    sessionId: "old-session",
    cwd: "/old/cwd",
    gitBranch: "old-branch",
    timestamp: opts.timestamp ?? "2026-04-01T00:00:02.000Z",
    message: {
      content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
    },
  });
}

function summaryEntry(): string {
  return entry({ type: "summary", summary: "old conversation" });
}

describe("truncateClaudeJsonl", () => {
  const baseArgs = {
    destBranch: "new-branch",
    destCwd: "/new/cwd",
    forkTimestampMs: Date.parse("2026-04-01T00:01:00.000Z"),
    newSessionId: "new-session-id",
  };

  it("returns null for empty input", () => {
    expect(
      truncateClaudeJsonl({ ...baseArgs, forkTurnNumber: 1, raw: "" }),
    ).toBeNull();
  });

  it("keeps entries up to the Nth user turn inclusive", () => {
    const raw = [
      summaryEntry(),
      userEntry("u1"),
      assistantEntry("a1"),
      userEntry("u2"),
      assistantEntry("a2"),
      userEntry("u3"),
      assistantEntry("a3"),
    ].join("\n");

    const result = truncateClaudeJsonl({
      ...baseArgs,
      forkTurnNumber: 2,
      raw,
    });

    expect(result).not.toBeNull();
    expect(result!).toHaveLength(5); // summary + u1 + a1 + u2 + a2
    const parsed = result!.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(parsed[0].type).toBe("summary");
    expect(
      (parsed[1].message as { content: { text: string }[] }).content[0].text,
    ).toBe("u1");
    expect(
      (parsed[4].message as { content: { text: string }[] }).content[0].text,
    ).toBe("a2");
  });

  it("does not count tool_result user entries as real user turns", () => {
    const raw = [
      userEntry("u1"),
      assistantEntry("a1-with-tool-use"),
      toolResultEntry(),
      assistantEntry("a1-continuation"),
      userEntry("u2"),
    ].join("\n");

    const result = truncateClaudeJsonl({
      ...baseArgs,
      forkTurnNumber: 1,
      raw,
    });

    expect(result).not.toBeNull();
    // All 4 entries before u2 should be kept — tool_result is not a real turn.
    expect(result!).toHaveLength(4);
    const parsed = result!.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(parsed[2].type).toBe("user");
    const content = (parsed[2].message as { content: { type: string }[] })
      .content;
    expect(content[0].type).toBe("tool_result");
  });

  it("rewrites sessionId, cwd, and gitBranch on kept entries", () => {
    const raw = [userEntry("u1"), assistantEntry("a1")].join("\n");

    const result = truncateClaudeJsonl({
      ...baseArgs,
      forkTurnNumber: 1,
      raw,
    });

    expect(result).not.toBeNull();
    for (const line of result!) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(parsed.sessionId).toBe("new-session-id");
      expect(parsed.cwd).toBe("/new/cwd");
      expect(parsed.gitBranch).toBe("new-branch");
    }
  });

  it("leaves entries without those fields untouched", () => {
    const raw = summaryEntry(); // no sessionId/cwd/gitBranch

    const result = truncateClaudeJsonl({
      ...baseArgs,
      forkTurnNumber: 1,
      raw,
    });

    expect(result).toEqual([summaryEntry()]);
  });

  it("skips unparseable lines without crashing", () => {
    const raw = ["{not json", userEntry("u1"), "also not json"].join("\n");

    const result = truncateClaudeJsonl({
      ...baseArgs,
      forkTurnNumber: 1,
      raw,
    });

    expect(result).not.toBeNull();
    expect(result!).toHaveLength(1);
    expect((JSON.parse(result![0]) as { type: string }).type).toBe("user");
  });

  it("stops at the timestamp safety-net once the turn quota is met", () => {
    // User turn quota is 1, but a stray entry sneaks in AFTER the cutoff
    // timestamp. The safety-net should prevent it from being kept.
    const cutoffMs = Date.parse("2026-04-01T00:00:10.000Z");
    const raw = [
      userEntry("u1", { timestamp: "2026-04-01T00:00:00.000Z" }),
      assistantEntry("a1", { timestamp: "2026-04-01T00:00:01.000Z" }),
      // Next user turn, well past the cutoff + buffer — should break here.
      userEntry("u2", { timestamp: "2026-04-01T00:01:00.000Z" }),
    ].join("\n");

    const result = truncateClaudeJsonl({
      ...baseArgs,
      forkTimestampMs: cutoffMs,
      forkTurnNumber: 1,
      raw,
    });

    expect(result).not.toBeNull();
    expect(result!).toHaveLength(2);
  });

  it("returns null when forkTurnNumber is 0 and the file has real user turns", () => {
    // With 0 turns kept, we break on the first real user turn — but system
    // entries before it are still kept. If the file starts with a user turn,
    // we get nothing.
    const raw = userEntry("u1");

    const result = truncateClaudeJsonl({
      ...baseArgs,
      forkTurnNumber: 0,
      raw,
    });

    expect(result).toBeNull();
  });

  it("keeps pre-turn summary/meta entries even with forkTurnNumber=0", () => {
    const raw = [summaryEntry(), userEntry("u1")].join("\n");

    const result = truncateClaudeJsonl({
      ...baseArgs,
      forkTurnNumber: 0,
      raw,
    });

    expect(result).not.toBeNull();
    expect(result!).toHaveLength(1);
    expect((JSON.parse(result![0]) as { type: string }).type).toBe("summary");
  });

  it("appends a fresh last-prompt pinned to the actual tip, discarding stale ones", () => {
    // Simulates the bug scenario: Claude wrote a `last-prompt` mid-turn 1
    // pointing at an intermediate node (`a1-mid`), then the turn continued
    // with another assistant entry (`a1-end`). Without the fix, `a1-end`
    // would be invisible to `--resume` because the kept `last-prompt` would
    // still point at `a1-mid`.
    const entries = [
      entry({
        type: "user",
        sessionId: "old",
        cwd: "/old",
        gitBranch: "old-branch",
        uuid: "u1-uuid",
        timestamp: "2026-04-01T00:00:00.000Z",
        message: { content: [{ type: "text", text: "u1" }] },
      }),
      entry({
        type: "assistant",
        sessionId: "old",
        cwd: "/old",
        gitBranch: "old-branch",
        uuid: "a1-mid",
        parentUuid: "u1-uuid",
        timestamp: "2026-04-01T00:00:01.000Z",
        message: { content: [{ type: "tool_use", id: "t1", name: "X" }] },
      }),
      entry({
        type: "last-prompt",
        lastPrompt: "u1",
        leafUuid: "a1-mid",
      }),
      entry({
        type: "user",
        sessionId: "old",
        cwd: "/old",
        gitBranch: "old-branch",
        uuid: "tr1",
        parentUuid: "a1-mid",
        timestamp: "2026-04-01T00:00:02.000Z",
        message: {
          content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
        },
      }),
      entry({
        type: "assistant",
        sessionId: "old",
        cwd: "/old",
        gitBranch: "old-branch",
        uuid: "a1-end",
        parentUuid: "tr1",
        timestamp: "2026-04-01T00:00:03.000Z",
        message: { content: [{ type: "text", text: "done" }] },
      }),
    ];

    const result = truncateClaudeJsonl({
      ...baseArgs,
      forkTurnNumber: 1,
      raw: entries.join("\n"),
    });

    expect(result).not.toBeNull();
    const parsed = result!.map((l) => JSON.parse(l) as Record<string, unknown>);
    const lastPrompts = parsed.filter((p) => p.type === "last-prompt");
    expect(lastPrompts).toHaveLength(1);
    expect(lastPrompts[0].leafUuid).toBe("a1-end");
    expect(lastPrompts[0].lastPrompt).toBe("u1");
    // The fresh last-prompt is the final line.
    expect(parsed[parsed.length - 1].type).toBe("last-prompt");
  });

  it("does not emit a last-prompt when nothing kept has a uuid", () => {
    // Meta-only files (e.g. summary entries) have no uuid-bearing nodes —
    // there is no tip to anchor a last-prompt to.
    const result = truncateClaudeJsonl({
      ...baseArgs,
      forkTurnNumber: 1,
      raw: summaryEntry(),
    });

    expect(result).toEqual([summaryEntry()]);
  });
});
