// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { svgToImage } from "./Mermaid";

const decode = (src: string) =>
  decodeURIComponent(src.replace("data:image/svg+xml;charset=utf-8,", ""));

describe("svgToImage", () => {
  it("serialises mermaid's svg as an image with its viewBox size", () => {
    const image = svgToImage(
      '<svg id="m1" xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 120.5 40" style="max-width: 120px"><foreignObject><div>a<br>b</div></foreignObject></svg>',
    );

    expect(image?.src.startsWith("data:image/svg+xml;")).toBe(true);
    expect(image?.width).toBe(121);
    expect(image?.height).toBe(40);
    const xml = decode(image!.src);
    expect(xml).toContain('xmlns="http://www.w3.org/2000/svg"');
    // HTML void tags become well-formed XML, or the image fails to load.
    expect(xml).toContain("<br />");
    expect(new DOMParser().parseFromString(xml, "image/svg+xml").querySelector("parsererror")).toBeNull();
  });

  it("omits the size when there is no usable viewBox", () => {
    const image = svgToImage("<svg><text>x</text></svg>");

    expect(image?.width).toBeUndefined();
    expect(image?.height).toBeUndefined();
  });

  it("returns null when there is no svg", () => {
    expect(svgToImage("<div>nope</div>")).toBeNull();
  });
});
