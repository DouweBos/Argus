import { describe, expect, it } from "vitest";
import { mcpProblemCount, mcpServerView, mcpServerViews } from "./mcpServers";

describe("mcp servers", () => {
  it("names a plugin's server by its own name and the plugin as its origin", () => {
    expect(
      mcpServerView({
        name: "plugin:team-tools:linear",
        status: "connected",
        tool_count: 1,
      }),
    ).toEqual({
      name: "plugin:team-tools:linear",
      displayName: "linear",
      state: "connected",
      stateLabel: "Connected",
      detail: "team-tools plugin · 1 tool",
    });
  });

  it("shows a failure's reason over its origin", () => {
    expect(
      mcpServerView({
        name: "figma",
        status: "failed",
        source: "user",
        error: "spawn ENOENT",
      }).detail,
    ).toBe("spawn ENOENT");
  });

  it("keeps a state it doesn't know, capitalised", () => {
    const view = mcpServerView({ name: "x", status: "rebooting" });
    expect(view.state).toBe("other");
    expect(view.stateLabel).toBe("Rebooting");
    expect(view.detail).toBeNull();
  });

  it("sorts what needs you first, then by name", () => {
    const views = mcpServerViews([
      { name: "b", status: "connected" },
      { name: "a", status: "connected" },
      { name: "z", status: "needs-auth", source: "claudeai" },
      { name: "y", status: "failed" },
    ]);
    expect(views.map((v) => v.name)).toEqual(["y", "z", "a", "b"]);
    expect(views[1].detail).toBe("claude.ai connector");
    expect(mcpProblemCount(views)).toBe(2);
  });
});
