import { describe, expect, it } from "vitest";
import { isIntegrationNotConnected } from "./notifications";

describe("isIntegrationNotConnected", () => {
  it("keeps an unconnected Figma or Linear out of the warnings", () => {
    expect(
      isIntegrationNotConnected(
        new Error("Figma isn't connected. Connect it in Settings → Integrations."),
      ),
    ).toBe(true);
    expect(
      isIntegrationNotConnected("Linear isn't connected. Connect it in Settings."),
    ).toBe(true);
  });

  it("still reports other failures", () => {
    expect(isIntegrationNotConnected(new Error("Figma has no frame"))).toBe(false);
    expect(isIntegrationNotConnected(new Error("not connected to host"))).toBe(false);
  });
});
