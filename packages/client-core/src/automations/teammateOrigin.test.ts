import { describe, expect, it } from "vitest";
import { teammateThreadOrigin } from "./teammateOrigin";

describe("teammateThreadOrigin", () => {
  it("reads a teammate conversation's proposal", () => {
    expect(teammateThreadOrigin("teammate-chat:t1", "thread:th1")).toEqual({
      teammateId: "t1",
      threadId: "th1",
    });
    expect(teammateThreadOrigin("teammate-chat:t1", null)).toEqual({
      teammateId: "t1",
      threadId: null,
    });
  });

  it("leaves automation runs alone", () => {
    expect(teammateThreadOrigin("a1", "r1")).toBeNull();
    expect(teammateThreadOrigin("teammate-chat:", "thread:x")).toBeNull();
  });
});
