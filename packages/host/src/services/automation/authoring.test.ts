import { describe, expect, it } from "vitest";
import {
  clampGeneratedAutonomy,
  extractJsonObject,
  repairCron,
  sanitizeDraft,
  type DraftContext,
} from "./authoring";
import { computeNextRun } from "./cron";

const CTX: DraftContext = {
  repoRoots: ["/Users/me/code/argus", "/Users/me/code/peacock"],
  sourceIds: ["github", "linear"],
  timezone: "Europe/Amsterdam",
};

function draft(overrides: Record<string, unknown> = {}) {
  return sanitizeDraft(
    {
      name: "Morning sweep",
      description: "Look at the issues",
      playbook: "# Sweep\n\nDo the thing.",
      trigger: { kind: "schedule", cron: "30 7 * * 1-5" },
      ...overrides,
    },
    CTX,
  );
}

describe("sanitizeDraft", () => {
  it("keeps a well-formed draft", () => {
    const result = draft();
    expect(result?.input.name).toBe("Morning sweep");
    expect(result?.input.trigger).toEqual({
      kind: "schedule",
      cron: "30 7 * * 1-5",
      timezone: "Europe/Amsterdam",
      catch_up: true,
    });
    expect(result?.notes).toEqual([]);
  });

  it("rejects a draft with no playbook", () => {
    expect(draft({ playbook: "   " })).toBeNull();
    expect(sanitizeDraft("not an object", CTX)).toBeNull();
  });

  // A generated automation ships the way every built-in template does: off.
  it("never enables what it generates", () => {
    expect(draft({ enabled: true })?.input.enabled).toBe(false);
  });

  describe("the schedule", () => {
    it("always produces a cron the evaluator parses", () => {
      for (const cron of [
        "30 7 * * 1-5",
        "@daily",
        "0 0 9 * * ?",
        "*/15 * * * *",
      ]) {
        const trigger = draft({ trigger: { kind: "schedule", cron } })?.input
          .trigger;
        if (trigger?.kind !== "schedule") {
          throw new Error(`expected a schedule for "${cron}"`);
        }
        expect(
          computeNextRun(trigger.cron, trigger.timezone, Date.now()),
        ).toBeTypeOf("number");
      }
    });

    it("degrades to manual when the cron cannot be repaired", () => {
      const result = draft({
        trigger: { kind: "schedule", cron: "every monday morning" },
      });
      expect(result?.input.trigger).toEqual({ kind: "manual" });
      expect(result?.notes.join(" ")).toContain("does not parse");
    });

    it("degrades to manual when the cron parses but never fires", () => {
      const result = draft({
        trigger: { kind: "schedule", cron: "0 0 30 2 *" },
      });
      expect(result?.input.trigger).toEqual({ kind: "manual" });
    });

    it("falls back to the context zone for an unknown timezone", () => {
      const result = draft({
        trigger: {
          kind: "schedule",
          cron: "0 9 * * *",
          timezone: "Mars/Olympus",
        },
      });
      expect(
        result?.input.trigger.kind === "schedule" &&
          result.input.trigger.timezone,
      ).toBe("Europe/Amsterdam");
      expect(result?.notes.join(" ")).toContain("not an IANA timezone");
    });

    it("honours an explicit manual trigger", () => {
      expect(draft({ trigger: { kind: "manual" } })?.input.trigger).toEqual({
        kind: "manual",
      });
    });
  });

  describe("autonomy", () => {
    // The description is the one input that must not be able to climb the ladder.
    it("refuses a level the description asked for", () => {
      for (const level of ["auto_merge", "pr", "draft"]) {
        const result = draft({ autonomy: level });
        expect(result?.input.autonomy).toBeNull();
      }
      expect(draft({ autonomy: "auto_merge" })?.notes.join(" ")).toContain(
        "auto_merge",
      );
    });

    it("inherits the app default when nothing is suggested", () => {
      expect(draft()?.input.autonomy).toBeNull();
      expect(clampGeneratedAutonomy(undefined)).toEqual({
        autonomy: null,
        note: null,
      });
    });
  });

  describe("scope", () => {
    it("drops a repo that is not a registered project", () => {
      const result = draft({
        repo_roots: ["/Users/me/code/argus/", "/tmp/not-a-project"],
      });
      expect(result?.input.scope?.repo_roots).toEqual(["/Users/me/code/argus"]);
      expect(result?.notes.join(" ")).toContain("/tmp/not-a-project");
    });

    it("reads a nested scope object too", () => {
      const result = draft({
        scope: { repo_roots: ["/Users/me/code/peacock"] },
      });
      expect(result?.input.scope?.repo_roots).toEqual([
        "/Users/me/code/peacock",
      ]);
    });

    it("drops unknown signal sources", () => {
      expect(
        draft({ source_ids: ["github", "jira"] })?.input.source_ids,
      ).toEqual(["github"]);
    });
  });
});

describe("repairCron", () => {
  it("expands macros and strips foreign fields", () => {
    expect(repairCron("@weekly")).toBe("0 0 * * 0");
    expect(repairCron("0 0 9 * * ?")).toBe("0 9 * * *");
    expect(repairCron("0 0 9 * * ? 2030")).toBe("0 9 * * *");
    expect(repairCron("  30 7 * * 1-5 ")).toBe("30 7 * * 1-5");
  });

  it("returns null for prose and nonsense", () => {
    expect(repairCron("every morning")).toBeNull();
    expect(repairCron("99 99 * * *")).toBeNull();
    expect(repairCron(undefined)).toBeNull();
  });
});

describe("extractJsonObject", () => {
  it("reads a fenced or bare object", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('here you go: {"a":1}')).toEqual({ a: 1 });
    expect(extractJsonObject("no json at all")).toBeNull();
  });
});
