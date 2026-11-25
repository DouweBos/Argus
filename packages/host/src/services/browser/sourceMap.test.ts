import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeVlq,
  inlineSourceMap,
  originalPositionFor,
  type RawSourceMap,
  sourceMappingUrl,
} from "./sourceMap";

const fixtures = path.join(import.meta.dirname, "fixtures");
// esbuild's dev JSX build of a SaveButton.tsx whose useState is on line 6 and <button> on line 9.
const map = JSON.parse(
  fs.readFileSync(path.join(fixtures, "SaveButton.js.map"), "utf-8"),
) as RawSourceMap;

describe("decodeVlq", () => {
  it("decodes signed base64 VLQ fields", () => {
    expect(decodeVlq("AAgBC")).toEqual([0, 0, 16, 1]);
    expect(decodeVlq("D")).toEqual([-1]);
    expect(decodeVlq("2H")).toEqual([123]);
  });

  it("gives up on a character outside base64", () => {
    expect(decodeVlq("A!")).toEqual([]);
  });
});

describe("originalPositionFor", () => {
  it("maps the jsxDEV call back to the JSX line", () => {
    expect(originalPositionFor(map, 5, 26)).toEqual({
      source: "../src/SaveButton.tsx",
      line: 9,
      column: 5,
    });
  });

  it("maps the hook call to its own line", () => {
    expect(originalPositionFor(map, 4, 32)?.line).toBe(6);
  });

  it("is null past the end of the mappings", () => {
    expect(originalPositionFor(map, 400, 1)).toBeNull();
  });

  it("applies sourceRoot", () => {
    expect(
      originalPositionFor({ ...map, sourceRoot: "/app" }, 5, 26)?.source,
    ).toBe("/app/../src/SaveButton.tsx");
  });

  it("finds the section of an index map", () => {
    const indexed: RawSourceMap = {
      version: 3,
      sections: [
        { offset: { line: 0, column: 0 }, map: { sources: [], mappings: "" } },
        { offset: { line: 10, column: 0 }, map },
      ],
    };
    expect(originalPositionFor(indexed, 15, 26)?.line).toBe(9);
  });
});

describe("sourceMappingUrl", () => {
  it("takes the last comment", () => {
    const script = fs.readFileSync(
      path.join(fixtures, "SaveButton.js.txt"),
      "utf-8",
    );
    expect(sourceMappingUrl(script)).toBe("SaveButton.js.map");
    expect(
      sourceMappingUrl(
        "//# sourceMappingURL=a.map\n//# sourceMappingURL=b.map",
      ),
    ).toBe("b.map");
    expect(sourceMappingUrl("const a = 1;")).toBeNull();
  });
});

describe("inlineSourceMap", () => {
  it("decodes a base64 data URL", () => {
    const encoded = Buffer.from(JSON.stringify(map)).toString("base64");
    expect(
      inlineSourceMap(`data:application/json;charset=utf-8;base64,${encoded}`),
    ).toEqual(map);
  });

  it("is null for a map that must be fetched", () => {
    expect(inlineSourceMap("SaveButton.js.map")).toBeNull();
  });
});
