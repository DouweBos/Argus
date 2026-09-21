/**
 * The source table has to survive module init.
 *
 * A cycle between a source and the built-in templates once left `SOURCES`
 * holding an `undefined`, and every run that touched it died on
 * `Cannot read properties of undefined (reading 'id')` before it had a
 * session. Importing the registry the way the app does is the whole test.
 */

import { describe, expect, it } from "vitest";
import {
  describeSignalSources,
  getSignalSource,
  listSignalSources,
} from "./registry";
import {
  GITHUB_PRS_SOURCE_ID,
  GITHUB_SOURCE_ID,
  LINEAR_SOURCE_ID,
} from "./sourceIds";

describe("signal source registry", () => {
  it("has no hole in the table", () => {
    const sources = listSignalSources();

    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source).toBeDefined();
      expect(typeof source.id).toBe("string");
    }
  });

  it("resolves every id the built-in templates name", () => {
    for (const id of [
      GITHUB_SOURCE_ID,
      GITHUB_PRS_SOURCE_ID,
      LINEAR_SOURCE_ID,
    ]) {
      expect(getSignalSource(id)?.id).toBe(id);
    }
  });

  it("describes the sources without throwing", async () => {
    await expect(describeSignalSources()).resolves.toBeInstanceOf(Array);
  });
});
