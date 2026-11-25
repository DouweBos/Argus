import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTION_ALLOW,
  ACTION_DENY,
  ACTION_PICK_PROJECT,
  ACTION_RESUME,
  projectToken,
} from "./blocks";
import { SlackBot } from "./bot";
import {
  channelMessage,
  click,
  dm,
  fakeSlack,
  mention,
  OWNER,
  STRANGER,
} from "./slack.testkit";

vi.mock("@argus/host/logger", () => ({ warn: vi.fn(), info: vi.fn() }));

describe("slackBot", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe("routing", () => {
    it("starts a mapped channel's mention in its project", async () => {
      const slack = fakeSlack(vi.fn, {
        mappings: [
          { channel_id: "CWEB", channel_name: "web", repo_root: "/work/web" },
        ],
      });
      const bot = new SlackBot(slack.deps);
      await bot.handleEnvelope(mention("fix the header"));

      expect(slack.started).toEqual([
        { repoRoot: "/work/web", prompt: "fix the header", images: 0 },
      ]);
      const thread = slack.threads.get("CWEB", "1.1");
      expect(thread).toMatchObject({ sessionId: "s1", repoRoot: "/work/web" });
      expect(slack.posts()[0]?.text).toBe("Working on it: starting up");
      expect(slack.deps.telemetry.messageHandled).toHaveBeenCalledWith({
        kind: "mention",
        outcome: "started",
        has_images: false,
      });
    });

    it("hands a message addressed to a teammate to a conversation with it", async () => {
      const slack = fakeSlack(vi.fn, { defaultProject: "/work/ios" });
      slack.deps.teammateByHandle = (handle) =>
        handle === "ci-fixer" ? { id: "t1", name: "CI Fixer" } : null;
      let starts = 0;
      slack.deps.startTeammate = async () => {
        starts++;

        return {
          sessionId: "teammate-thread-th1",
          agentId: "teammate-th1",
          threadId: "th1",
        };
      };
      const bot = new SlackBot(slack.deps);

      await bot.handleEnvelope(mention("@ci-fixer why is main red?"));
      await bot.handleEnvelope(
        mention("and the iOS job?", { thread_ts: "1.1", ts: "1.2" }),
      );

      expect(slack.started).toEqual([]);
      expect(starts).toBe(1);
      expect(slack.continued.map((c) => c.text)).toEqual([
        "why is main red?",
        "and the iOS job?",
      ]);
      expect(slack.threads.get("CWEB", "1.1")?.teammate).toEqual({
        teammateId: "t1",
        threadId: "th1",
        name: "CI Fixer",
      });
    });

    it("treats an unknown handle as an ordinary request", async () => {
      const slack = fakeSlack(vi.fn, { defaultProject: "/work/ios" });
      slack.deps.teammateByHandle = () => null;
      await new SlackBot(slack.deps).handleEnvelope(mention("@nobody fix it"));

      expect(slack.started[0]?.prompt).toBe("@nobody fix it");
    });

    it("uses the default project for an unmapped channel", async () => {
      const slack = fakeSlack(vi.fn, { defaultProject: "/work/ios" });
      await new SlackBot(slack.deps).handleEnvelope(
        mention("hi", { channel: "COTHER" }),
      );

      expect(slack.started[0]?.repoRoot).toBe("/work/ios");
    });

    it("asks which project in a DM, then starts there on a pick", async () => {
      const slack = fakeSlack(vi.fn);
      const bot = new SlackBot(slack.deps);
      await bot.handleEnvelope(dm("add dark mode"));

      expect(slack.started).toEqual([]);
      const picker = slack.posts()[0]!;
      expect(picker.text).toBe("Which project should I work in?");
      expect(JSON.stringify(picker.blocks)).not.toContain("/work/");

      await bot.handleEnvelope(
        click({
          actionId: `${ACTION_PICK_PROJECT}:${projectToken("/work/ios")}`,
          value: projectToken("/work/ios"),
          channel: "DOWNER",
          messageTs: picker.ts,
          threadTs: "2.1",
        }),
      );
      expect(slack.started).toEqual([
        { repoRoot: "/work/ios", prompt: "add dark mode", images: 0 },
      ]);
      expect(slack.updates()[0]?.text).toBe("Working in *ios*.");
      expect(slack.threads.get("DOWNER", "2.1")?.pending).toBeNull();
    });

    it("sends thread replies to the thread's agent", async () => {
      const slack = fakeSlack(vi.fn, { defaultProject: "/work/web" });
      const bot = new SlackBot(slack.deps);
      await bot.handleEnvelope(mention("start"));
      slack.threads.put("CWEB", "1.1", { agentId: "a1" });

      await bot.handleEnvelope(
        channelMessage("also the footer", { ts: "1.5", thread_ts: "1.1" }),
      );
      expect(slack.continued).toEqual([
        { text: "also the footer", author: "Owner (Slack)", images: 0 },
      ]);
      expect(slack.deps.telemetry.messageHandled).toHaveBeenLastCalledWith({
        kind: "thread_reply",
        outcome: "continued",
        has_images: false,
      });
    });

    it("ignores channel chatter outside its threads but hands it to automations", async () => {
      const slack = fakeSlack(vi.fn, { defaultProject: "/work/web" });
      await new SlackBot(slack.deps).handleEnvelope(channelMessage("lunch?"));

      expect(slack.calls).toEqual([]);
      expect(slack.deps.onChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({ channel: "CWEB", text: "lunch?" }),
      );
    });

    it("handles a mention once though Slack sends it twice", async () => {
      const slack = fakeSlack(vi.fn, { defaultProject: "/work/web" });
      const bot = new SlackBot(slack.deps);
      await bot.handleEnvelope(mention("go"));
      await bot.handleEnvelope(mention("go"));

      expect(slack.started).toHaveLength(1);
    });

    it("passes image attachments to the agent and names the rest", async () => {
      const slack = fakeSlack(vi.fn, { defaultProject: "/work/web" });
      await new SlackBot(slack.deps).handleEnvelope(
        mention("match this", {
          files: [
            {
              url_private_download: "https://files.slack.com/a.png",
              mimetype: "image/png",
              name: "a.png",
            },
            {
              url_private_download: "https://files.slack.com/b.pdf",
              mimetype: "application/pdf",
              name: "b.pdf",
            },
          ],
        }),
      );

      expect(slack.started[0]).toEqual({
        repoRoot: "/work/web",
        prompt: "match this\n\n(Also attached in Slack, not passed on: b.pdf)",
        images: 1,
      });
    });
  });

  describe("allowlist", () => {
    it("refuses a stranger once per thread and starts nothing", async () => {
      const slack = fakeSlack(vi.fn, { defaultProject: "/work/web" });
      const bot = new SlackBot(slack.deps);
      await bot.handleEnvelope(mention("rm -rf", { user: STRANGER }));
      await bot.handleEnvelope(
        mention("again", { user: STRANGER, ts: "1.2", thread_ts: "1.1" }),
      );

      expect(slack.started).toEqual([]);
      expect(slack.posts()).toHaveLength(1);
      expect(slack.posts()[0]?.text).toContain("only take requests");
    });

    it("lets allowlisted members in alongside the owner", async () => {
      const slack = fakeSlack(vi.fn, {
        defaultProject: "/work/web",
        allowedUsers: [{ user_id: STRANGER, name: "Friend" }],
      });
      const bot = new SlackBot(slack.deps);
      await bot.handleEnvelope(mention("one", { user: STRANGER }));
      await bot.handleEnvelope(mention("two", { ts: "1.9" }));

      expect(slack.started).toHaveLength(2);
    });

    it("refuses everyone until the bot is claimed, then the claimer drives it", async () => {
      const slack = fakeSlack(vi.fn, {
        owner: null,
        claimCode: "123456",
        defaultProject: "/work/web",
      });
      const bot = new SlackBot(slack.deps);
      await bot.handleEnvelope(mention("hi"));
      expect(slack.posts()[0]?.text).toContain("isn't claimed yet");

      await bot.handleEnvelope(
        dm("claim 123456", { user: STRANGER, ts: "2.2" }),
      );
      expect(slack.config().owner).toEqual({
        user_id: STRANGER,
        name: "Someone",
      });
      expect(slack.config().claimCode).toBeNull();

      await bot.handleEnvelope(mention("go", { user: STRANGER, ts: "1.3" }));
      expect(slack.started).toHaveLength(1);
    });

    it("rotates the claim code after repeated wrong guesses", async () => {
      const slack = fakeSlack(vi.fn, { owner: null, claimCode: "123456" });
      const bot = new SlackBot(slack.deps);
      for (let i = 0; i < 5; i++) {
        await bot.handleEnvelope(dm("000000", { ts: `2.${i + 10}` }));
      }

      expect(slack.config().owner).toBeNull();
      expect(slack.config().claimCode).not.toBe("123456");
    });
  });

  describe("permissions", () => {
    async function withPrompt() {
      const slack = fakeSlack(vi.fn, { defaultProject: "/work/web" });
      const bot = new SlackBot(slack.deps);
      await bot.handleEnvelope(mention("deploy"));
      slack.threads.put("CWEB", "1.1", { agentId: "a1" });
      slack.pending.set("a1:tu1", {
        toolName: "Bash",
        toolInput: { command: "pnpm deploy" },
      });
      bot.bridge.handleHostEvent("agent:permission:a1", {
        tool_use_id: "tu1",
        tool_name: "Bash",
        tool_input: { command: "pnpm deploy" },
      });
      await vi.runAllTimersAsync();
      const prompt = slack
        .posts()
        .find((p) => p.text.includes("wants to use Bash"))!;

      return { slack, bot, prompt };
    }

    it("posts Approve / Deny and answers through the permission flow", async () => {
      const { slack, bot, prompt } = await withPrompt();
      const actions = prompt.blocks?.find(
        (b) => b.type === "actions",
      ) as unknown as {
        elements: { action_id: string; value: string }[];
      };
      expect(actions.elements.map((e) => e.action_id)).toEqual([
        ACTION_ALLOW,
        ACTION_DENY,
      ]);

      await bot.handleEnvelope(
        click({
          actionId: ACTION_ALLOW,
          value: actions.elements[0]!.value,
          messageTs: prompt.ts,
          threadTs: "1.1",
        }),
      );
      expect(slack.deps.respondToPermission).toHaveBeenCalledWith(
        "a1",
        "tu1",
        "allow",
      );
      expect(slack.deps.telemetry.permissionAnswered).toHaveBeenCalledWith(
        "allow",
      );

      bot.bridge.handleHostEvent("agent:permission-resolved:a1", {
        tool_use_id: "tu1",
        decision: "allow",
      });
      await vi.runAllTimersAsync();
      expect(
        slack
          .updates()
          .some(
            (u) =>
              u.ts === prompt.ts &&
              u.text === `Approved by <@${OWNER}>: \`Bash\``,
          ),
      ).toBe(true);
    });

    it("ignores a stranger's click", async () => {
      const { slack, bot, prompt } = await withPrompt();
      const value = JSON.stringify({ a: "a1", t: "tu1" });
      await bot.handleEnvelope(
        click({
          actionId: ACTION_DENY,
          value,
          user: STRANGER,
          messageTs: prompt.ts,
          threadTs: "1.1",
        }),
      );

      expect(slack.deps.respondToPermission).not.toHaveBeenCalled();
    });

    it("won't answer for an agent from another thread", async () => {
      const { slack, bot } = await withPrompt();
      const value = JSON.stringify({ a: "a1", t: "tu1" });
      await bot.handleEnvelope(
        click({
          actionId: ACTION_ALLOW,
          value,
          messageTs: "5.5",
          threadTs: "5.5",
          channel: "COTHER",
        }),
      );

      expect(slack.deps.respondToPermission).not.toHaveBeenCalled();
    });

    it("marks a prompt answered on the Mac or phone as answered in Argus", async () => {
      const { slack, bot, prompt } = await withPrompt();
      bot.bridge.handleHostEvent("agent:permission-resolved:a1", {
        tool_use_id: "tu1",
        decision: "deny",
      });
      await vi.runAllTimersAsync();

      expect(slack.updates().find((u) => u.ts === prompt.ts)?.text).toBe(
        "Denied in Argus: `Bash`",
      );
    });
  });

  describe("thread output", () => {
    it("edits one status message and posts the final reply as mrkdwn", async () => {
      const slack = fakeSlack(vi.fn, { defaultProject: "/work/web" });
      const bot = new SlackBot(slack.deps);
      await bot.handleEnvelope(mention("fix it"));
      bot.bridge.handleHostEvent("agent:started", {
        agent_id: "a1",
        session_id: "s1",
        parent_agent_id: null,
      });
      const tool = (name: string, input: object) =>
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "tool_use", name, input }] },
        });
      bot.bridge.handleHostEvent(
        "agent:event:a1",
        tool("Edit", { file_path: "/x/a.ts" }),
      );
      bot.bridge.handleHostEvent(
        "agent:event:a1",
        tool("Bash", { command: "pnpm vitest run" }),
      );
      await vi.runAllTimersAsync();
      bot.bridge.handleHostEvent(
        "agent:event:a1",
        JSON.stringify({
          type: "result",
          subtype: "success",
          result: "**Fixed** the [header](https://x.dev).",
        }),
      );
      bot.bridge.handleHostEvent("agent:status:a1", "idle");
      await vi.runAllTimersAsync();

      const status = slack.posts()[0]!;
      const edits = slack
        .updates()
        .filter((u) => u.ts === status.ts)
        .map((u) => u.text);
      expect(edits).toContain("Working on it: running tests");
      expect(edits.at(-1)).toBe("Done");
      expect(slack.posts().at(-1)?.text).toBe(
        "*Fixed* the <https://x.dev|header>.",
      );
      expect(slack.threads.get("CWEB", "1.1")?.resumeRef).toBe("conv-1");
    });

    it("says why a teammate's turn stopped and resumes it from the button", async () => {
      const slack = fakeSlack(vi.fn);
      slack.deps.teammateByHandle = () => ({ id: "t1", name: "CI Fixer" });
      slack.deps.startTeammate = async () => ({
        sessionId: "teammate-thread-th1",
        agentId: "teammate-th1",
        threadId: "th1",
      });
      const resumed: (string | null)[] = [];
      slack.deps.resumeTeammate = async (threadId, author) => {
        resumed.push(`${threadId}:${author}`);

        return { agentId: "teammate-th1" };
      };
      slack.deps.limitResetAt = () => 1_700_000_000_000;
      const bot = new SlackBot(slack.deps);
      await bot.handleEnvelope(mention("@ci-fixer why is main red?"));
      bot.bridge.handleHostEvent(
        "agent:event:teammate-th1",
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: true,
          result: "Claude AI usage limit reached",
        }),
      );
      bot.bridge.handleHostEvent("agent:status:teammate-th1", "idle");
      await vi.runAllTimersAsync();

      const failure = slack.posts().at(-1)!;
      expect(failure.text).toContain(
        "*CI Fixer:* Stopped: Hit the usage limit.",
      );
      expect(failure.text).toContain("<!date^1700000000^");
      expect(JSON.stringify(failure.blocks)).toContain(ACTION_RESUME);
      expect(failure.text).not.toContain("Open it in Argus to see why");

      const button = (
        failure.blocks as { elements?: { value?: string }[] }[]
      ).find((b) => b.elements?.[0]?.value)!.elements![0]!.value!;
      await bot.handleEnvelope(
        click({
          actionId: ACTION_RESUME,
          value: button,
          messageTs: failure.ts,
          threadTs: "1.1",
        }),
      );

      expect(resumed).toHaveLength(1);
      expect(resumed[0]).toMatch(/^th1:/);
      const edited = slack.updates().find((u) => u.ts === failure.ts)!;
      expect(JSON.stringify(edited.blocks)).toContain("Resumed by");
      expect(JSON.stringify(edited.blocks)).not.toContain(ACTION_RESUME);
      expect(slack.posts().at(-1)?.text).toBe("Working on it: thinking");
    });

    it("names the reason for a project session's failed turn without a Resume", async () => {
      const slack = fakeSlack(vi.fn, { defaultProject: "/work/web" });
      const bot = new SlackBot(slack.deps);
      await bot.handleEnvelope(mention("fix it"));
      bot.bridge.handleHostEvent("agent:started", {
        agent_id: "a1",
        session_id: "s1",
        parent_agent_id: null,
      });
      bot.bridge.handleHostEvent(
        "agent:event:a1",
        JSON.stringify({
          type: "result",
          subtype: "error_during_execution",
          result: "Tool crashed: ENOSPC\nmore detail",
        }),
      );
      bot.bridge.handleHostEvent("agent:status:a1", "idle");
      await vi.runAllTimersAsync();

      const failure = slack.posts().at(-1)!;
      expect(failure.text).toBe("Stopped: Tool crashed: ENOSPC");
      expect(JSON.stringify(failure.blocks)).not.toContain(ACTION_RESUME);
    });
  });
});
