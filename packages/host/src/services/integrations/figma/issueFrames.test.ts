import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  connected: true,
  figmaFrame: vi.fn(),
}));

vi.mock("./service", () => ({
  figmaApi: () => (mocks.connected ? {} : null),
  figmaFrame: mocks.figmaFrame,
}));
vi.mock("../../telemetry/telemetry", () => ({ capture: mocks.capture }));

const { MAX_ISSUE_FRAMES, issueFrameContent, resolveIssueFrames } =
  await import("./issueFrames");

const frame = (name: string) => ({
  name,
  image: `png:${name}`,
  width: 390,
  height: 844,
});
const link = (node: string) =>
  `https://www.figma.com/design/FILE/App?node-id=${node}`;

describe("issueFrames", () => {
  beforeEach(() => {
    mocks.connected = true;
    mocks.capture.mockReset();
    mocks.figmaFrame.mockReset();
  });

  describe("resolveIssueFrames", () => {
    it("dedupes links to the same node and keeps the file key and node id", async () => {
      const fetch = vi.fn(async () => frame("Home"));
      const result = await resolveIssueFrames(
        [link("1-2"), `${link("1-2")}&t=abc`, "https://example.com"],
        fetch,
      );

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.frames).toEqual([
        {
          url: link("1-2"),
          fileKey: "FILE",
          nodeId: "1:2",
          frame: frame("Home"),
        },
      ]);
    });

    it("reports frames that fail and skips those over the cap", async () => {
      const urls = Array.from({ length: MAX_ISSUE_FRAMES + 2 }, (_, i) =>
        link(`${i}-1`),
      );
      const fetch = vi.fn(async (url: string) => {
        if (url === urls[1]) {
          throw new Error("403");
        }

        return url === urls[2] ? null : frame(url);
      });
      const result = await resolveIssueFrames(urls, fetch);

      expect(fetch).toHaveBeenCalledTimes(MAX_ISSUE_FRAMES);
      expect(result.frames).toHaveLength(MAX_ISSUE_FRAMES - 2);
      expect(result.failed).toEqual([urls[1], urls[2]]);
      expect(result.skipped).toEqual(urls.slice(MAX_ISSUE_FRAMES));
    });
  });

  describe("issueFrameContent", () => {
    it("returns the summary then one image per frame", async () => {
      mocks.figmaFrame.mockResolvedValue(frame("Checkout"));
      const content = await issueFrameContent([link("5-6")]);

      expect(content[0]).toMatchObject({ type: "text" });
      expect((content[0] as { text: string }).text).toContain(
        "**Checkout** (390×844 pt) — file `FILE`, node `5:6`",
      );
      expect(content[1]).toEqual({
        type: "image",
        data: "png:Checkout",
        mimeType: "image/png",
      });
      expect(mocks.capture).toHaveBeenCalledWith("issue_designs_resolved", {
        failed: 0,
        resolved: 1,
        skipped: 0,
      });
    });

    it("adds nothing when Figma isn't connected", async () => {
      mocks.connected = false;

      await expect(issueFrameContent([link("5-6")])).resolves.toEqual([]);
      expect(mocks.figmaFrame).not.toHaveBeenCalled();
      expect(mocks.capture).not.toHaveBeenCalled();
    });
  });
});
