import { describe, expect, it } from "vitest";
import { alwaysAllowRule } from "./alwaysAllowRule";

describe("alwaysAllowRule", () => {
  it("generates Bash rule with binary prefix", () => {
    expect(alwaysAllowRule("Bash", { command: "npm install lodash" })).toBe(
      "Bash(npm *)",
    );
  });

  it("generates bare Bash rule for empty command", () => {
    expect(alwaysAllowRule("Bash", { command: "" })).toBe("Bash");
  });

  it("generates Bash rule for complex command", () => {
    expect(alwaysAllowRule("Bash", { command: "git commit -m 'fix'" })).toBe(
      "Bash(git *)",
    );
  });

  it("generates Edit rule with extension glob", () => {
    expect(alwaysAllowRule("Edit", { file_path: "/src/main.tsx" })).toBe(
      "Edit(**/*.tsx)",
    );
  });

  it("generates bare Edit rule when no extension", () => {
    expect(alwaysAllowRule("Edit", { file_path: "Makefile" })).toBe("Edit");
  });

  it("generates Write rule with extension", () => {
    expect(alwaysAllowRule("Write", { file_path: "/src/styles.css" })).toBe(
      "Write(**/*.css)",
    );
  });

  it("generates Read rule using path fallback", () => {
    expect(alwaysAllowRule("Read", { path: "/src/config.json" })).toBe(
      "Read(**/*.json)",
    );
  });

  it("generates WebFetch rule with domain", () => {
    expect(
      alwaysAllowRule("WebFetch", { url: "https://api.example.com/data" }),
    ).toBe("WebFetch(domain:api.example.com)");
  });

  it("generates bare WebFetch for invalid URL", () => {
    expect(alwaysAllowRule("WebFetch", { url: "not a url" })).toBe("WebFetch");
  });

  it("generates bare rule for unknown tools", () => {
    expect(alwaysAllowRule("Grep", {})).toBe("Grep");
    expect(alwaysAllowRule("Agent", {})).toBe("Agent");
  });
});
