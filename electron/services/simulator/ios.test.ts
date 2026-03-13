import { describe, expect, it } from "vitest";
import { runtimeIdToHuman, fixupRuntimeVersion } from "./ios";

describe("runtimeIdToHuman", () => {
  it("converts iOS runtime ID", () => {
    expect(
      runtimeIdToHuman("com.apple.CoreSimulator.SimRuntime.iOS-18-0"),
    ).toBe("iOS 18.0");
  });

  it("converts iOS with patch version", () => {
    expect(
      runtimeIdToHuman("com.apple.CoreSimulator.SimRuntime.iOS-17-4-1"),
    ).toBe("iOS 17.4.1");
  });

  it("converts watchOS runtime ID", () => {
    expect(
      runtimeIdToHuman("com.apple.CoreSimulator.SimRuntime.watchOS-11-0"),
    ).toBe("watchOS 11.0");
  });

  it("converts tvOS runtime ID", () => {
    expect(
      runtimeIdToHuman("com.apple.CoreSimulator.SimRuntime.tvOS-18-0"),
    ).toBe("tvOS 18.0");
  });

  it("converts visionOS runtime ID", () => {
    expect(
      runtimeIdToHuman("com.apple.CoreSimulator.SimRuntime.xrOS-2-0"),
    ).toBe("xrOS 2.0");
  });

  it("handles unknown format gracefully", () => {
    const result = runtimeIdToHuman("something-weird");
    expect(typeof result).toBe("string");
  });
});

describe("fixupRuntimeVersion", () => {
  it("converts digit-space-digit to dots", () => {
    expect(fixupRuntimeVersion("iOS 18 0")).toBe("iOS 18.0");
  });

  it("preserves word-space-digit", () => {
    expect(fixupRuntimeVersion("iOS 18")).toBe("iOS 18");
  });

  it("handles triple version", () => {
    expect(fixupRuntimeVersion("iOS 17 4 1")).toBe("iOS 17.4.1");
  });

  it("handles simple number", () => {
    expect(fixupRuntimeVersion("18 0")).toBe("18.0");
  });

  it("handles no spaces", () => {
    expect(fixupRuntimeVersion("iOS18")).toBe("iOS18");
  });
});
