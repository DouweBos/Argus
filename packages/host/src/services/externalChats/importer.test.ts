import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cli-import-"));
const home = path.join(tmp, "home");
const repo = path.join(tmp, "repo");

vi.mock("node:os", async (orig) => {
  const actual: typeof os = await orig();

  return {
    ...actual,
    default: { ...actual, homedir: () => home },
    homedir: () => home,
  };
});

const ids = {
  terminal: "11111111-1111-4111-8111-111111111111",
  argus: "22222222-2222-4222-8222-222222222222",
  native: "33333333-3333-4333-8333-333333333333",
};

function transcript(id: string, extra: object[] = []): string {
  const base = { sessionId: id, cwd: repo, gitBranch: "main" };

  return [
    ...extra,
    {
      ...base,
      type: "user",
      timestamp: "2026-10-20T10:00:00Z",
      message: { content: "Add dark mode" },
    },
    {
      ...base,
      type: "assistant",
      timestamp: "2026-10-20T10:01:00Z",
      message: {
        model: "claude-opus-5-5",
        content: [{ type: "text", text: "Done." }],
      },
    },
  ]
    .map((l) => JSON.stringify(l))
    .join("\n");
}

describe("importCliChats", () => {
  const prevHome = process.env.ARGUS_HOME;

  beforeAll(() => {
    process.env.ARGUS_HOME = path.join(tmp, "argus");
    fs.mkdirSync(repo, { recursive: true });
    const dir = path.join(
      home,
      ".claude",
      "projects",
      repo.replace(/[^a-zA-Z0-9]/g, "-"),
    );
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${ids.terminal}.jsonl`),
      transcript(ids.terminal),
    );
    fs.writeFileSync(
      path.join(dir, `${ids.argus}.jsonl`),
      transcript(ids.argus, [
        { type: "attachment", tools: ["mcp__argus__list_sessions"] },
      ]),
    );
    fs.writeFileSync(
      path.join(dir, `${ids.native}.jsonl`),
      transcript(ids.native),
    );
  });

  afterAll(() => {
    process.env.ARGUS_HOME = prevHome;
  });

  it("imports terminal chats once and leaves Argus's own alone", async () => {
    const { importCliChats } = await import("./importer");
    const { loadConversation, loadHistoryIndex, saveConversation } =
      await import("../agent/chatHistory");
    saveConversation(repo, {
      id: "own",
      sessionId: ids.native,
      title: "Ran in Argus",
      sessionBranch: "main",
      sessionDescription: "",
      messageCount: 0,
      createdAt: 1,
      endedAt: 2,
      messages: [],
    });

    const now = Date.parse("2026-10-26T00:00:00Z");
    await expect(importCliChats(repo, now)).resolves.toBe(1);
    const entries = loadHistoryIndex(repo);
    expect(entries.map((e) => [e.sessionId, e.importedFrom ?? null])).toEqual(
      expect.arrayContaining([
        [ids.terminal, "claude_code"],
        [ids.native, null],
      ]),
    );
    expect(entries).toHaveLength(2);
    const saved = loadConversation(repo, `cli-${ids.terminal}`);
    expect(saved).toMatchObject({
      title: "Add dark mode",
      sessionBranch: "main",
      model: "claude-opus-5-5",
    });
    expect(saved?.messages).toHaveLength(2);

    // Unchanged transcripts are not read again.
    await expect(importCliChats(repo, now)).resolves.toBe(0);
  });
});
