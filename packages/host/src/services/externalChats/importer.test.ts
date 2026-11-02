import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cli-import-"));
const home = path.join(tmp, "home");
const repo = path.join(tmp, "repo");
const claudeDir = path.join(
  home,
  ".claude",
  "projects",
  repo.replace(/[^a-zA-Z0-9]/g, "-"),
);

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
  title: "44444444-4444-4444-8444-444444444444",
  helper: "55555555-5555-4555-8555-555555555555",
};
const sdk = { entrypoint: "sdk-cli", promptSource: "sdk" };
const titlePrompt =
  "Generate a concise 3-5 word title for a coding session. Respond with only the title.";

function transcript(
  id: string,
  extra: object[] = [],
  { prompt = "Add dark mode", meta = {} as object } = {},
): string {
  const base = { sessionId: id, cwd: repo, gitBranch: "main", ...meta };

  return [
    ...extra,
    {
      ...base,
      type: "user",
      timestamp: "2026-10-20T10:00:00Z",
      message: { content: prompt },
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
    const dir = claudeDir;
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
    await expect(importCliChats(repo, now)).resolves.toMatchObject({
      imported: 1,
    });
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
    await expect(importCliChats(repo, now)).resolves.toMatchObject({
      imported: 0,
      removed: 0,
    });
  });

  it("skips one-shot print calls and Argus's helper prompts", async () => {
    const { importCliChats } = await import("./importer");
    const { loadHistoryIndex } = await import("../agent/chatHistory");
    fs.writeFileSync(
      path.join(claudeDir, `${ids.title}.jsonl`),
      transcript(ids.title, [], { prompt: titlePrompt, meta: sdk }),
    );
    // Typed interactively, but still one of Argus's own prompts.
    fs.writeFileSync(
      path.join(claudeDir, `${ids.helper}.jsonl`),
      transcript(ids.helper, [], {
        prompt: "Classify each item below.\n\nitem 1",
        meta: { entrypoint: "cli" },
      }),
    );
    const now = Date.parse("2026-10-26T00:00:00Z");
    await expect(importCliChats(repo, now)).resolves.toEqual({
      imported: 0,
      skipped: 2,
      removed: 0,
    });
    expect(loadHistoryIndex(repo).map((e) => e.sessionId)).not.toContain(
      ids.title,
    );
  });

  it("removes one-shot calls an earlier pass imported, and nothing else", async () => {
    const { importCliChats } = await import("./importer");
    const { importConversations, loadConversation, loadHistoryIndex } =
      await import("../agent/chatHistory");
    const imported = (sessionId: string, title: string) => ({
      id: `cli-${sessionId}`,
      sessionId,
      title,
      sessionBranch: "main",
      sessionDescription: "",
      importedFrom: "claude_code" as const,
      messageCount: 2,
      createdAt: 1,
      endedAt: Date.parse("2026-10-27T00:00:00Z"),
      messages: [],
    });
    const oneShot = "66666666-6666-4666-8666-666666666666";
    fs.writeFileSync(
      path.join(claudeDir, `${oneShot}.jsonl`),
      transcript(oneShot, [], { prompt: "Write a haiku", meta: sdk }),
    );
    // Its transcript is gone, but the title still gives it away.
    const orphan = "77777777-7777-4777-8777-777777777777";
    importConversations(repo, [
      imported(oneShot, "Write a haiku"),
      imported(orphan, titlePrompt),
    ]);

    const now = Date.parse("2026-10-26T00:00:00Z");
    await expect(importCliChats(repo, now)).resolves.toMatchObject({
      removed: 2,
    });
    const left = loadHistoryIndex(repo).map((e) => e.sessionId);
    expect(left).not.toContain(oneShot);
    expect(left).not.toContain(orphan);
    expect(left).toEqual(expect.arrayContaining([ids.terminal, ids.native]));
    expect(loadConversation(repo, `cli-${oneShot}`)).toBeNull();
  });

  it("saves and imports nothing while chat history is off", async () => {
    const { importCliChats } = await import("./importer");
    const { loadHistoryIndex, saveConversation } =
      await import("../agent/chatHistory");
    const { saveAppSettings } = await import("../appSettings/store");
    const fresh = "88888888-8888-4888-8888-888888888888";
    fs.writeFileSync(path.join(claudeDir, `${fresh}.jsonl`), transcript(fresh));
    const before = loadHistoryIndex(repo).length;

    saveAppSettings({ save_chat_history: false });
    try {
      saveConversation(repo, {
        id: "off",
        sessionId: "99999999-9999-4999-8999-999999999999",
        title: "Not kept",
        sessionBranch: "main",
        sessionDescription: "",
        messageCount: 0,
        createdAt: 1,
        endedAt: 2,
        messages: [],
      });
      await expect(
        importCliChats(repo, Date.parse("2026-10-26T00:00:00Z")),
      ).resolves.toEqual({ imported: 0, skipped: 0, removed: 0 });
      expect(loadHistoryIndex(repo)).toHaveLength(before);
    } finally {
      saveAppSettings({ save_chat_history: true });
    }
  });
});
