import { describe, expect, it } from "vitest";
import { tempFile } from "./slack.testkit";
import { SlackThreadStore } from "./threads";

describe("slackThreadStore", () => {
  it("finds a thread by its Slack address, agent and session", () => {
    const store = new SlackThreadStore(() => file);
    const file = tempFile("threads.json");
    store.put("C1", "1.1", { sessionId: "s1", agentId: "a1", repoRoot: "/r" });

    expect(store.get("C1", "1.1")).toMatchObject({
      sessionId: "s1",
      agentId: "a1",
    });
    expect(store.byAgent("a1")?.threadTs).toBe("1.1");
    expect(store.bySession("s1")?.channel).toBe("C1");
    expect(store.get("C1", "9.9")).toBeNull();
  });

  it("merges updates and survives a restart", () => {
    const file = tempFile("threads.json");
    const first = new SlackThreadStore(() => file);
    first.put("C1", "1.1", { sessionId: "s1", agentId: "a1" });
    first.put("C1", "1.1", { agentId: "a2", resumeRef: "conv" });

    const second = new SlackThreadStore(() => file);
    expect(second.get("C1", "1.1")).toMatchObject({
      sessionId: "s1",
      agentId: "a2",
      resumeRef: "conv",
    });
    expect(second.byAgent("a1")).toBeNull();
  });

  it("forgets a deleted session's threads", () => {
    const file = tempFile("threads.json");
    const store = new SlackThreadStore(() => file);
    store.put("C1", "1.1", { sessionId: "s1" });
    store.put("C1", "2.2", { sessionId: "s2" });
    store.dropSession("s1");

    expect(store.all().map((t) => t.sessionId)).toEqual(["s2"]);
  });

  it("keeps the newest 500 threads", () => {
    const file = tempFile("threads.json");
    const store = new SlackThreadStore(() => file);
    for (let i = 0; i < 505; i++) {
      store.put("C1", `${i}.0`, { sessionId: `s${i}` });
    }

    expect(store.all()).toHaveLength(500);
    expect(store.get("C1", "504.0")).not.toBeNull();
  });
});
