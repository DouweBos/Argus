import { describe, expect, it } from "vitest";
import { cloneCommand, folderNameProblem, parseCloneSource } from "./url";

describe("parseCloneSource", () => {
  it.each([
    ["https://github.com/octo/tally.git", "https", "tally"],
    ["https://github.com/octo/tally", "https", "tally"],
    ["https://gitlab.com/group/sub/tally/", "https", "tally"],
    ["ssh://git@github.com/octo/tally.git", "ssh", "tally"],
    ["git@github.com:octo/tally.git", "ssh", "tally"],
    ["git@gitlab.example.com:group/tally", "ssh", "tally"],
    ["octo/tally", "shorthand", "tally"],
    ["  octo/tally.git ", "shorthand", "tally"],
  ])("reads %s as %s", (input, kind, name) => {
    const parsed = parseCloneSource(input);
    expect(parsed.kind).toBe(kind);
    expect(parsed.repoName).toBe(name);
  });

  it.each([
    "",
    "--upload-pack=touch /tmp/pwned",
    "-octo/tally",
    "octo/tally --depth 1",
    "file:///etc",
    "/Users/me/repo",
    "https://github.com/",
    "https://github.com/octo",
    "ext::sh -c touch",
    "octo",
  ])("rejects %j", (input) => {
    expect(() => parseCloneSource(input)).toThrow();
  });

  it("keeps the shorthand slug without .git", () => {
    expect(parseCloneSource("octo/tally.git").url).toBe("octo/tally");
  });
});

describe("folderNameProblem", () => {
  it("accepts a plain name and refuses dots, dashes and slashes up front", () => {
    expect(folderNameProblem("tally")).toBeNull();
    expect(folderNameProblem("")).not.toBeNull();
    expect(folderNameProblem("-x")).not.toBeNull();
    expect(folderNameProblem(".hidden")).not.toBeNull();
    expect(folderNameProblem("a/b")).not.toBeNull();
  });
});

describe("cloneCommand", () => {
  it("passes every user value after --", () => {
    const cmd = cloneCommand(
      parseCloneSource("https://github.com/octo/tally.git"),
      "/dev/tally",
      { gh: true, depth: 1 },
    );
    expect(cmd).toEqual({
      program: "git",
      args: [
        "clone",
        "--progress",
        "--depth",
        "1",
        "--",
        "https://github.com/octo/tally.git",
        "/dev/tally",
      ],
    });
  });

  it("clones shorthand through gh when it is there", () => {
    expect(
      cloneCommand(parseCloneSource("octo/tally"), "/dev/tally", { gh: true }),
    ).toEqual({
      program: "gh",
      args: ["repo", "clone", "octo/tally", "/dev/tally", "--", "--progress"],
    });
  });

  it("falls back to the https GitHub URL without gh", () => {
    expect(
      cloneCommand(parseCloneSource("octo/tally"), "/dev/tally", { gh: false })
        .args,
    ).toEqual([
      "clone",
      "--progress",
      "--",
      "https://github.com/octo/tally.git",
      "/dev/tally",
    ]);
  });
});
