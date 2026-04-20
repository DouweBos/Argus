import { describe, expect, it } from "vitest";
import { formatToolName } from "./toolLabels";

describe("formatToolName", () => {
  it("returns a friendly label for known built-in tools", () => {
    expect(formatToolName("Bash")).toBe("Run a shell command");
    expect(formatToolName("Read")).toBe("Read a file");
    expect(formatToolName("Edit")).toBe("Edit a file");
    expect(formatToolName("MultiEdit")).toBe("Edit a file");
    expect(formatToolName("TodoWrite")).toBe("Update todo list");
  });

  it("formats MCP tool names with server + action", () => {
    expect(formatToolName("mcp__argus__list_projects")).toBe(
      "MCP: Argus / List projects",
    );
    expect(formatToolName("mcp__team-tools__review-pr")).toBe(
      "MCP: Team tools / Review pr",
    );
  });

  it("formats MCP tool names with only a server segment", () => {
    expect(formatToolName("mcp__argus")).toBe("MCP: Argus");
  });

  it("joins multi-part MCP actions with spaces", () => {
    expect(formatToolName("mcp__argus__create__workspace")).toBe(
      "MCP: Argus / Create workspace",
    );
  });

  it("falls back to the raw tool name for unknowns", () => {
    expect(formatToolName("SomeUnknownTool")).toBe("SomeUnknownTool");
  });
});
