import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeZip } from "../../lib/zip";
import { extractSkillArchive, safeEntryPath } from "./archive";

describe("safeEntryPath", () => {
  it("keeps names inside the archive", () => {
    expect(safeEntryPath("review/SKILL.md")).toBe("review/SKILL.md");
    expect(safeEntryPath("./a//b.txt")).toBe("a/b.txt");
  });

  it("skips folders and Finder's leftovers", () => {
    expect(safeEntryPath("review/")).toBeNull();
    expect(safeEntryPath("__MACOSX/review/._SKILL.md")).toBeNull();
    expect(safeEntryPath("review/.DS_Store")).toBeNull();
  });

  it.each(["../evil", "a/../../evil", "/etc/passwd", "C:/x", "a\\..\\..\\b"])(
    "refuses %s",
    (name) => {
      expect(() => safeEntryPath(name)).toThrow(/outside its folder/);
    },
  );
});

describe("extractSkillArchive", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-skill-zip-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const zip = (files: Record<string, string>): string => {
    const file = path.join(dir, "in.skill");
    fs.writeFileSync(
      file,
      writeZip(
        Object.entries(files).map(([name, text]) => ({
          name,
          data: Buffer.from(text),
        })),
      ),
    );

    return file;
  };

  it("unpacks every file", () => {
    const out = path.join(dir, "out");
    extractSkillArchive(
      zip({
        "review/SKILL.md": "---\nname: review\n---\n",
        "review/scripts/a.sh": "echo",
      }),
      out,
    );
    expect(fs.readFileSync(path.join(out, "review/scripts/a.sh"), "utf8")).toBe(
      "echo",
    );
  });

  it("writes nothing from an archive with an escaping entry", () => {
    const out = path.join(dir, "out");
    expect(() =>
      extractSkillArchive(zip({ "SKILL.md": "x", "../escaped.txt": "x" }), out),
    ).toThrow(/outside its folder/);
    expect(fs.existsSync(path.join(dir, "escaped.txt"))).toBe(false);
    expect(fs.existsSync(out)).toBe(false);
  });

  it("refuses a file that isn't a zip", () => {
    const file = path.join(dir, "bad.zip");
    fs.writeFileSync(file, "not a zip");
    expect(() => extractSkillArchive(file, path.join(dir, "out"))).toThrow(
      /isn't a zip/,
    );
  });
});
