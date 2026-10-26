import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadUsageRecords,
  parseUsageLine,
  resetUsageRecordCache,
} from "./transcriptRecords";

const line = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-10-26T10:00:00.000Z",
    sessionId: "s1",
    requestId: "req_1",
    message: {
      id: "msg_1",
      model: "claude-opus-5-5",
      usage: {
        input_tokens: 2,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 30,
        cache_creation: {
          ephemeral_1h_input_tokens: 20,
          ephemeral_5m_input_tokens: 10,
        },
        output_tokens: 7,
      },
    },
    ...over,
  });

describe("parseUsageLine", () => {
  it("reads tokens, the 1h cache split and the dedupe key", () => {
    expect(parseUsageLine(line())).toEqual({
      at: Date.parse("2026-10-26T10:00:00.000Z"),
      model: "claude-opus-5-5",
      sessionId: "s1",
      key: "msg_1:req_1",
      input: 2,
      cacheRead: 100,
      cacheWrite5m: 10,
      cacheWrite1h: 20,
      output: 7,
    });
  });

  it("skips user lines, placeholders and junk", () => {
    expect(parseUsageLine(line({ type: "user" }))).toBeNull();
    expect(
      parseUsageLine(line({ message: { model: "<synthetic>", usage: {} } })),
    ).toBeNull();
    expect(parseUsageLine("{not json")).toBeNull();
  });
});

describe("loadUsageRecords", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "usage-records-"));
  afterEach(() => resetUsageRecordCache());

  it("reads nested transcripts and picks up appended lines", async () => {
    const dir = path.join(root, "-repo", "session", "subagents");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "agent.jsonl");
    fs.writeFileSync(file, `${line()}\n{"type":"user"}\n`);
    await expect(loadUsageRecords(0, root)).resolves.toHaveLength(1);

    // A partial last line waits until it is complete.
    fs.appendFileSync(file, line({ requestId: "req_2" }).slice(0, 40));
    await expect(loadUsageRecords(0, root)).resolves.toHaveLength(1);
    fs.writeFileSync(
      file,
      `${line()}\n{"type":"user"}\n${line({ requestId: "req_2" })}\n`,
    );
    expect((await loadUsageRecords(0, root)).map((r) => r.key)).toEqual([
      "msg_1:req_1",
      "msg_1:req_2",
    ]);
  });
});
