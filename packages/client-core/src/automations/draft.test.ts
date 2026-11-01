import { describe, expect, it } from "vitest";
import {
  automationProjectOptions,
  draftChanged,
  draftScheduleError,
  draftToInput,
  newAutomationDraft,
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
