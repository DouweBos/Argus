import type { SlackConfig } from "./store";
import type { SlackThread } from "./threads";
import { describe, expect, it } from "vitest";
import { claimAttempt, isAllowed } from "./access";
import { routeMessage, slackTextToPlain, stripBotMention } from "./routing";

const base: SlackConfig = {
  defaultProject: null,
  mappings: [{ channel_id: "CWEB", channel_name: "web", repo_root: "/web" }],
  allowedUsers: [],
  owner: { user_id: "UOWNER", name: null },
  claimCode: null,
};
const projects = ["/web", "/ios"];

function thread(patch: Partial<SlackThread>): SlackThread {
  return {
    channel: "CWEB",
    threadTs: "1.1",
    kind: "channel",
    repoRoot: "/web",
    sessionId: null,
    agentId: null,
    resumeRef: null,
    statusTs: null,
    pending: null,
    updatedAt: 0,
    ...patch,
  };
}

describe("routeMessage", () => {
  it("keeps a thread on its session", () => {
    const t = thread({ sessionId: "s1" });
    expect(
      routeMessage({
        config: base,
        channel: "CWEB",
        isDm: false,
        thread: t,
        projects,
      }),
    ).toEqual({
      kind: "continue",
      thread: t,
    });
  });

  it("waits for a pending pick", () => {
    const t = thread({ pending: { text: "x", files: [], userId: "U" } });
    expect(
      routeMessage({
        config: base,
        channel: "CWEB",
        isDm: false,
        thread: t,
        projects,
      }).kind,
    ).toBe("awaiting_pick");
  });

  it("prefers the channel's project, then the default, then asks", () => {
    expect(
      routeMessage({
        config: base,
        channel: "CWEB",
        isDm: false,
        thread: null,
        projects,
      }),
    ).toEqual({
      kind: "start",
      repoRoot: "/web",
    });
    expect(
      routeMessage({
        config: { ...base, defaultProject: "/ios" },
        channel: "COTHER",
        isDm: false,
        thread: null,
        projects,
      }),
    ).toEqual({ kind: "start", repoRoot: "/ios" });
    expect(
      routeMessage({
        config: base,
        channel: "COTHER",
        isDm: false,
        thread: null,
        projects,
      }),
    ).toEqual({
      kind: "ask",
      projects,
    });
  });

  it("asks in a DM even when the DM's id happens to be mapped", () => {
    const config = {
      ...base,
      mappings: [{ channel_id: "D1", channel_name: "x", repo_root: "/web" }],
    };
    expect(
      routeMessage({
        config,
        channel: "D1",
        isDm: true,
        thread: null,
        projects,
      }).kind,
    ).toBe("ask");
  });

  it("asks instead of using a project that was removed", () => {
    const config = { ...base, defaultProject: "/gone" };
    expect(
      routeMessage({
        config,
        channel: "COTHER",
        isDm: false,
        thread: null,
        projects,
      }).kind,
    ).toBe("ask");
  });

  it("uses the only project without asking", () => {
    expect(
      routeMessage({
        config: base,
        channel: "COTHER",
        isDm: true,
        thread: null,
        projects: ["/ios"],
      }),
    ).toEqual({
      kind: "start",
      repoRoot: "/ios",
    });
  });
});

describe("message text", () => {
  it("drops the bot's mention", () => {
    expect(stripBotMention("<@UBOT> fix  it <@UBOT|argus>", "UBOT")).toBe(
      "fix it",
    );
  });

  it("unescapes Slack's markup", () => {
    expect(
      slackTextToPlain(
        "a &lt;b&gt; &amp; <https://x.dev|site> <#C1|web> <@U2>",
      ),
    ).toBe("a <b> & site (https://x.dev) #web @U2");
  });
});

describe("access", () => {
  it("allows the owner and the allowlist only", () => {
    const config = {
      ...base,
      allowedUsers: [{ user_id: "UFRIEND", name: null }],
    };
    expect(isAllowed(config, "UOWNER")).toBe(true);
    expect(isAllowed(config, "UFRIEND")).toBe(true);
    expect(isAllowed(config, "USTRANGER")).toBe(false);
    expect(isAllowed({ ...base, owner: null }, "UOWNER")).toBe(false);
  });

  it("reads a claim only while unclaimed", () => {
    const unclaimed = { ...base, owner: null, claimCode: "482913" };
    expect(claimAttempt(unclaimed, "claim 482913")).toBe("claimed");
    expect(claimAttempt(unclaimed, "482913")).toBe("claimed");
    expect(claimAttempt(unclaimed, "111111")).toBe("wrong");
    expect(claimAttempt(unclaimed, "fix the bug")).toBe("none");
    expect(claimAttempt(base, "482913")).toBe("none");
  });
});
