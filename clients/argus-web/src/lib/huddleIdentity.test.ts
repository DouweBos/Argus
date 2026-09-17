// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  guestKeypair,
  parseHuddleToken,
  readGuestLabel,
  rememberGuestLabel,
} from "./huddleIdentity";

describe("the huddle link", () => {
  it("reads the room token out of the hash", () => {
    expect(parseHuddleToken("#/huddle/abc-123")).toBe("abc-123");
    expect(parseHuddleToken("#/huddle/abc-123?x=1")).toBe("abc-123");
  });

  it("ignores every other route", () => {
    expect(parseHuddleToken("")).toBeNull();
    expect(parseHuddleToken("#/settings")).toBeNull();
    expect(parseHuddleToken("#/huddle/")).toBeNull();
  });
});

describe("the guest keypair", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("survives a reload of the same tab, so the host re-grants silently", () => {
    const first = guestKeypair("tok");
    const second = guestKeypair("tok");

    expect(second).toEqual(first);
  });

  it("is per room and never persisted beyond the session", () => {
    const mine = guestKeypair("tok");

    expect(guestKeypair("other").pubB64).not.toBe(mine.pubB64);
    expect(localStorage.length).toBe(0);
  });

  it("remembers the name the host sees, for the same session only", () => {
    rememberGuestLabel("Ana");

    expect(readGuestLabel()).toBe("Ana");
    expect(localStorage.length).toBe(0);
  });
});
