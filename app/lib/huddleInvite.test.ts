/**
 * The invite sentence. Every part of it can be missing, and the one that must
 * survive all of them is the link.
 */

import { describe, expect, it } from "vitest";
import { huddleInviteText } from "./huddleInvite";

const URL = "https://x.trycloudflare.com/#/huddle/tok";

describe("a huddle invite", () => {
  it("names the sender, the agent and the link", () => {
    expect(
      huddleInviteText({
        name: "Ana",
        agentTitle: "Fix the login flow",
        url: URL,
      }),
    ).toBe(`Ana wants you to join “Fix the login flow” in Argus — ${URL}`);
  });

  it("still names the agent when we don't know who is sharing", () => {
    expect(
      huddleInviteText({ name: "", agentTitle: "Fix login", url: URL }),
    ).toBe(`You're invited to join “Fix login” in Argus — ${URL}`);
  });

  it("still names the sender when the agent has no title yet", () => {
    expect(huddleInviteText({ name: "Ana", agentTitle: "", url: URL })).toBe(
      `Ana wants you to join an agent in Argus — ${URL}`,
    );
  });

  it("ignores whitespace passed as a name or a title", () => {
    expect(huddleInviteText({ name: "  ", agentTitle: " ", url: URL })).toBe(
      `You're invited to join an agent in Argus — ${URL}`,
    );
  });

  it("drops the dash rather than trailing one while the link is coming up", () => {
    expect(
      huddleInviteText({ name: "Ana", agentTitle: "Fix login", url: "" }),
    ).toBe("Ana wants you to join “Fix login” in Argus");
  });
});
