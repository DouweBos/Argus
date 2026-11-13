import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadOpenCodeUsageRecords,
  openCodeRecord,
  resetOpenCodeUsageCache,
} from "./opencode";

const T = Date.UTC(2026, 10, 1, 10);

const assistant = (id: string, at: number, extra: object = {}) => ({
  id,
  sessionID: "ses-1",
  role: "assistant",
  modelID: "claude-sonnet-4-5",
  providerID: "anthropic",
  time: { created: at, completed: at + 1000 },
  cost: 0.25,
  tokens: {
    input: 100,
    output: 40,
    reasoning: 10,
    cache: { read: 500, write: 20 },
  },
  ...extra,
});

let dir: string;

function writeDb(name: string, rows: [string, number, object][]) {
  const db = new DatabaseSync(path.join(dir, name));
  db.exec(
    "CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)",
  );
  const insert = db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)");
  for (const [id, at, data] of rows) {
    insert.run(id, "ses-1", at, JSON.stringify(data));
  }
  db.close();
}

describe("openCodeRecord", () => {
  it("keeps cache tokens apart, folds reasoning into output and keeps the reported cost", () => {
    expect(openCodeRecord(assistant("msg-1", T))).toEqual({
      at: T,
      runner: "opencode",
      model: "claude-sonnet-4-5",
      sessionId: "ses-1",
      key: "msg-1",
      input: 100,
      cacheRead: 500,
      cacheWrite5m: 20,
      cacheWrite1h: 0,
      output: 50,
      costUsd: 0.25,
    });
  });

  it("prices a zero cost from the list and skips user messages", () => {
    expect(openCodeRecord(assistant("m", T, { cost: 0 }))?.costUsd).toBeNull();
    expect(openCodeRecord(assistant("m", T, { role: "user" }))).toBeNull();
  });

  it("reads the newer model reference", () => {
    const rec = openCodeRecord(
      assistant("m", T, {
        modelID: undefined,
        model: { id: "gpt-5", providerID: "openai" },
      }),
    );
    expect(rec?.model).toBe("gpt-5");
  });
});

describe("loadOpenCodeUsageRecords", () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-opencode-"));
    resetOpenCodeUsageCache();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads the database since the window and legacy JSON it doesn't already hold", async () => {
    writeDb("opencode.db", [
      ["msg-1", T, assistant("msg-1", T)],
      ["msg-old", T - 10_000, assistant("msg-old", T - 10_000)],
      ["msg-user", T, { ...assistant("msg-user", T), role: "user" }],
    ]);
    const legacy = path.join(dir, "storage", "message", "ses-1");
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(
      path.join(legacy, "msg-1.json"),
      JSON.stringify(assistant("msg-1", T)),
    );
    fs.writeFileSync(
      path.join(legacy, "msg-2.json"),
      JSON.stringify(assistant("msg-2", T + 5000)),
    );
    fs.writeFileSync(path.join(legacy, "broken.json"), "{");

    const records = await loadOpenCodeUsageRecords(T - 1000, [dir]);

    expect(records.map((r) => r.key).sort()).toEqual(["msg-1", "msg-2"]);
  });

  it("counts a message once when a channel database repeats it", async () => {
    writeDb("opencode.db", [["msg-1", T, assistant("msg-1", T)]]);
    writeDb("opencode-beta.db", [
      ["msg-1", T, assistant("msg-1", T)],
      ["msg-3", T, assistant("msg-3", T)],
    ]);

    const records = await loadOpenCodeUsageRecords(0, [dir]);

    expect(records.map((r) => r.key).sort()).toEqual(["msg-1", "msg-3"]);
  });

  it("returns nothing for a missing dir", async () => {
    await expect(
      loadOpenCodeUsageRecords(0, [path.join(dir, "missing")]),
    ).resolves.toEqual([]);
  });
});
