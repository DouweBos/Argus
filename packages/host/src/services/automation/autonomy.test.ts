/**
 * How the three ceilings combine — in particular that an unset one is "no
 * opinion", not a silent cap at `propose`.
 */

import type { Automation } from "./models";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { createAutomation, resetAutomationCache } = await import("./manager");
const { resolveHostAutonomy, resolvePolicy } = await import("./autonomy");

let home: string;
let previousHome: string | undefined;
let repoRoot: string;

function seedAppSettings(settings: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(home, "app-settings.json"),
    JSON.stringify({ version: 1, settings }),
    "utf8",
  );
}

function writeProjectConfig(config: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(repoRoot, ".argus.json"),
    JSON.stringify(config),
    "utf8",
  );
}

function newAutomation(overrides: Record<string, unknown> = {}): Automation {
  return createAutomation({
    name: "Take the easy ones",
    playbook: "# Do the easy ones",
    trigger: { kind: "manual" },
    scope: { repo_roots: [repoRoot] },
    autonomy: "draft",
    ...overrides,
  });
}

describe("effective autonomy", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-autonomy-"));
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argus-autonomy-repo-"));
    process.env.ARGUS_HOME = home;
    resetAutomationCache();
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
    fs.rmSync(repoRoot, { force: true, recursive: true });
  });

  it("uses the automation's own level when no app default is set", () => {
    expect(resolveHostAutonomy(newAutomation())).toBe("draft");
  });

  it("falls back to propose when nothing is set anywhere", () => {
    expect(resolveHostAutonomy(newAutomation({ autonomy: null }))).toBe(
      "propose",
    );
  });

  it("caps at the app default once one is picked", () => {
    seedAppSettings({ default_autonomy: "propose" });

    expect(resolveHostAutonomy(newAutomation({ autonomy: "pr" }))).toBe(
      "propose",
    );
  });

  it("still lets a project cap lower with no app default", () => {
    writeProjectConfig({ automations: { autonomy_ceiling: "propose" } });

    expect(resolvePolicy(newAutomation(), repoRoot).autonomy).toBe("propose");
  });
});
