import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAvailabilityCache } from "../session/volumeAvailability";
import { scopeAvailability, scopeAvailabilityBlock } from "./scopeAvailability";

/**
 * An automation that reports on a project it could not read is worse than one
 * that does not run: the report is confident and wrong, and "no work found"
 * is indistinguishable from "no evidence available".
 */
describe("scopeAvailability", () => {
  beforeEach(() => {
    resetAvailabilityCache();
    vi.restoreAllMocks();
  });

  /** Nothing under /Volumes exists: every external drive is unplugged. */
  function unplugEverything() {
    vi.spyOn(fs, "existsSync").mockImplementation(
      (p) => !String(p).startsWith("/Volumes/"),
    );
  }

  it("keeps the projects it can read and names the drive for the rest", () => {
    unplugEverything();

    const result = scopeAvailability([
      "/Users/me/Projects/Here",
      "/Volumes/Blackbox/Projects/Away",
    ]);

    expect(result.available).toEqual(["/Users/me/Projects/Here"]);
    expect(result.unavailable).toEqual([
      { repo_root: "/Volumes/Blackbox/Projects/Away", volume: "Blackbox" },
    ]);
  });

  it("does not block a run while any project is still readable", () => {
    unplugEverything();

    expect(
      scopeAvailabilityBlock([
        "/Users/me/Projects/Here",
        "/Volumes/Blackbox/Projects/Away",
      ]),
    ).toBeNull();
  });

  it("blocks a run whose every project is on a disconnected drive", () => {
    unplugEverything();

    const reason = scopeAvailabilityBlock(["/Volumes/Blackbox/Projects/Away"]);

    expect(reason).toContain("Blackbox isn't connected");
  });

  it("leaves an automation with no projects alone", () => {
    // Scope is optional — a GitHub-only automation reads nothing on disk.
    expect(scopeAvailabilityBlock([])).toBeNull();
  });
});
