/**
 * Extra instructions: the user's additions ride behind the playbook without
 * becoming part of it, so a built-in stays stock.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capture } from "../telemetry/telemetry";
import {
  createAutomation,
  listAutomations,
  resetAutomationCache,
  updateAutomation,
} from "./manager";
import { buildPrompt } from "./runPrompt";
import { playbookHash } from "./templateSync";

vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));

const NO_SIGNALS = {
  items: [],
  instructions: [],
  withheld: [],
  unavailable: [],
};
const NO_SCOPE = { available: [], unavailable: [] };

let home: string;
let previousHome: string | undefined;

function make(extra?: string) {
  return createAutomation({
    name: "Nightly",
    playbook: "# Nightly\n\nDo the thing.",
    trigger: { kind: "manual" },
    extra_instructions: extra,
  });
}

describe("automation extra instructions", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-extra-instructions-"));
    process.env.ARGUS_HOME = home;
    resetAutomationCache();
    vi.mocked(capture).mockClear();
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
    resetAutomationCache();
  });

  it("defaults to none, and the prompt says nothing about them", () => {
    const automation = make();

    expect(automation.extra_instructions).toBe("");
    expect(
      buildPrompt(automation, NO_SIGNALS, "propose", NO_SCOPE),
    ).not.toContain("## Extra instructions");
  });

  it("puts them after the playbook and before the run context", () => {
    const automation = make("Skip anything labelled needs-design.");

    const prompt = buildPrompt(automation, NO_SIGNALS, "propose", NO_SCOPE);

    const playbook = prompt.indexOf("Do the thing.");
    const extra = prompt.indexOf("Skip anything labelled needs-design.");
    const context = prompt.indexOf("## Run context");
    expect(playbook).toBeGreaterThan(-1);
    expect(extra).toBeGreaterThan(playbook);
    expect(context).toBeGreaterThan(extra);
  });

  it("leaves a built-in's playbook stock", () => {
    const builtIn = listAutomations().find(
      (a) => a.template_id === "take-the-easy-ones",
    );
    expect(builtIn).toBeDefined();

    const updated = updateAutomation(builtIn!.id, {
      extra_instructions: "Only the mobile team's issues.",
    });

    expect(updated.seeded_playbook_hash).toBe(playbookHash(updated.playbook));
  });

  it("fills the field in on automations written before it existed", () => {
    const automation = make("Keep me.");
    const file = path.join(home, "automations.json");
    const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
    const list = Array.isArray(onDisk) ? onDisk : onDisk.automations;
    for (const entry of list) {
      delete entry.extra_instructions;
    }
    fs.writeFileSync(file, JSON.stringify(onDisk));
    resetAutomationCache();

    const reloaded = listAutomations().find((a) => a.id === automation.id);

    expect(reloaded?.extra_instructions).toBe("");
  });

  it("counts adding and clearing, not every edit", () => {
    const automation = make();
    expect(capture).not.toHaveBeenCalled();

    updateAutomation(automation.id, { extra_instructions: "One." });
    updateAutomation(automation.id, { extra_instructions: "One, reworded." });
    updateAutomation(automation.id, { extra_instructions: "  " });

    expect(vi.mocked(capture).mock.calls).toEqual([
      ["automation_extra_instructions_changed", { has_instructions: true }],
      ["automation_extra_instructions_changed", { has_instructions: false }],
    ]);
  });
});
