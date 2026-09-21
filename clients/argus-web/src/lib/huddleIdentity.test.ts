// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  guestClientId,
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

  it("is per room, and never outlives the tab that earned the grant", () => {
    const mine = guestKeypair("tok");

    expect(guestKeypair("other").pubB64).not.toBe(mine.pubB64);
    // A grant binds to this key, so persisting it would let a closed tab walk
    // back in on the link alone.
    expect(localStorage.getItem("argus.huddle.key.tok")).toBeNull();

    sessionStorage.clear();
    expect(guestKeypair("tok").pubB64).not.toBe(mine.pubB64);
  });
});

describe("the guest's identity hints", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("remembers the name across visits, so coming back doesn't ask again", () => {
    rememberGuestLabel("Ana");
    sessionStorage.clear();

    expect(readGuestLabel()).toBe("Ana");
  });

  it("keeps one stable client id for the browser", () => {
    const id = guestClientId();

    expect(guestClientId()).toBe(id);
    sessionStorage.clear();
    expect(guestClientId()).toBe(id);
  });
});
