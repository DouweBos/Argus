/**
 * The generated Swift catalog: a command's own params type must win over a
 * model that happens to share its name (`huddle_say` vs the gateway's
 * `HuddleSayParams`, which has no `roomId`). `pnpm lint` keeps the file in
 * step with the generator, so checking its output checks the generator.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SWIFT = path.resolve(
  __dirname,
  "../../../../clients/apple/ArgusKit/Sources/ArgusKit/Generated/WireCommands.swift",
);

describe("generated WireCommands.swift", () => {
  const source = fs.readFileSync(SWIFT, "utf8");
  const local = new Set(
    [
      ...source
        .slice(0, source.indexOf("public enum Commands {"))
        .matchAll(/public struct (\w+)/g),
    ].map((m) => m[1]),
  );

  it("points every command at the params type it declared", () => {
    const misrouted = [
      ...source.matchAll(
        /typealias (?:Params|Result) = ArgusProtocol\.(\w+)$/gm,
      ),
    ]
      .map((m) => m[1])
      .filter((name) => local.has(name));

    expect(misrouted).toEqual([]);
  });

  it("gives huddle_say its roomId", () => {
    expect(source).toContain(
      "public typealias Params = ArgusProtocol.CommandsTypes.HuddleSayParams",
    );
  });
});
