import { describe, expect, it } from "vitest";
import { toToolResult } from "./toolResult";

describe("toToolResult", () => {
  it("passes strings through", () => {
    expect(toToolResult("ok")).toBe("ok");
  });

  it("collapses tool_reference blocks into one text block", () => {
    expect(
      toToolResult([
        { type: "tool_reference", tool_name: "mcp__argus__spawn_agent" },
        { type: "tool_reference", tool_name: "mcp__argus__list_agents" },
      ]),
    ).toEqual([
      {
        type: "text",
        text: "mcp__argus__spawn_agent\nmcp__argus__list_agents",
      },
    ]);
  });

  it("keeps text and image blocks", () => {
    const image = {
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "x" },
    };
    expect(toToolResult([{ type: "text", text: "hi" }, image])).toEqual([
      { type: "text", text: "hi" },
      image,
    ]);
  });
});
