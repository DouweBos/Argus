import { describe, expect, it } from "vitest";
import {
  automationProjectOptions,
  draftChanged,
  draftScheduleError,
  draftToInput,
  newAutomationDraft,
  runnerTakesAccountPin,
} from "./draft";

describe("automation drafts", () => {
  const draft = newAutomationDraft("UTC");

  it("start paused on a valid schedule", () => {
    expect(draft.enabled).toBe(false);
    expect(draftScheduleError(draft)).toBeNull();
    expect(draftScheduleError({ ...draft, cron: "nope" })).not.toBeNull();
    expect(
      draftScheduleError({ ...draft, trigger_kind: "manual", cron: null }),
    ).toBeNull();
  });

  it("check a run-once time only when it would arm", () => {
    const now = Date.parse("2026-11-10T08:30:00Z");
    const once = {
      ...draft,
      trigger_kind: "once" as const,
      run_at: "2026-11-10T08:00",
    };
    expect(draftScheduleError({ ...once, enabled: true }, now)).toMatch(
      /passed/,
    );
    expect(draftScheduleError(once, now)).toBeNull();
    expect(draftScheduleError({ ...once, run_at: null }, now)).not.toBeNull();
    expect(draftToInput(once).run_at).toBe("2026-11-10T08:00");
    expect(draftToInput(draft)).not.toHaveProperty("run_at");
  });

  it("send trimmed fields and blank model as the default", () => {
    const input = draftToInput({
      ...draft,
      name: "  ",
      model: " ",
      runner: "",
    });
    expect(input.name).toBe("New automation");
    expect(input.model).toBeNull();
    expect(input.runner).toBeNull();
  });

  it("only count real edits as changes", () => {
    expect(draftChanged({ ...draft, name: "New automation " }, draft)).toBe(
      false,
    );
    expect(draftChanged({ ...draft, playbook: "x" }, draft)).toBe(true);
  });

  it("send the account pin, reading a missing one as unpinned", () => {
    expect(draftToInput({ ...draft, claude_account_id: "work" })).toMatchObject(
      { claude_account_id: "work" },
    );
    expect(
      draftToInput({ ...draft, claude_account_id: undefined })
        .claude_account_id,
    ).toBeNull();
  });

  it("only offer the account pin on Claude Code", () => {
    expect(runnerTakesAccountPin(null)).toBe(true);
    expect(runnerTakesAccountPin("claude-code")).toBe(true);
    expect(runnerTakesAccountPin("custom:apex")).toBe(false);
  });

  it("keep a picked project the computer no longer lists", () => {
    expect(
      automationProjectOptions(
        [{ name: "Argus", repo_root: "/a" }],
        ["/a", "/x/old"],
      ),
    ).toEqual([
      { id: "/a", label: "Argus" },
      { id: "/x/old", label: "old", hint: "not open on this computer" },
    ]);
  });
});
