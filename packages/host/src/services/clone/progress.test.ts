import { describe, expect, it } from "vitest";
import {
  CloneProgressReader,
  cloneFailureMessage,
  parseProgressLine,
} from "./progress";

describe("parseProgressLine", () => {
  it.each([
    ["remote: Enumerating objects: 120, done.", "counting", null],
    ["remote: Counting objects:  45% (9/20)", "counting", 45],
    ["remote: Compressing objects: 100% (20/20), done.", "compressing", 100],
    [
      "Receiving objects:  37% (370/1000), 1.20 MiB | 2.40 MiB/s",
      "receiving",
      37,
    ],
    ["Resolving deltas:  80% (40/50)", "resolving", 80],
    ["Updating files:  12% (3/25)", "checking_out", 12],
  ])("reads %j", (line, phase, percent) => {
    expect(parseProgressLine(line)).toEqual({ phase, percent });
  });

  it("ignores everything else", () => {
    expect(parseProgressLine("Cloning into 'tally'...")).toBeNull();
  });
});

describe("the progress reader", () => {
  it("splits on carriage returns across chunks and keeps the rest", () => {
    const seen: string[] = [];
    const reader = new CloneProgressReader((p) =>
      seen.push(`${p.phase}:${p.percent}`),
    );
    reader.push("Cloning into 'tally'...\nReceiving objects:  1");
    reader.push("0% (1/10)\rReceiving objects:  50% (5/10)\r");
    reader.push("Receiving objects: 100% (10/10), done.\nfatal: nope");
    reader.end();
    expect(seen).toEqual(["receiving:10", "receiving:50", "receiving:100"]);
    expect(reader.messages).toEqual(["Cloning into 'tally'...", "fatal: nope"]);
  });
});

describe("cloneFailureMessage", () => {
  it("explains the common failures", () => {
    expect(
      cloneFailureMessage([
        "ERROR: Repository not found.",
        "fatal: Could not read",
      ]),
    ).toMatch(/not found/);
    expect(
      cloneFailureMessage(["git@github.com: Permission denied (publickey)."]),
    ).toMatch(/ssh key/);
  });

  it("falls back to the fatal line", () => {
    expect(cloneFailureMessage(["Cloning", "fatal: something odd"])).toBe(
      "something odd",
    );
  });
});
