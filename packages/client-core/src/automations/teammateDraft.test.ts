import type { Teammate } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import {
  teammateCanSave,
  teammateDraft,
  teammateDraftChanged,
  teammateHandleError,
  teammatePatch,
} from "./teammateDraft";

const teammate: Teammate = {
  id: "t1",
  name: "CI Fixer",
  handle: "ci-fixer",
  tagline: "Keeps main green",
  color: "orange",
  avatar: { kind: "symbol", symbol: "wrench" },
  enabled: false,
  scope: { repo_roots: ["/r/a"] },
  source_ids: [],
  autonomy: null,
  guardrails: {} as Teammate["guardrails"],
  runner: null,
  model: null,
  claude_account_id: null,
  template_id: null,
  seeded_soul_hash: null,
  created_at: 0,
  updated_at: 0,
};

describe("teammate drafts", () => {
  const draft = teammateDraft(teammate, "# Soul");

  it("reads the teammate and its soul", () => {
    expect(draft).toMatchObject({
      handle: "ci-fixer",
      soul: "# Soul",
      repoRoots: ["/r/a"],
    });
    expect(teammateDraftChanged(draft, { ...draft })).toBe(false);
    expect(teammateDraftChanged(draft, { ...draft, soul: "x" })).toBe(true);
  });

  it("holds the handle to the computer's rule", () => {
    expect(teammateHandleError("ci-fixer")).toBeNull();
    expect(teammateHandleError("CI Fixer")).not.toBeNull();
    expect(teammateHandleError("-x")).not.toBeNull();
    expect(teammateCanSave({ ...draft, name: " " })).toBe(false);
  });

  it("patches everything but the soul, trimmed", () => {
    const { clear, patch } = teammatePatch({
      ...draft,
      name: " CI Fixer ",
      autonomy: "draft",
    });
    expect(patch).toMatchObject({
      name: "CI Fixer",
      autonomy: "draft",
      scope: { repo_roots: ["/r/a"] },
    });
    expect(patch).not.toHaveProperty("soul");
    expect(clear).toEqual([]);
  });

  it("clears autonomy to inherit", () => {
    const { clear, patch } = teammatePatch(draft);
    expect(patch).not.toHaveProperty("autonomy");
    expect(clear).toEqual(["autonomy"]);
  });
});
