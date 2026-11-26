import { describe, expect, it } from "vitest";
import { normalizeSubpath, parseGistUrl, parseSkillUrl } from "./sourceUrl";

const ID = "aa5a315d61ae9438b18d";

describe("parseGistUrl", () => {
  it.each([
    `https://gist.github.com/octo/${ID}`,
    `https://gist.github.com/${ID}`,
    `https://gist.github.com/${ID}.git`,
    `gist.github.com/octo/${ID}#file-skill-md`,
    `https://gist.githubusercontent.com/octo/${ID}/raw/SKILL.md`,
    `git@gist.github.com:${ID}.git`,
  ])("reads %s", (url) => {
    expect(parseGistUrl(url)).toBe(ID);
  });

  it.each([
    "https://github.com/octo/skills",
    "octo/skills",
    "https://gist.github.com/octo",
    "https://gist.github.com/octo/not-a-gist-id",
  ])("leaves %s alone", (url) => {
    expect(parseGistUrl(url)).toBeNull();
  });
});

describe("parseSkillUrl", () => {
  it("clones a gist over https", () => {
    expect(parseSkillUrl(`https://gist.github.com/octo/${ID}`)).toEqual({
      kind: "gist",
      id: ID,
      cloneUrl: `https://gist.github.com/${ID}.git`,
    });
  });

  it("splits a GitHub folder link into the repository, branch and folder", () => {
    const parsed = parseSkillUrl(
      "https://github.com/octo/skills/tree/main/skills/review",
    );
    expect(parsed).toMatchObject({
      kind: "git",
      ref: "main",
      subpath: "skills/review",
      source: { url: "https://github.com/octo/skills", repoName: "skills" },
    });
  });

  it("takes a SKILL.md link's folder", () => {
    expect(
      parseSkillUrl("https://github.com/octo/skills/blob/v2/review/SKILL.md"),
    ).toMatchObject({ ref: "v2", subpath: "review" });
  });

  it("prefers the path given over the link's", () => {
    expect(
      parseSkillUrl("https://github.com/octo/skills/tree/main/a", "b/c"),
    ).toMatchObject({ subpath: "b/c" });
  });

  it("takes any address Clone Repository takes", () => {
    expect(parseSkillUrl("octo/skills")).toMatchObject({
      kind: "git",
      ref: null,
      subpath: null,
      source: { kind: "shorthand" },
    });
    expect(parseSkillUrl("git@github.com:octo/skills.git")).toMatchObject({
      source: { kind: "ssh" },
    });
  });

  it("refuses a branch that reads as an option", () => {
    expect(() =>
      parseSkillUrl("https://github.com/octo/skills/tree/-x/a"),
    ).toThrow();
  });
});

describe("normalizeSubpath", () => {
  it("tidies a relative folder", () => {
    expect(normalizeSubpath(" ./skills//review/ ")).toBe("skills/review");
    expect(normalizeSubpath("")).toBeNull();
    expect(normalizeSubpath(".")).toBeNull();
  });

  it.each(["../etc", "a/../../b", "/abs", "C:\\x"])("refuses %s", (p) => {
    expect(() => normalizeSubpath(p)).toThrow();
  });
});
