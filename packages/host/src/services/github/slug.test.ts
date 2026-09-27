import { describe, expect, it } from "vitest";
import { githubSlugFromUrl } from "./slug";

describe("githubSlugFromUrl", () => {
  it("reads ssh and https remotes", () => {
    expect(githubSlugFromUrl("git@github.com:DouweBos/Argus.git")).toBe(
      "DouweBos/Argus",
    );
    expect(githubSlugFromUrl("https://github.com/DouweBos/Argus")).toBe(
      "DouweBos/Argus",
    );
    expect(
      githubSlugFromUrl("https://DouweBos@github.com/DouweBos/Argus.git/"),
    ).toBe("DouweBos/Argus");
  });

  it("is null for other hosts", () => {
    expect(githubSlugFromUrl("git@gitlab.com:a/b.git")).toBeNull();
  });
});
