import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appState } from "../../state";
import { deleteSession, renameSession } from "../session/manager";
import {
  createScratchPad,
  listScratchPads,
  restoreScratchPads,
} from "./manager";
import { loadScratchPads } from "./store";

let home: string;
let previousHome: string | undefined;

describe("scratch pads", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-scratch-pad-"));
    process.env.ARGUS_HOME = home;
  });

  afterEach(() => {
    appState.sessions.clear();
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
  });

  it("creates a ready session in its own directory outside any repo", () => {
    const pad = createScratchPad();

    expect(pad.kind).toBe("scratch_pad");
    expect(pad.status).toBe("ready");
    expect(pad.path).toBe(pad.repo_root);
    expect(pad.path.startsWith(path.join(home, "scratch-pads"))).toBe(true);
    expect(fs.existsSync(pad.path)).toBe(true);
  });

  it("numbers default names by the lowest free slot", () => {
    const first = createScratchPad();
    createScratchPad();
    renameSession(first.id, "Research");

    expect(createScratchPad().display_name).toBe("Scratch pad 1");
  });

  it("survives a restart with its name", () => {
    const pad = createScratchPad({ name: "Log digging" });
    appState.sessions.clear();

    restoreScratchPads();

    expect(listScratchPads()).toEqual([
      expect.objectContaining({ id: pad.id, display_name: "Log digging" }),
    ]);
  });

  it("forgets the pad and removes its directory on delete", async () => {
    const pad = createScratchPad();

    await deleteSession(pad.id);

    expect(appState.sessions.has(pad.id)).toBe(false);
    expect(loadScratchPads()).toEqual([]);
    await expect
      .poll(() => fs.existsSync(pad.path), { timeout: 2000 })
      .toBe(false);
  });
});
