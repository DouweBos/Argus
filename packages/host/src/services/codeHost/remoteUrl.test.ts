import { describe, expect, it } from "vitest";
import {
  branchCompareUrl,
  newPullRequestUrl,
  pullRequestFromUrl,
  remoteHostAndPath,
  repoRefFromUrl,
} from "./remoteUrl";
import { parseGlabHosts } from "./repos";

const none = new Set<string>();

describe("repoRefFromUrl", () => {
  it("reads GitHub remotes as before", () => {
    expect(repoRefFromUrl("git@github.com:me/app.git", none)).toEqual({
      kind: "github",
      host: "github.com",
      path: "me/app",
    });
  });

  it("reads gitlab.com remotes with nested groups", () => {
    expect(repoRefFromUrl("git@gitlab.com:acme/web/app.git", none)).toEqual({
      kind: "gitlab",
      host: "gitlab.com",
      path: "acme/web/app",
    });
    expect(
      repoRefFromUrl("https://oauth2:x@gitlab.com/acme/app.git/", none),
    ).toEqual({ kind: "gitlab", host: "gitlab.com", path: "acme/app" });
  });

  it("reads self-hosted instances by name or from glab's hosts", () => {
    expect(
      repoRefFromUrl("ssh://git@gitlab.acme.io:2222/team/app.git", none)?.kind,
    ).toBe("gitlab");
    expect(repoRefFromUrl("git@git.acme.io:team/app.git", none)).toBeNull();
    expect(
      repoRefFromUrl("git@git.acme.io:team/app.git", new Set(["git.acme.io"])),
    ).toEqual({ kind: "gitlab", host: "git.acme.io", path: "team/app" });
  });

  it("ignores local paths", () => {
    expect(remoteHostAndPath("/Users/me/repo")).toBeNull();
  });
});

describe("pullRequestFromUrl", () => {
  it("parses both hosts' web URLs", () => {
    expect(pullRequestFromUrl("https://github.com/o/r/pull/7")).toEqual({
      ref: { kind: "github", host: "github.com", path: "o/r" },
      number: 7,
    });
    expect(
      pullRequestFromUrl("https://gitlab.com/g/sub/p/-/merge_requests/12"),
    ).toEqual({
      ref: { kind: "gitlab", host: "gitlab.com", path: "g/sub/p" },
      number: 12,
    });
  });
});

describe("newPullRequestUrl", () => {
  const gitlab = { kind: "gitlab" as const, host: "gitlab.com", path: "g/p" };

  it("opens GitLab's new merge request form", () => {
    expect(newPullRequestUrl(gitlab, "feat/x", "main")).toBe(
      "https://gitlab.com/g/p/-/merge_requests/new?merge_request%5Bsource_branch%5D=feat%2Fx&merge_request%5Btarget_branch%5D=main",
    );
    expect(branchCompareUrl(gitlab, "feat")).toBe(
      "https://gitlab.com/g/p/-/merge_requests/new?merge_request%5Bsource_branch%5D=feat",
    );
  });

  it("keeps GitHub's compare page", () => {
    expect(
      branchCompareUrl(
        { kind: "github", host: "github.com", path: "o/r" },
        "feat/x",
      ),
    ).toBe("https://github.com/o/r/compare/feat/x?expand=1");
  });
});

describe("parseGlabHosts", () => {
  it("lists the hosts and nothing under them", () => {
    const yaml = [
      "git_protocol: ssh",
      "hosts:",
      "    gitlab.com:",
      "        token: secret",
      "        api_host: gitlab.com",
      "    git.acme.io:",
      "        token: other",
      "editor: vim",
    ].join("\n");
    expect(parseGlabHosts(yaml)).toEqual(["gitlab.com", "git.acme.io"]);
  });
});
