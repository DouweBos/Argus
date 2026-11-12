import { describe, expect, it } from "vitest";
import { parseCommitMessage } from "./commitDraft";

describe("parseCommitMessage", () => {
  it("splits the subject from the body", () => {
    expect(
      parseCommitMessage("feat(git): draft messages\n\nReads the diff.\n"),
    ).toEqual({
      subject: "feat(git): draft messages",
      body: "Reads the diff.",
    });
  });

  it("keeps a subject without a body", () => {
    expect(parseCommitMessage("fix: typo")).toEqual({
      subject: "fix: typo",
      body: "",
    });
  });

  it("drops an outer code fence", () => {
    expect(parseCommitMessage("```text\nchore: bump\n\nBody\n```")).toEqual({
      subject: "chore: bump",
      body: "Body",
    });
  });

  it("rejects an empty reply", () => {
    expect(parseCommitMessage("  \n")).toBeNull();
  });
});
