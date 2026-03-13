import { describe, expect, it, vi } from "vitest";

// Mock the main module to avoid Electron imports
vi.mock("../../main", () => ({
  getMainWindow: () => null,
}));

import { parseAllowRule, extractSpecifier, globMatch } from "./permissions";

describe("parseAllowRule", () => {
  it("parses bare tool name", () => {
    const rule = parseAllowRule("Bash");
    expect(rule.tool).toBe("Bash");
    expect(rule.specifier).toBeNull();
  });

  it("parses tool with specifier", () => {
    const rule = parseAllowRule("Bash(npm *)");
    expect(rule.tool).toBe("Bash");
    expect(rule.specifier).toBe("npm *");
  });

  it("parses tool with glob specifier", () => {
    const rule = parseAllowRule("Edit(**/*.tsx)");
    expect(rule.tool).toBe("Edit");
    expect(rule.specifier).toBe("**/*.tsx");
  });

  it("strips trailing paren from specifier", () => {
    const rule = parseAllowRule("Write(src/index.ts)");
    expect(rule.specifier).toBe("src/index.ts");
  });

  it("handles empty specifier", () => {
    const rule = parseAllowRule("Bash()");
    expect(rule.tool).toBe("Bash");
    expect(rule.specifier).toBe("");
  });
});

describe("extractSpecifier", () => {
  it("extracts command for Bash", () => {
    expect(extractSpecifier("Bash", { command: "npm install" })).toBe(
      "npm install",
    );
  });

  it("extracts file_path for Edit", () => {
    expect(extractSpecifier("Edit", { file_path: "/src/main.ts" })).toBe(
      "/src/main.ts",
    );
  });

  it("extracts file_path for Write", () => {
    expect(extractSpecifier("Write", { file_path: "/src/new.ts" })).toBe(
      "/src/new.ts",
    );
  });

  it("extracts path fallback for Read", () => {
    expect(extractSpecifier("Read", { path: "/src/file.ts" })).toBe(
      "/src/file.ts",
    );
  });

  it("prefers file_path over path", () => {
    expect(
      extractSpecifier("Edit", { file_path: "/a.ts", path: "/b.ts" }),
    ).toBe("/a.ts");
  });

  it("extracts domain for WebFetch", () => {
    expect(
      extractSpecifier("WebFetch", { url: "https://example.com/api/data" }),
    ).toBe("domain:example.com");
  });

  it("handles WebFetch with port", () => {
    expect(
      extractSpecifier("WebFetch", { url: "http://localhost:3000/test" }),
    ).toBe("domain:localhost");
  });

  it("handles WebFetch without scheme", () => {
    expect(
      extractSpecifier("WebFetch", { url: "example.com/path" }),
    ).toBe("domain:example.com");
  });

  it("returns null for unknown tool", () => {
    expect(extractSpecifier("UnknownTool", { data: "foo" })).toBeNull();
  });

  it("returns null for null input", () => {
    expect(extractSpecifier("Bash", null)).toBeNull();
  });

  it("returns null for non-string command", () => {
    expect(extractSpecifier("Bash", { command: 123 })).toBeNull();
  });
});

describe("globMatch", () => {
  it("matches exact string", () => {
    expect(globMatch("hello", "hello")).toBe(true);
    expect(globMatch("hello", "world")).toBe(false);
  });

  it("matches * as wildcard within path segment", () => {
    expect(globMatch("npm *", "npm install")).toBe(true);
    expect(globMatch("npm *", "npm run build")).toBe(true);
    expect(globMatch("*.ts", "main.ts")).toBe(true);
    expect(globMatch("*.ts", "src/main.ts")).toBe(false); // * does not cross /
  });

  it("matches ** across path separators", () => {
    expect(globMatch("**/*.ts", "src/main.ts")).toBe(true);
    expect(globMatch("**/*.ts", "src/deep/nested/file.ts")).toBe(true);
    expect(globMatch("src/**", "src/anything/here")).toBe(true);
  });

  it("matches ? as single character", () => {
    expect(globMatch("file?.ts", "file1.ts")).toBe(true);
    expect(globMatch("file?.ts", "fileAB.ts")).toBe(false);
    expect(globMatch("file?.ts", "file/.ts")).toBe(false); // ? does not match /
  });

  it("escapes regex special characters in literal parts", () => {
    expect(globMatch("file.ts", "file.ts")).toBe(true);
    expect(globMatch("file.ts", "filexts")).toBe(false); // dot is literal
    expect(globMatch("[test]", "[test]")).toBe(true);
  });

  it("handles complex patterns", () => {
    expect(globMatch("src/**/*.test.ts", "src/lib/parser.test.ts")).toBe(true);
    expect(globMatch("src/**/*.test.ts", "src/parser.test.ts")).toBe(true);
    expect(globMatch("src/**/*.test.ts", "test/parser.test.ts")).toBe(false);
  });

  it("empty pattern matches empty string", () => {
    expect(globMatch("", "")).toBe(true);
    expect(globMatch("", "anything")).toBe(false);
  });

  it("handles domain: prefix patterns", () => {
    expect(globMatch("domain:*.example.com", "domain:api.example.com")).toBe(
      true,
    );
    expect(globMatch("domain:example.com", "domain:example.com")).toBe(true);
    expect(globMatch("domain:example.com", "domain:evil.com")).toBe(false);
  });
});
