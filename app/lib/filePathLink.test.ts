import { describe, expect, it } from "vitest";
import {
  linkifyFilePaths,
  parseFileRef,
  splitTextForLinks,
  splitTextForMentions,
} from "./filePathLink";

describe("parseFileRef", () => {
  it("returns just the path when no line/col is present", () => {
    expect(parseFileRef("src/foo.ts")).toEqual({ path: "src/foo.ts" });
  });

  it("extracts the line number from a path:line token", () => {
    expect(parseFileRef("src/foo.ts:42")).toEqual({
      path: "src/foo.ts",
      line: 42,
    });
  });

  it("ignores the column from a path:line:col token", () => {
    expect(parseFileRef("src/foo.ts:42:7")).toEqual({
      path: "src/foo.ts",
      line: 42,
    });
  });
});

describe("linkifyFilePaths", () => {
  it("wraps a bare path reference in a file-link anchor", () => {
    const out = linkifyFilePaths("see src/foo.ts for details");
    expect(out).toContain('data-file-path="src/foo.ts"');
    expect(out).toContain('<a class="file-link"');
  });

  it("includes the data-file-line attribute when a line is given", () => {
    const out = linkifyFilePaths("see src/foo.ts:42");
    expect(out).toContain('data-file-line="42"');
  });

  it("does not wrap paths that are already inside an anchor", () => {
    const out = linkifyFilePaths('<a href="x">src/foo.ts</a> and src/bar.ts');
    // Only the second, bare reference should be wrapped.
    const matches = out.match(/class="file-link"/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(out).toContain('data-file-path="src/bar.ts"');
  });

  it("skips tokens without a known extension", () => {
    const out = linkifyFilePaths("foo.xyzzy is not a known type");
    expect(out).not.toContain("file-link");
  });
});

describe("splitTextForLinks", () => {
  it("returns a single text segment for input with no references", () => {
    expect(splitTextForLinks("hello world")).toEqual([
      { type: "text", value: "hello world" },
    ]);
  });

  it("returns no segments for undefined/empty input without throwing", () => {
    expect(splitTextForLinks(undefined as unknown as string)).toEqual([]);
    expect(splitTextForLinks("")).toEqual([]);
    expect(splitTextForMentions(undefined as unknown as string)).toEqual([]);
  });

  it("splits a file path into a link segment with line info", () => {
    const segs = splitTextForLinks("edit src/foo.ts:10 now");
    expect(segs[0]).toEqual({ type: "text", value: "edit " });
    expect(segs[1]).toEqual({
      type: "link",
      label: "src/foo.ts:10",
      path: "src/foo.ts",
      line: 10,
    });
    expect(segs[2]).toEqual({ type: "text", value: " now" });
  });

  it("extracts URLs as url segments without a trailing period", () => {
    const segs = splitTextForLinks("visit https://example.com.");
    const url = segs.find((s) => s.type === "url");
    expect(url).toEqual({
      type: "url",
      url: "https://example.com",
      label: "https://example.com",
    });
  });
});

describe("splitTextForMentions", () => {
  it("extracts @file mentions as link segments", () => {
    const segs = splitTextForMentions("hey @src/foo.ts please");
    const link = segs.find((s) => s.type === "link");
    expect(link).toEqual({
      type: "link",
      label: "@src/foo.ts",
      path: "src/foo.ts",
      line: undefined,
    });
  });

  it("strips trailing sentence punctuation from mentions", () => {
    const segs = splitTextForMentions("check @foo/bar.ts, ok?");
    const link = segs.find((s) => s.type === "link");
    expect(link).toEqual({
      type: "link",
      label: "@foo/bar.ts",
      path: "foo/bar.ts",
      line: undefined,
    });
  });

  it("does not treat mid-word @ as a mention", () => {
    const segs = splitTextForMentions("email foo@bar.ts there");
    expect(segs.every((s) => s.type === "text")).toBe(true);
  });

  it("includes backslash-escaped spaces in the mention", () => {
    const segs = splitTextForMentions(
      "see @/Users/douwe/Downloads/maestro-results-android-phone\\ (3) please",
    );
    const link = segs.find((s) => s.type === "link");
    expect(link).toEqual({
      type: "link",
      label: "@/Users/douwe/Downloads/maestro-results-android-phone\\ (3)",
      path: "/Users/douwe/Downloads/maestro-results-android-phone (3)",
      line: undefined,
    });
  });

  it("keeps balanced parentheses inside a mention token", () => {
    const segs = splitTextForMentions("see @foo/bar(1).ts now");
    const link = segs.find((s) => s.type === "link");
    expect(link).toEqual({
      type: "link",
      label: "@foo/bar(1).ts",
      path: "foo/bar(1).ts",
      line: undefined,
    });
  });
});
