import { describe, expect, it } from "vitest";
import { reposOnVolumes } from "./volumeWatcher";

describe("reposOnVolumes", () => {
  it("names each repo with a session on an external drive once", () => {
    const repos = reposOnVolumes(
      [
        { path: "/Users/me/app", repo_root: "/Users/me/app" },
        { path: "/Volumes/Ext/wt/a", repo_root: "/Users/me/app" },
        { path: "/Volumes/Ext/wt/b", repo_root: "/Users/me/app" },
        { path: "/Users/me/other", repo_root: "/Users/me/other" },
        { path: "/Volumes/Ext/lib", repo_root: "/Volumes/Ext/lib" },
      ],
      "darwin",
    );

    expect(repos).toEqual(["/Users/me/app", "/Volumes/Ext/lib"]);
  });

  it("includes repos whose drive sessions only the index knows", () => {
    const repos = reposOnVolumes([], "darwin", [
      { repo_root: "/Users/me/app", paths: ["/Volumes/Ext/wt/a"] },
      { repo_root: "/Users/me/other", paths: ["/Users/me/other-wt/b"] },
      { repo_root: "/Volumes/Ext/lib", paths: [] },
    ]);

    expect(repos).toEqual(["/Users/me/app", "/Volumes/Ext/lib"]);
  });
});
