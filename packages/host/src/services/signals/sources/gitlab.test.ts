import { describe, expect, it } from "vitest";
import { issueWorkItem, reviewWorkItem } from "./gitlab";

const paths = new Map([["acme/web/app", "/repo"]]);

describe("gitlab signal source", () => {
  it("maps an assigned issue onto its checkout", () => {
    expect(
      issueWorkItem(
        {
          iid: 3,
          title: "Fix login",
          references: { full: "acme/web/app#3" },
          web_url: "https://gitlab.com/acme/web/app/-/issues/3",
          labels: ["bug"],
          assignees: [{ username: "me" }],
          updated_at: "2026-01-01T00:00:00Z",
        },
        paths,
      ),
    ).toMatchObject({
      source_id: "gitlab",
      external_id: "acme/web/app#3",
      kind: "issue",
      assignee: "me",
      labels: ["bug"],
      repo_root: "/repo",
    });
  });

  it("names merge requests with GitLab's bang", () => {
    expect(
      reviewWorkItem(
        {
          iid: "8",
          title: "Add thing",
          webUrl: "https://gitlab.com/acme/web/app/-/merge_requests/8",
          updatedAt: "2026-01-01T00:00:00Z",
          project: { fullPath: "acme/web/app" },
        },
        paths,
      ),
    ).toMatchObject({
      external_id: "acme/web/app!8",
      kind: "pull_request",
      repo_root: "/repo",
    });
  });

  it("skips rows it can't place", () => {
    expect(issueWorkItem({ iid: 1 }, paths)).toBeNull();
  });
});
