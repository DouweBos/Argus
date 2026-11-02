import { describe, expect, it } from "vitest";
import {
  issueResultsBucket,
  issueSessionParams,
  preselectedIssueProject,
} from "./issueStart";
import { isLinearUpload, linearMediaFor } from "./linearMedia";

const ISSUE = { branchName: "douwe/eng-12-fix-login", identifier: "ENG-12" };
const DRAFT = {
  baseBranch: null,
  message: "",
  model: null,
  permissionMode: null,
  runnerId: null,
};

describe("issueSessionParams", () => {
  it("branches on Linear's name and links the issue", () => {
    expect(issueSessionParams(ISSUE, DRAFT, "/r")).toEqual({
      repo_root: "/r",
      branch: "douwe/eng-12-fix-login",
      description: "ENG-12",
      linear_issue: "ENG-12",
    });
  });

  it("carries the base, prompt and agent picks", () => {
    expect(
      issueSessionParams(
        ISSUE,
        {
          baseBranch: "main",
          message: "  keep it small ",
          model: "opus",
          permissionMode: "plan",
          runnerId: "codex",
        },
        "/r",
      ),
    ).toMatchObject({
      base_branch: "main",
      prompt: "keep it small",
      model: "opus",
      permission_mode: "plan",
      runner_id: "codex",
    });
  });
});

describe("preselectedIssueProject", () => {
  it("picks the only project, else the last one used while it's open", () => {
    expect(preselectedIssueProject(["/a"], null)).toBe("/a");
    expect(preselectedIssueProject(["/a", "/b"], "/b")).toBe("/b");
    expect(preselectedIssueProject(["/a", "/b"], "/gone")).toBeNull();
    expect(preselectedIssueProject([], "/a")).toBeNull();
  });
});

describe("issueResultsBucket", () => {
  it("buckets counts", () => {
    expect([0, 1, 5, 6, 20, 21].map(issueResultsBucket)).toEqual([
      "0",
      "1-5",
      "1-5",
      "6-20",
      "6-20",
      "21+",
    ]);
  });
});

// Vectors shared with ArgusKit's LinearMediaLinkTests.
describe("linearMediaFor", () => {
  const upload = "https://uploads.linear.app/a/b/c";
  it("embeds any image upload and only video links", () => {
    expect(linearMediaFor("image", upload, "shot.png")?.kind).toBe("image");
    expect(linearMediaFor("link", upload, "rec.mov")?.kind).toBe("video");
    expect(linearMediaFor("link", `${upload}/clip.mp4`, "clip")?.kind).toBe(
      "video",
    );
    expect(linearMediaFor("link", upload, "notes.pdf")).toBeNull();
  });

  it("leaves other hosts alone", () => {
    expect(isLinearUpload("https://example.com/x.png")).toBe(false);
    expect(isLinearUpload("not a url")).toBe(false);
    expect(
      linearMediaFor("image", "https://example.com/x.png", "x"),
    ).toBeNull();
  });
});
