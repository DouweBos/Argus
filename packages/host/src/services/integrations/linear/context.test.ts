import type { LinearIssueDetail } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import { issueContext, issueDesignUrls, issueImageUrls } from "./context";

const issue: LinearIssueDetail = {
  id: "uuid",
  identifier: "ENG-1",
  title: "Login is broken",
  description:
    "Tap login.\n\n![shot](https://uploads.linear.app/a/b.png)\n![ext](https://example.com/x.png)",
  url: "https://linear.app/acme/issue/ENG-1",
  branchName: "douwe/eng-1-login-is-broken",
  state: { id: "s1", name: "Todo", type: "unstarted", position: 1 },
  priority: 2,
  teamKey: "ENG",
  estimate: null,
  teamId: "t1",
  teamName: "Engineering",
  assigneeAvatarUrl: null,
  project: null,
  cycle: null,
  parent: null,
  pullRequestCount: 0,
  createdAt: 0,
  assignee: null,
  labels: ["bug"],
  updatedAt: 0,
  attachments: [],
  children: [],
  comments: [
    {
      author: "Ann",
      body: "Same here ![again](https://uploads.linear.app/a/b.png)",
      createdAt: 1,
    },
    {
      author: null,
      body: "![other](https://uploads.linear.app/c.jpg)",
      createdAt: 2,
    },
  ],
};

describe("issueImageUrls", () => {
  it("collects Linear uploads only, deduped, in reading order", () => {
    expect(issueImageUrls(issue)).toEqual([
      "https://uploads.linear.app/a/b.png",
      "https://uploads.linear.app/c.jpg",
    ]);
  });
});

describe("issueContext", () => {
  it("leads with the identifier, link and state, then comments", () => {
    const text = issueContext(issue);
    expect(text.startsWith("## Linear issue ENG-1: Login is broken")).toBe(
      true,
    );
    expect(text).toContain("https://linear.app/acme/issue/ENG-1 · Todo · bug");
    expect(text).toContain("**Ann:** Same here");
    expect(text).toContain("**Someone:**");
  });

  it("says so when there's no description", () => {
    expect(
      issueContext({ ...issue, description: " ", comments: [] }),
    ).toContain("_No description._");
  });
});

describe("issueDesignUrls", () => {
  it("finds figma links in markdown and plain text", () => {
    expect(
      issueDesignUrls({
        ...issue,
        description:
          "See [design](https://www.figma.com/design/Abc/App?node-id=1-2) and https://figma.com/file/Xyz/Old",
        comments: [],
      }),
    ).toEqual([
      "https://www.figma.com/design/Abc/App?node-id=1-2",
      "https://figma.com/file/Xyz/Old",
    ]);
  });
});
