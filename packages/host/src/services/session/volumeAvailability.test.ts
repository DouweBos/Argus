import { describe, expect, it } from "vitest";
import { classifyPath, mountRootFor, volumeLabel } from "./volumeAvailability";

/**
 * The distinction these tests pin down is the whole point of the module: an
 * unmounted volume must never be reported as a deleted directory, because the
 * caller prunes what it believes is deleted.
 */
describe("mountRootFor", () => {
  it("names the volume a macOS path depends on", () => {
    expect(mountRootFor("/Volumes/Blackbox/work/feat", "darwin")).toBe(
      "/Volumes/Blackbox",
    );
    // The mount point itself depends on itself — that is what makes an
    // ejected drive report as missing rather than as a deleted folder.
    expect(mountRootFor("/Volumes/Blackbox", "darwin")).toBe(
      "/Volumes/Blackbox",
    );
    expect(mountRootFor("/Users/me/.argus/worktrees/x", "darwin")).toBe(null);
  });

  it("handles the conventional linux mount points", () => {
    expect(mountRootFor("/mnt/ssd/work", "linux")).toBe("/mnt/ssd");
    expect(mountRootFor("/media/me/ssd/work", "linux")).toBe("/media/me/ssd");
    expect(mountRootFor("/run/media/me/ssd/work", "linux")).toBe(
      "/run/media/me/ssd",
    );
    expect(mountRootFor("/home/me/work", "linux")).toBe(null);
  });

  it("treats the windows system drive as always present", () => {
    expect(mountRootFor("D:\\work\\feat", "win32")).toBe("D:\\");
    expect(mountRootFor("C:\\Users\\me\\work", "win32")).toBe(null);
  });
});

describe("classifyPath", () => {
  const deps = (present: string[]) => ({
    exists: (p: string) => present.includes(p),
    platform: "darwin" as NodeJS.Platform,
  });

  it("reports a reachable path as present", () => {
    expect(
      classifyPath("/Volumes/Blackbox/feat", deps(["/Volumes/Blackbox/feat"])),
    ).toEqual({ state: "present" });
  });

  it("reports an unplugged drive as volume_missing, not deleted", () => {
    expect(classifyPath("/Volumes/Blackbox/feat", deps([]))).toEqual({
      state: "volume_missing",
      volume: "/Volumes/Blackbox",
    });
  });

  it("reports a deleted folder on a mounted drive as deleted", () => {
    expect(
      classifyPath("/Volumes/Blackbox/feat", deps(["/Volumes/Blackbox"])),
    ).toEqual({ state: "deleted" });
  });

  it("never blames a volume for a path on the boot disk", () => {
    expect(classifyPath("/Users/me/.argus/worktrees/feat", deps([]))).toEqual({
      state: "deleted",
    });
  });
});

describe("volumeLabel", () => {
  it("reads the drive name out of its mount point", () => {
    expect(volumeLabel("/Volumes/Blackbox")).toBe("Blackbox");
  });
});
