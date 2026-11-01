/**
 * The ladder and the arithmetic behind the gate. Everything here is pure, so
 * these are the cheap assertions; `gate.test.ts` proves the same rules hold
 * when a playbook is actively arguing against them.
 */

import {
  AUTONOMY_LEVELS as CLIENT_AUTONOMY_LEVELS,
  DEFAULT_GUARDRAILS as CLIENT_DEFAULT_GUARDRAILS,
} from "@argus/client-core";
import { describe, expect, it } from "vitest";
import {
  AUTONOMY_LEVELS,
  DEFAULT_GUARDRAILS,
  LEGACY_DEFAULT_MAX_COST_USD,
  atLeastAutonomy,
  deniedPaths,
  evaluateAutoStart,
  evaluateMerge,
  evaluatePush,
  minAutonomy,
  migrateSpendCeiling,
  normalizeGuardrails,
} from "./guardrails";

function autoStartInput(overrides: Record<string, unknown> = {}) {
  return {
    recommendedAction: "start_session",
    confidence: 0.9,
    repoRoot: "/src/app",
    autonomy: "draft" as const,
    guardrails: DEFAULT_GUARDRAILS,
    activeForAutomation: 0,
    activeTotal: 0,
    maxTotalSessions: 3,
    ...overrides,
  };
}

describe("the autonomy ladder", () => {
  it("contains each rung in the one below it", () => {
    expect(atLeastAutonomy("auto_merge", "propose")).toBe(true);
    expect(atLeastAutonomy("pr", "draft")).toBe(true);
    expect(atLeastAutonomy("draft", "pr")).toBe(false);
    expect(atLeastAutonomy("propose", "draft")).toBe(false);
  });

  it("takes the lowest level and ignores absent or invalid ones", () => {
    expect(minAutonomy("pr", "auto_merge")).toBe("pr");
    expect(minAutonomy("pr", null, "propose")).toBe("propose");
    expect(minAutonomy("draft", undefined)).toBe("draft");
    expect(minAutonomy("pr", "sudo" as never)).toBe("pr");
    expect(minAutonomy(null, undefined)).toBe("propose");
  });
});

describe("normalizeGuardrails", () => {
  it("fills every field from defaults", () => {
    expect(normalizeGuardrails(undefined)).toEqual(DEFAULT_GUARDRAILS);
    expect(
      normalizeGuardrails({ max_files_changed: 4 }).max_files_changed,
    ).toBe(4);
  });

  it("clamps confidence and drops junk from the denylist", () => {
    const g = normalizeGuardrails({
      confidence_threshold: 9,
      path_denylist: ["infra/**", "", 3, "  "] as never,
    });
    expect(g.confidence_threshold).toBe(1);
    expect(g.path_denylist).toEqual(["infra/**"]);
  });

  it("keeps a run's time limit above zero", () => {
    expect(normalizeGuardrails({}).max_run_minutes).toBe(20);
    expect(normalizeGuardrails({ max_run_minutes: 45 }).max_run_minutes).toBe(
      45,
    );
    // Off is not on offer: an unlimited run holds its schedule forever.
    expect(normalizeGuardrails({ max_run_minutes: 0 }).max_run_minutes).toBe(1);
  });

  it("retries on other accounts unless opted out", () => {
    expect(normalizeGuardrails({}).retry_other_accounts).toBe(true);
    expect(
      normalizeGuardrails({ retry_other_accounts: false }).retry_other_accounts,
    ).toBe(false);
  });
});

describe("evaluateAutoStart", () => {
  it("allows a confident start_session proposal at draft", () => {
    expect(evaluateAutoStart(autoStartInput()).allowed).toBe(true);
  });

  it("refuses every other recommended action", () => {
    for (const action of ["review", "needs_info", "ignore"]) {
      expect(
        evaluateAutoStart(autoStartInput({ recommendedAction: action }))
          .allowed,
      ).toBe(false);
    }
  });

  it("refuses below draft, below the threshold, and without a project", () => {
    expect(
      evaluateAutoStart(autoStartInput({ autonomy: "propose" })).allowed,
    ).toBe(false);
    expect(
      evaluateAutoStart(
        autoStartInput({
          confidence: 0.9,
          guardrails: { ...DEFAULT_GUARDRAILS, confidence_threshold: 0.95 },
        }),
      ).allowed,
    ).toBe(false);
    expect(evaluateAutoStart(autoStartInput({ repoRoot: null })).allowed).toBe(
      false,
    );
  });

  it("refuses once either concurrency cap is reached", () => {
    expect(
      evaluateAutoStart(
        autoStartInput({
          activeForAutomation: 1,
          guardrails: { ...DEFAULT_GUARDRAILS, max_concurrent_sessions: 1 },
        }),
      ).allowed,
    ).toBe(false);
    expect(
      evaluateAutoStart(autoStartInput({ activeTotal: 3, maxTotalSessions: 3 }))
        .allowed,
    ).toBe(false);
  });
});

describe("post-conditions", () => {
  it("matches denylist globs against repo-relative paths", () => {
    expect(deniedPaths(["src/a.ts", "docs/b.md"], ["src/**"])).toEqual([
      "src/a.ts",
    ]);
    expect(deniedPaths(["./infra/main.tf"], ["infra/**"])).toEqual([
      "./infra/main.tf",
    ]);
    expect(deniedPaths(["pnpm-lock.yaml"], ["**/*.lock"])).toEqual([]);
  });

  it("refuses a push below pr, over the file cap, or into a denied path", () => {
    const guardrails = {
      ...DEFAULT_GUARDRAILS,
      max_files_changed: 2,
      path_denylist: ["src/**"],
    };
    expect(
      evaluatePush({ autonomy: "draft", guardrails, changedPaths: ["a.ts"] })
        .allowed,
    ).toBe(false);
    expect(
      evaluatePush({
        autonomy: "pr",
        guardrails,
        changedPaths: ["a.ts", "b.ts", "c.ts"],
      }).allowed,
    ).toBe(false);
    expect(
      evaluatePush({
        autonomy: "pr",
        guardrails,
        changedPaths: ["src/a.ts"],
      }).allowed,
    ).toBe(false);
    expect(
      evaluatePush({ autonomy: "pr", guardrails, changedPaths: ["docs/a.md"] })
        .allowed,
    ).toBe(true);
  });

  it("fails closed when CI state is unknown", () => {
    const guardrails = DEFAULT_GUARDRAILS;
    expect(
      evaluateMerge({ autonomy: "auto_merge", guardrails, ciClean: null })
        .allowed,
    ).toBe(false);
    expect(
      evaluateMerge({ autonomy: "pr", guardrails, ciClean: true }).allowed,
    ).toBe(false);
    expect(
      evaluateMerge({ autonomy: "auto_merge", guardrails, ciClean: true })
        .allowed,
    ).toBe(true);
    expect(
      evaluateMerge({
        autonomy: "auto_merge",
        guardrails: { ...guardrails, require_clean_ci: false },
        ciClean: null,
      }).allowed,
    ).toBe(true);
  });
});

describe("the spend ceiling", () => {
  it("is off unless the automation asks for one", () => {
    expect(DEFAULT_GUARDRAILS.max_cost_usd_per_run).toBe(0);
    expect(normalizeGuardrails({}).max_cost_usd_per_run).toBe(0);
    expect(
      normalizeGuardrails({ max_cost_usd_per_run: 12 }).max_cost_usd_per_run,
    ).toBe(12);
  });

  it("clears the ceiling nobody chose, and only that one", () => {
    const imposed = normalizeGuardrails({
      max_cost_usd_per_run: LEGACY_DEFAULT_MAX_COST_USD,
    });
    expect(migrateSpendCeiling(imposed)).toBe(true);
    expect(imposed.max_cost_usd_per_run).toBe(0);

    const chosen = normalizeGuardrails({ max_cost_usd_per_run: 12 });
    expect(migrateSpendCeiling(chosen)).toBe(false);
    expect(chosen.max_cost_usd_per_run).toBe(12);
  });
});

describe("client defaults", () => {
  it("match what the host fills in", () => {
    expect(CLIENT_DEFAULT_GUARDRAILS).toEqual(DEFAULT_GUARDRAILS);
    expect(CLIENT_AUTONOMY_LEVELS).toEqual(AUTONOMY_LEVELS);
  });
});
