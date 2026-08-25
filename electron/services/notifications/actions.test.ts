import { describe, expect, it } from "vitest";
import { permissionActions } from "./actions";

describe("permissionActions", () => {
  it("offers Approve and Deny for an ordinary tool prompt", () => {
    expect(permissionActions("Bash")).toEqual([
      { id: "approve", title: "Approve" },
      { id: "deny", title: "Deny" },
    ]);
  });

  it("still offers them for a plan, which really is a yes/no", () => {
    expect(permissionActions("ExitPlanMode")).toHaveLength(2);
  });

  it("offers none for a question, which needs an option picked in the app", () => {
    expect(permissionActions("AskUserQuestion")).toEqual([]);
  });
});
