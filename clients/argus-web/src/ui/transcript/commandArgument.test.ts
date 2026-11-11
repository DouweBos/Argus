import { describe, expect, it } from "vitest";
import { commandArgumentTarget } from "./commandArgument";

describe("commandArgumentTarget", () => {
  it("opens a Linear identifier in the app", () => {
    expect(commandArgumentTarget("ENG-273")).toEqual({
      kind: "issue",
      identifier: "ENG-273",
    });
    expect(commandArgumentTarget("A1-2")).toEqual({
      kind: "issue",
      identifier: "A1-2",
    });
  });

  it("opens a Linear issue URL in the app", () => {
    expect(
      commandArgumentTarget("https://linear.app/acme/issue/eng-273/fix-tabs"),
    ).toEqual({ kind: "issue", identifier: "ENG-273" });
    expect(
      commandArgumentTarget("https://linear.app/acme/issue/ENG-273"),
    ).toEqual({ kind: "issue", identifier: "ENG-273" });
  });

  it("links any other http(s) URL", () => {
    expect(commandArgumentTarget("https://github.com/a/b/issues/4")).toEqual({
      kind: "url",
      href: "https://github.com/a/b/issues/4",
    });
    expect(commandArgumentTarget("https://linear.app/acme/project/x")).toEqual({
      kind: "url",
      href: "https://linear.app/acme/project/x",
    });
  });

  it("leaves anything else plain", () => {
    expect(commandArgumentTarget("eng-273")).toBeNull();
    expect(commandArgumentTarget("fix the tabs")).toBeNull();
    expect(commandArgumentTarget("javascript:alert(1)")).toBeNull();
  });
});
