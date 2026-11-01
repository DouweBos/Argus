import type { RemoteMessage } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import { buildLinkedProjectsPreamble } from "../linkedProjects";
import {
  copyText,
  displayBlocks,
  editableText,
  messageMenuOptions,
  resendText,
} from "./messageText";

// Same cases as ArgusCore's MessageDisplayTextTests.
const msg = (
  role: RemoteMessage["role"],
  blocks: string[],
  id = "m",
): RemoteMessage => ({ id, role, text_blocks: blocks, tool_calls: [] });

describe("message text", () => {
  it("drops blank blocks", () => {
    expect(displayBlocks(msg("assistant", ["hi", "  \n", "there"]))).toEqual([
      "hi",
      "there",
    ]);
  });

  it("strips the linked-projects preamble from the user's words", () => {
    const text = buildLinkedProjectsPreamble(["/repo/a"], "look here");
    expect(displayBlocks(msg("user", [text]))).toEqual(["look here"]);
    expect(editableText(msg("user", [text]))).toBe("look here");
  });

  it("has nothing to show for a message that only links projects", () => {
    const text = buildLinkedProjectsPreamble(["/repo/a"], "");
    expect(displayBlocks(msg("user", [text]))).toEqual([]);
    expect(copyText(msg("user", [text]))).toBeNull();
  });

  it("copies the shown blocks a blank line apart", () => {
    expect(copyText(msg("assistant", [" one ", "two"]))).toBe("one\n\ntwo");
  });

  it("puts the preamble back on an edit", () => {
    const text = buildLinkedProjectsPreamble(["/repo/a"], "look here");
    expect(resendText(msg("user", [text]), "look there")).toBe(
      buildLinkedProjectsPreamble(["/repo/a"], "look there"),
    );
    expect(resendText(msg("user", ["plain"]), "edited")).toBe("edited");
  });

  it("offers edit on your messages and fork on both, only while live", () => {
    expect(messageMenuOptions(msg("user", ["hi"]), true)).toEqual({
      copy: true,
      edit: true,
      fork: true,
    });
    expect(messageMenuOptions(msg("assistant", ["hi"]), true).edit).toBe(false);
    expect(messageMenuOptions(msg("user", ["hi"]), false)).toEqual({
      copy: true,
      edit: false,
      fork: false,
    });
    expect(
      messageMenuOptions(msg("user", ["hi"], "optimistic-1"), true).copy,
    ).toBe(false);
  });
});
