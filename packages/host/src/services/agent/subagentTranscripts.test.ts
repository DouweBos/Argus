import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listSubagents,
  readSubagent,
  subagentsDir,
} from "./subagentTranscripts";

const SESSION = "46a3c777-3f31-4027-bdc6-9a344c212841";
let root: string;

function writeSubagent(
  slug: string,
  id: string,
  meta: object,
  lines: object[],
): void {
  const dir = path.join(root, slug, SESSION, "subagents");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `agent-${id}.jsonl`),
    `${lines.map((l) => JSON.stringify(l)).join("\n")}\nnot json\n`,
  );
  fs.writeFileSync(
    path.join(dir, `agent-${id}.meta.json`),
    JSON.stringify(meta),
  );
}

const user = (at: string, content: unknown) => ({
  type: "user",
  timestamp: at,
  message: { role: "user", content },
});
const assistant = (at: string, id: string, content: unknown[]) => ({
  type: "assistant",
  timestamp: at,
  message: { id, role: "assistant", content },
});
const toolUse = (id: string, name: string) => ({
  type: "tool_use",
  id,
  name,
  input: {},
});

describe("subagentTranscripts", () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "subagents-"));
    writeSubagent(
      "-work-app",
      "a2",
      {
        description: "Extract Figma frames",
        agentType: "general-purpose",
        requestShape: "background",
      },
      [
        user("2026-11-01T10:00:00.000Z", "Export every frame"),
        // The CLI writes one line per content block of the same message.
        assistant("2026-11-01T10:00:01.000Z", "m1", [
          { type: "text", text: "On it" },
        ]),
        assistant("2026-11-01T10:00:01.000Z", "m1", [
          toolUse("t1", "mcp__argus__figma_get_frame"),
        ]),
        user("2026-11-01T10:00:02.000Z", [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: [{ type: "text", text: "x".repeat(5000) }],
          },
        ]),
        assistant("2026-11-01T10:00:03.000Z", "m2", [
          toolUse("t2", "mcp__argus__figma_get_frame"),
          toolUse("t3", "Write"),
        ]),
        { type: "attachment", timestamp: "2026-11-01T10:05:00.000Z" },
      ],
    );
    writeSubagent("-work-app", "a1", { description: "Find tests" }, [
      user("2026-11-01T09:00:00.000Z", "Find tests"),
    ]);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe("subagentsDir", () => {
    it("looks under the cwd's slug, then anywhere the session turns up", () => {
      const expected = path.join(root, "-work-app", SESSION, "subagents");

      expect(subagentsDir("/work/app", SESSION, root)).toBe(expected);
      expect(subagentsDir("/elsewhere", SESSION, root)).toBe(expected);
      expect(subagentsDir("/work/app", "other", root)).toBeNull();
    });
  });

  describe("listSubagents", () => {
    it("summarises each subagent's tool use and time range, oldest first", () => {
      const list = listSubagents(subagentsDir("/work/app", SESSION, root));

      expect(list.map((s) => s.id)).toEqual(["a1", "a2"]);
      expect(list[1]).toEqual({
        id: "a2",
        description: "Extract Figma frames",
        agent_type: "general-purpose",
        background: true,
        started_at: "2026-11-01T10:00:00.000Z",
        ended_at: "2026-11-01T10:05:00.000Z",
        message_count: 4,
        tool_calls: 3,
        tool_counts: { mcp__argus__figma_get_frame: 2, Write: 1 },
      });
    });

    it("is empty without a directory", () => {
      expect(listSubagents(null)).toEqual([]);
    });
  });

  describe("readSubagent", () => {
    it("joins split assistant lines and cuts long tool results", () => {
      const dir = subagentsDir("/work/app", SESSION, root);
      const messages = readSubagent(dir, "agent-a2");

      expect(messages?.[1].content.map((b) => b.type)).toEqual([
        "text",
        "tool_use",
      ]);
      const result = messages?.[2].content[0];
      expect(
        result?.type === "tool_result" && result.content.length,
      ).toBeLessThan(4100);
      expect(readSubagent(dir, "nope")).toBeNull();
    });
  });
});
