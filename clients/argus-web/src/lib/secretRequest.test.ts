import { describe, expect, it } from "vitest";
import { parseSecretRequest } from "./secretRequest";

describe("parseSecretRequest", () => {
  it("reads a request under the runner's MCP prefix", () => {
    expect(
      parseSecretRequest("mcp__argus__request_secret", {
        label: "Expo token",
        reason: "Build",
        delivery: "env",
        run_command: "EAS",
        env_var: "EXPO_TOKEN",
      }),
    ).toMatchObject({ label: "Expo token", reason: "Build" });
  });

  it("ignores other tools and calls without a label", () => {
    expect(parseSecretRequest("Bash", { label: "x" })).toBeNull();
    expect(parseSecretRequest("request_secret", {})).toBeNull();
  });
});
