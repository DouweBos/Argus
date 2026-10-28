import { describe, expect, it } from "vitest";
import { reportBody } from "./report";

describe("reportBody", () => {
  it("leads with the pull request, then changes and screenshots", () => {
    const body = reportBody({
      trigger: "pr",
      branch: "douwe/eng-1-login",
      baseBranch: "main",
      prUrl: "https://github.com/acme/app/pull/7",
      commits: ["fix login tap target"],
      screenshotUrls: ["https://uploads.linear.app/x.png"],
    });
    expect(body.split("\n")[0]).toBe(
      "Argus opened a pull request for this issue: https://github.com/acme/app/pull/7",
    );
    expect(body).toContain("- fix login tap target");
    expect(body).toContain("![Simulator 1](https://uploads.linear.app/x.png)");
  });

  it("names the branches on merge and skips empty sections", () => {
    const body = reportBody({
      trigger: "merge",
      branch: "eng-1",
      baseBranch: "main",
      prUrl: null,
      commits: [],
      screenshotUrls: [],
    });
    expect(body).toBe("Argus merged `eng-1` into `main`.");
  });

  it("puts each design next to a screenshot", () => {
    const body = reportBody({
      trigger: "pr",
      branch: "b",
      baseBranch: "main",
      prUrl: "https://github.com/a/b/pull/1",
      commits: [],
      screenshotUrls: ["https://uploads.linear.app/shot.png"],
      designs: [
        {
          name: "Login",
          url: "https://figma.com/design/K",
          imageUrl: "https://uploads.linear.app/design.png",
        },
      ],
    });
    expect(body).toContain("| Design | Implementation |");
    expect(body).toContain(
      "| [Login](https://figma.com/design/K)<br>![Login](https://uploads.linear.app/design.png) | ![Simulator 1](https://uploads.linear.app/shot.png) |",
    );
    expect(body).not.toContain("**Simulator**");
  });
});
