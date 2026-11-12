import { describe, expect, it } from "vitest";
import { parseRunnerCommand } from "./runnerCommand";

describe("parseRunnerCommand", () => {
  const commands = ["compact", "review"];

  it("recognizes the runner's commands, with or without arguments", () => {
    expect(
      parseRunnerCommand("/compact keep the plan\nand the paths", commands),
    ).toEqual({
      name: "compact",
      args: "keep the plan\nand the paths",
    });
    expect(parseRunnerCommand("  /review  ", commands)).toEqual({
      name: "review",
    });
  });

  it("leaves unknown commands, paths and prose alone", () => {
    expect(parseRunnerCommand("/nope ENG-1", commands)).toBeNull();
    expect(parseRunnerCommand("/usr/bin/env is broken", commands)).toBeNull();
    expect(parseRunnerCommand("run /compact later", commands)).toBeNull();
    expect(parseRunnerCommand("/compact", [])).toBeNull();
  });
});
