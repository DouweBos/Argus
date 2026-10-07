import { afterEach, describe, expect, it } from "vitest";
import { getParsedAgentSnapshot, publishAgentSnapshot } from "./snapshots";

describe("getParsedAgentSnapshot", () => {
  afterEach(() => publishAgentSnapshot("a", null));

  it("parses once per published snapshot", () => {
    publishAgentSnapshot("a", JSON.stringify({ title: "one" }));
    const first = getParsedAgentSnapshot<{ title: string }>("a");

    expect(first?.title).toBe("one");
    expect(getParsedAgentSnapshot("a")).toBe(first);

    publishAgentSnapshot("a", JSON.stringify({ title: "two" }));

    expect(getParsedAgentSnapshot<{ title: string }>("a")?.title).toBe("two");
  });

  it("is null once the snapshot is dropped", () => {
    publishAgentSnapshot("a", JSON.stringify({ title: "one" }));
    getParsedAgentSnapshot("a");
    publishAgentSnapshot("a", null);

    expect(getParsedAgentSnapshot("a")).toBeNull();
  });
});
