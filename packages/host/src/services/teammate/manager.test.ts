import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const {
  createAutomation,
  getAutomation,
  listAutomations,
  resetAutomationCache,
  updateAutomation,
} = await import("../automation/manager");
const { listMemories, saveMemory } = await import("../automation/memory/store");
const { listAutomationMemories } = await import("../automation/memory/service");
const { resolvePolicy } = await import("../automation/autonomy");
const {
  addDuty,
  createTeammate,
  createTeammateFromTemplate,
  deleteTeammate,
  dutiesOf,
  promoteAutomation,
  removeDuty,
  teammateDetail,
  updateTeammate,
} = await import("./manager");
const { resetTeammateCache } = await import("./registry");
const { readSoul } = await import("./soul");
const { TEAMMATE_TEMPLATES } = await import("./templates");

const MEMORY = {
  name: "merge-flow",
  description: "Where merges live",
  type: "project" as const,
  body: "`merge.ts`",
};

let home: string;
let previousHome: string | undefined;
let repoRoot: string;

function automation(overrides: Record<string, unknown> = {}) {
  return createAutomation({
    name: "Fix my red CI",
    playbook: "# Fix it",
    trigger: { kind: "manual" },
    scope: { repo_roots: [repoRoot] },
    autonomy: "pr",
    ...overrides,
  });
}

describe("teammates", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-teammates-"));
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argus-teammates-repo-"));
    process.env.ARGUS_HOME = home;
    resetAutomationCache();
    resetTeammateCache();
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

  it("loads automations written before teammates as standalone", () => {
    const id = automation().id;
    const file = path.join(home, "automations.json");
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      automations: Record<string, unknown>[];
    };
    for (const a of raw.automations) {
      delete a.teammate_id;
    }
    fs.writeFileSync(file, JSON.stringify(raw));
    resetAutomationCache();

    expect(getAutomation(id)?.teammate_id).toBeNull();
    expect(fs.existsSync(`${file}.bak`)).toBe(false);
  });

  it("gives every teammate a unique handle", () => {
    const first = createTeammate({ name: "CI Fixer" });
    const second = createTeammate({ name: "CI Fixer" });

    expect(first.handle).toBe("ci-fixer");
    expect(second.handle).toBe("ci-fixer-2");
    expect(() => updateTeammate(second.id, { handle: "ci-fixer" })).toThrow();
  });

  it("shares one memory between a duty and its teammate", () => {
    const teammate = createTeammate({ name: "CI Fixer" });
    const duty = addDuty(teammate.id, {
      name: "Shepherd",
      playbook: "# Watch",
      trigger: { kind: "manual" },
    });
    saveMemory({ kind: "teammate", id: teammate.id }, MEMORY);

    expect(listAutomationMemories(duty.id).memories).toMatchObject([MEMORY]);
    expect(teammateDetail(teammate.id).memory_count).toBe(1);
  });

  it("caps a duty at its teammate's autonomy", () => {
    const teammate = createTeammate({ name: "Careful", autonomy: "propose" });
    const duty = addDuty(teammate.id, {
      name: "Eager",
      playbook: "# Ship it",
      trigger: { kind: "manual" },
      autonomy: "auto_merge",
    });

    expect(resolvePolicy(duty, repoRoot).autonomy).toBe("propose");
  });

  it("drops a duty to propose when a repo disables its teammate's handle", () => {
    const teammate = createTeammate({ name: "Janitor" });
    const duty = addDuty(teammate.id, {
      name: "Sweep",
      playbook: "# Sweep",
      trigger: { kind: "manual" },
      autonomy: "draft",
    });
    fs.writeFileSync(
      path.join(repoRoot, ".argus.json"),
      JSON.stringify({ automations: { disabled: ["janitor"] } }),
    );

    expect(resolvePolicy(duty, repoRoot).disabledByProject).toBe(true);
  });

  it("refuses to change ownership through a plain update", () => {
    const id = automation().id;
    updateAutomation(id, { teammate_id: "nope" } as never);

    expect(getAutomation(id)?.teammate_id).toBeNull();
  });

  it("promotes an automation and moves its memories", () => {
    const standalone = automation();
    saveMemory({ kind: "automation", id: standalone.id }, MEMORY);

    const teammate = promoteAutomation(standalone.id, null);

    expect(teammate.name).toBe("Fix my red CI");
    expect(teammate.autonomy).toBe("pr");
    expect(getAutomation(standalone.id)?.teammate_id).toBe(teammate.id);
    expect(listMemories({ kind: "teammate", id: teammate.id })).toMatchObject([
      MEMORY,
    ]);
    expect(listMemories({ kind: "automation", id: standalone.id })).toEqual([]);
  });

  it("keeps both memories when a promotion clashes", () => {
    const teammate = createTeammate({ name: "Fixer" });
    saveMemory({ kind: "teammate", id: teammate.id }, MEMORY);
    const standalone = automation();
    saveMemory({ kind: "automation", id: standalone.id }, MEMORY);

    promoteAutomation(standalone.id, teammate.id);

    expect(
      listMemories({ kind: "teammate", id: teammate.id }).map((m) => m.name),
    ).toEqual(["merge-flow", `merge-flow-${standalone.id.slice(0, 8)}`]);
  });

  it("removes a duty without deleting it", () => {
    const teammate = createTeammate({ name: "Fixer" });
    const duty = addDuty(teammate.id, {
      name: "Shepherd",
      playbook: "# Watch",
      trigger: { kind: "manual" },
    });

    removeDuty(duty.id);

    expect(getAutomation(duty.id)?.teammate_id).toBeNull();
    expect(dutiesOf(teammate.id)).toEqual([]);
  });

  it("switches its duties with it", () => {
    const teammate = createTeammate({ name: "Fixer" });
    const duty = addDuty(teammate.id, {
      name: "Shepherd",
      playbook: "# Watch",
      trigger: { kind: "manual" },
    });

    updateTeammate(teammate.id, { enabled: true });

    expect(getAutomation(duty.id)?.enabled).toBe(true);
  });

  it("deletes or keeps duties with the teammate", () => {
    const kept = createTeammate({ name: "Kept" });
    const keptDuty = addDuty(kept.id, {
      name: "Stays",
      playbook: "# Stay",
      trigger: { kind: "manual" },
      enabled: true,
    });
    const gone = createTeammate({ name: "Gone" });
    const goneDuty = addDuty(gone.id, {
      name: "Goes",
      playbook: "# Go",
      trigger: { kind: "manual" },
    });

    deleteTeammate(kept.id, true);
    deleteTeammate(gone.id, false);

    expect(getAutomation(keptDuty.id)).toMatchObject({
      enabled: false,
      teammate_id: null,
    });
    expect(getAutomation(goneDuty.id)).toBeNull();
    expect(fs.existsSync(path.join(home, "teammates", gone.id))).toBe(false);
  });

  it("makes every template into a disabled teammate with its soul and duties", () => {
    for (const template of TEAMMATE_TEMPLATES) {
      const teammate = createTeammateFromTemplate(template.id, [repoRoot]);
      const duties = dutiesOf(teammate.id);

      expect(teammate.enabled).toBe(false);
      expect(teammate.template_id).toBe(template.id);
      expect(readSoul(teammate.id)).toBe(template.soul.trim());
      expect(duties).toHaveLength(template.duties.length);
      for (const duty of duties) {
        expect(duty.enabled).toBe(false);
        expect(duty.scope.repo_roots).toEqual([repoRoot]);
      }
    }
    expect(new Set(listAutomations().map((a) => a.id)).size).toBe(
      listAutomations().length,
    );
  });
});
