import type { LinearComment } from "../../integrations/linear/client";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createTeammate } = await import("../manager");
const { resetTeammateCache } = await import("../registry");
const { pollLinearMentions, REPLY_SIGNATURE } =
  await import("./linearMentions");

let home: string;
let previousHome: string | undefined;

function comment(
  id: string,
  body: string,
  opts: { parentId?: string; at?: number } = {},
): LinearComment {
  return {
    id,
    body,
    createdAt: opts.at ?? Date.now(),
    parentId: opts.parentId ?? null,
    issue: {
      id: "i1",
      identifier: "ENG-1",
      title: "Login broken",
      url: "https://linear.app/x/ENG-1",
    },
  };
}

function deps(comments: LinearComment[]) {
  return {
    comments: vi.fn(async () => comments),
    reply: vi.fn(async () => undefined),
    ask: vi.fn(async (_t: string, threadId: string | null) => ({
      threadId: threadId ?? "th-new",
      answer: "It's the token refresh.",
    })),
    now: () => Date.now(),
  };
}

describe("linear mentions", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-linear-mentions-"));
    process.env.ARGUS_HOME = home;
    resetTeammateCache();
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
  });

  it("asks the mentioned teammate and replies in the comment's thread", async () => {
    const teammate = createTeammate({ name: "CI Fixer" });
    const d = deps([comment("c1", "@ci-fixer why does login fail?")]);

    await pollLinearMentions(d);

    expect(d.ask).toHaveBeenCalledWith(
      teammate.id,
      null,
      expect.stringContaining("ENG-1"),
    );
    expect(d.reply).toHaveBeenCalledWith(
      "i1",
      "c1",
      expect.stringMatching(new RegExp(`${REPLY_SIGNATURE}$`)),
    );
  });

  it("continues the same conversation for a reply in that thread", async () => {
    createTeammate({ name: "CI Fixer" });
    const at = Date.now();
    await pollLinearMentions(deps([comment("c1", "@ci-fixer look", { at })]));
    const second = deps([
      comment("c2", "@ci-fixer and now?", { parentId: "c1", at: at + 1 }),
    ]);

    await pollLinearMentions(second);

    expect(second.ask.mock.calls[0]?.[1]).toBe("th-new");
  });

  it("ignores its own replies and comments that name no teammate", async () => {
    createTeammate({ name: "CI Fixer" });
    const d = deps([
      comment(
        "c1",
        `**CI Fixer:** done @ci-fixer\n\n— CI Fixer, ${REPLY_SIGNATURE}`,
      ),
      comment("c2", "@nobody hello"),
    ]);

    await pollLinearMentions(d);

    expect(d.ask).not.toHaveBeenCalled();
  });

  it("stays quiet when teammates are off", async () => {
    createTeammate({ name: "CI Fixer" });
    fs.writeFileSync(
      path.join(home, "app-settings.json"),
      JSON.stringify({ version: 1, settings: { teammates_enabled: false } }),
    );
    const d = deps([comment("c1", "@ci-fixer hi")]);

    await pollLinearMentions(d);

    expect(d.comments).not.toHaveBeenCalled();
  });
});
