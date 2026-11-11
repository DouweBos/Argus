import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;

vi.mock("../../../lib/argusHome", () => ({
  argusHomeDir: () => tmpDir,
}));

const { deleteCustomRunner, listCustomRunners, saveCustomRunner } =
  await import("./store");

describe("custom runners store", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-runners-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty list when the file is missing", () => {
    expect(listCustomRunners()).toEqual([]);
  });

  it("derives a prefixed id from the display name", () => {
    const saved = saveCustomRunner({
      displayName: "Apex",
      env: { ANTHROPIC_BASE_URL: "https://api.callstack.ai" },
      models: [{ id: "callstack/Apex", displayName: "Apex" }],
      defaultModel: "callstack/Apex",
    });

    expect(saved.id).toBe("custom:apex");
    expect(saved.baseRunnerId).toBe("claude-code");
    expect(listCustomRunners()).toHaveLength(1);
  });

  it("de-duplicates ids derived from the same name", () => {
    saveCustomRunner({ displayName: "Apex" });
    const second = saveCustomRunner({ displayName: "Apex" });

    expect(second.id).toBe("custom:apex-2");
  });

  it("updates in place when the id is supplied", () => {
    const first = saveCustomRunner({ displayName: "Apex" });
    saveCustomRunner({ id: first.id, displayName: "Apex (staging)" });

    const all = listCustomRunners();
    expect(all).toHaveLength(1);
    expect(all[0]?.displayName).toBe("Apex (staging)");
  });

  it("drops models without an id and defaults their label", () => {
    const saved = saveCustomRunner({
      displayName: "Apex",
      models: [
        { id: "", displayName: "junk" },
        { id: "callstack/Apex" },
      ] as never,
    });

    expect(saved.models).toEqual([
      { id: "callstack/Apex", displayName: "callstack/Apex" },
    ]);
  });

  it("keeps an ACP agent's command, args and hints", () => {
    const saved = saveCustomRunner({
      displayName: "Goose",
      baseRunnerId: "acp",
      acp: { command: " goose ", args: ["acp", ""], loginHint: " " },
    });

    expect(saved.acp).toEqual({ command: "goose", args: ["acp"] });
    expect(listCustomRunners()[0]?.acp).toEqual(saved.acp);
  });

  it("rejects an ACP agent without a command", () => {
    expect(() =>
      saveCustomRunner({
        displayName: "Goose",
        baseRunnerId: "acp",
        acp: { command: "", args: [] },
      }),
    ).toThrow("Custom ACP agent needs a command");
  });

  it("rejects a runner without a name", () => {
    expect(() => saveCustomRunner({ displayName: "  " })).toThrow();
  });

  it("deletes by id", () => {
    const saved = saveCustomRunner({ displayName: "Apex" });
    deleteCustomRunner(saved.id);

    expect(listCustomRunners()).toEqual([]);
  });

  it("writes the file 0600 — it holds API tokens", () => {
    saveCustomRunner({ displayName: "Apex" });
    const mode = fs.statSync(path.join(tmpDir, "custom-runners.json")).mode;

    expect(mode & 0o777).toBe(0o600);
  });
});
