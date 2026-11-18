import { describe, expect, it, vi } from "vitest";

vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));

const { buildBlueprintRevisionPrompt, sanitizeRevisedInstructions } =
  await import("./revise");

describe("sanitizeRevisedInstructions", () => {
  it("strips a markdown fence and rejects an empty reply", () => {
    expect(sanitizeRevisedInstructions("```markdown\n# Set up\n```")).toBe(
      "# Set up",
    );
    expect(sanitizeRevisedInstructions("  \n")).toBeNull();
  });
});

describe("buildBlueprintRevisionPrompt", () => {
  it("lists the references only when there are some", () => {
    const base = { instructions: "Do it", note: "Argus is not Tauri" };
    expect(
      buildBlueprintRevisionPrompt({ ...base, references: ["/w/argus"] }),
    ).toContain("- /w/argus");
    expect(
      buildBlueprintRevisionPrompt({ ...base, references: [] }),
    ).not.toContain("Reference projects");
  });
});
