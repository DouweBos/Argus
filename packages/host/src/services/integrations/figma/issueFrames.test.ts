import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  connected: true,
  names: new Map<string, string>(),
}));

vi.mock("./service", () => ({
  figmaApi: () => (mocks.connected ? {} : null),
  cachedFigmaFrame: (url: string) => {
    const name = mocks.names.get(url);

    return name ? { name, image: "png", width: 1, height: 1 } : null;
  },
}));
vi.mock("../../telemetry/telemetry", () => ({ capture: mocks.capture }));

const { MAX_ISSUE_FRAMES, issueFrames, issueFramesText } =
  await import("./issueFrames");

const link = (node: string) =>
  `https://www.figma.com/design/FILE/App?node-id=${node}`;

describe("issueFrames", () => {
  beforeEach(() => {
    mocks.connected = true;
    mocks.names.clear();
    mocks.capture.mockReset();
  });

  it("dedupes links to the same node and keeps the file key and node id", () => {
    mocks.names.set(link("1-2"), "Home");

    expect(
      issueFrames([
        link("1-2"),
        `${link("1-2")}&t=abc`,
        "https://www.figma.com/design/OTHER/App",
        "https://example.com",
      ]),
    ).toEqual([
      { url: link("1-2"), fileKey: "FILE", nodeId: "1:2", name: "Home" },
      {
        url: "https://www.figma.com/design/OTHER/App",
        fileKey: "OTHER",
        nodeId: null,
        name: null,
      },
    ]);
  });

  it("lists frames as text, pointing at figma_get_frame", () => {
    mocks.names.set(link("5-6"), "Checkout");
    const text = issueFramesText([link("5-6"), link("7-8")]);

    expect(text).toContain("1. **Checkout** — file `FILE`, node `5:6`");
    expect(text).toContain("2. Figma frame — file `FILE`, node `7:8`");
    expect(text).toContain(`   ${link("7-8")}`);
    expect(text).toContain("`figma_get_frame`");
    expect(mocks.capture).toHaveBeenCalledWith("issue_designs_resolved", {
      frames: 2,
      named: 1,
    });
  });

  it("still lists the links when Figma isn't connected", () => {
    mocks.connected = false;
    const text = issueFramesText([link("5-6")]);

    expect(text).toContain("file `FILE`, node `5:6`");
    expect(text).toContain("Figma isn't connected");
  });

  it("caps the listing and counts the rest", () => {
    const urls = Array.from({ length: MAX_ISSUE_FRAMES + 3 }, (_, i) =>
      link(`${i}-1`),
    );
    const text = issueFramesText(urls)!;

    expect(text).not.toContain(urls.at(-1)!);
    expect(text).toContain("…and 3 more in the issue.");
  });

  it("returns nothing when the issue links no frames", () => {
    expect(issueFramesText(["https://example.com"])).toBeNull();
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});
