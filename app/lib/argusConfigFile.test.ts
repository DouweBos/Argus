import { describe, expect, it } from "vitest";
import { applyDialogEdits } from "./argusConfigFile";

describe("applyDialogEdits", () => {
  it("keeps keys the dialog does not edit", () => {
    const raw = {
      auto_fetch_minutes: 15,
      custom_team_key: { a: 1 },
      setup: { copy: [".env"] },
    };

    expect(applyDialogEdits(raw, { setup: { copy: [".env"] } })).toEqual(raw);
  });

  it("replaces owned keys, drops cleared ones and preserves key order", () => {
    const raw = {
      browser_url: "http://old",
      auto_fetch_minutes: 5,
      single_runtime: true,
    };
    const out = applyDialogEdits(raw, {
      setup: {},
      browser_url: "http://new",
    });

    expect(out).toEqual({
      browser_url: "http://new",
      auto_fetch_minutes: 5,
      setup: {},
    });
    expect(Object.keys(out)).toEqual([
      "browser_url",
      "auto_fetch_minutes",
      "setup",
    ]);
  });

  it("keeps unedited keys inside partially edited objects", () => {
    const raw = {
      setup: { copy: ["a"], future: true },
      tools: { disabled: ["x"], other: 1 },
      llm: { runner: "codex" },
    };
    const out = applyDialogEdits(raw, { setup: { commands: ["pnpm i"] } });

    expect(out).toEqual({
      setup: { future: true, commands: ["pnpm i"] },
      tools: { other: 1 },
    });
  });

  it("drops retired keys", () => {
    expect(
      applyDialogEdits({ platforms: ["ios"], x: 1 }, { setup: {} }),
    ).toEqual({ x: 1, setup: {} });
  });

  it("starts from nothing when there is no file", () => {
    expect(applyDialogEdits(null, { setup: {}, run: [] })).toEqual({
      setup: {},
      run: [],
    });
  });
});
