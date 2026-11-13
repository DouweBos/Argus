import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadAntigravityUsageRecords,
  resetAntigravityUsageCache,
} from "./antigravity";
import { normalizeModelName, priceableModel } from "./antigravityModels";
import { decodeProto, protoNumber, protoText } from "./protobuf";

// A minimal protobuf writer for fixtures: numbers are varints, the rest length-delimited.
type Field = [number, Uint8Array | number | string];

function varint(n: number): number[] {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);

  return out;
}

function proto(...fields: Field[]): Uint8Array {
  const bytes: number[] = [];
  for (const [num, value] of fields) {
    if (typeof value === "number") {
      bytes.push(...varint(num * 8), ...varint(value));
    } else {
      const payload =
        typeof value === "string" ? new TextEncoder().encode(value) : value;
      bytes.push(...varint(num * 8 + 2), ...varint(payload.length), ...payload);
    }
  }

  return Uint8Array.from(bytes);
}

const T = Date.UTC(2026, 10, 1, 10);
const ts = (ms: number) => proto([1, Math.floor(ms / 1000)], [2, 0]);
const usage = (callId: string | null, modelId: number, input: number) =>
  proto(
    [1, modelId],
    [2, input],
    [3, 40],
    [4, 10],
    [5, 500],
    ...(callId ? ([[11, callId]] as Field[]) : []),
  );

const step = (at: number, modelId: number, name: string, u: Uint8Array) =>
  proto([8, ts(at)], [9, u], [24, proto([1, modelId], [12, name])]);

const generation = (at: number, modelId: number, name: string, u: Uint8Array) =>
  proto([1, proto([3, modelId], [4, u], [9, proto([4, ts(at)])], [19, name])]);

let root: string;

function writeConversation(
  id: string,
  steps: [number, Uint8Array][],
  generations: [number, Uint8Array][],
) {
  const db = new DatabaseSync(path.join(root, "conversations", `${id}.db`));
  db.exec("CREATE TABLE steps (idx INTEGER PRIMARY KEY, metadata BLOB)");
  db.exec("CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB)");
  for (const [idx, blob] of steps) {
    db.prepare("INSERT INTO steps VALUES (?, ?)").run(idx, blob);
  }
  for (const [idx, blob] of generations) {
    db.prepare("INSERT INTO gen_metadata VALUES (?, ?)").run(idx, blob);
  }
  db.close();
}

describe("protobuf", () => {
  it("reads varints, strings and nested messages", () => {
    const f = decodeProto(proto([1, 300], [2, "hi"], [3, proto([1, 5])]));
    expect(protoNumber(f, 1)).toBe(300);
    expect(protoText(f, 2)).toBe("hi");
    expect(() => decodeProto(Uint8Array.from([0x0a, 5, 1]))).toThrow();
  });
});

describe("antigravity model names", () => {
  it("normalizes display names to price-list ids", () => {
    expect(normalizeModelName("Claude 4.5 Sonnet (Thinking)")).toBe(
      "claude-sonnet-4-5-thinking",
    );
    expect(priceableModel(normalizeModelName("Gemini 3.1 Pro (High)"))).toBe(
      "gemini-3.1-pro",
    );
  });
});

describe("loadAntigravityUsageRecords", () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "argus-antigravity-"));
    fs.mkdirSync(path.join(root, "conversations"));
    resetAntigravityUsageCache();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("merges the step and generation copies of one call", async () => {
    const u = usage("call-1", 1036, 100);
    writeConversation(
      "conv-1",
      [[0, step(T, 1036, "Gemini 3.1 Pro (High)", u)]],
      [[0, generation(T + 5000, 1036, "Gemini 3.1 Pro (High)", u)]],
    );

    const records = await loadAntigravityUsageRecords(0, [root]);

    expect(records).toEqual([
      {
        at: T,
        runner: "antigravity",
        model: "gemini-3.1-pro",
        sessionId: "conv-1",
        key: "11:call-1",
        input: 100,
        cacheRead: 500,
        cacheWrite5m: 10,
        cacheWrite1h: 0,
        output: 40,
        costUsd: null,
      },
    ]);
  });

  it("names a bare model id from another conversation and drops calls before the window", async () => {
    writeConversation(
      "conv-1",
      [[0, step(T, 777, "Claude 4.5 Sonnet", usage("a", 777, 1))]],
      [],
    );
    writeConversation(
      "conv-2",
      [
        [0, step(T, 777, "", usage("b", 777, 2))],
        [1, step(T - 60_000, 777, "", usage("c", 777, 3))],
      ],
      [],
    );

    const records = await loadAntigravityUsageRecords(T - 1000, [root]);

    expect(records.map((r) => [r.key, r.model])).toEqual([
      ["11:a", "claude-sonnet-4-5"],
      ["11:b", "claude-sonnet-4-5"],
    ]);
  });

  it("skips a corrupt blob without losing the conversation", async () => {
    writeConversation(
      "conv-1",
      [
        [0, Uint8Array.from([0x0a, 9, 1])],
        [1, step(T, 1036, "Gemini 3.1 Pro", usage(null, 1036, 5))],
      ],
      [],
    );

    const records = await loadAntigravityUsageRecords(0, [root]);

    expect(records.map((r) => r.key)).toEqual(["conv-1:step:1:0"]);
  });

  it("returns nothing for a missing dir", async () => {
    await expect(
      loadAntigravityUsageRecords(0, [path.join(root, "missing")]),
    ).resolves.toEqual([]);
  });
});
