import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { diffImages } from "./compare";

function solid(
  width: number,
  height: number,
  rgb: [number, number, number],
): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data.set([...rgb, 255], i * 4);
  }

  return PNG.sync.write(png);
}

describe("diffImages", () => {
  it("scores identical images as matching", () => {
    const img = solid(10, 10, [255, 255, 255]);
    expect(diffImages(img, img).differingFraction).toBe(0);
  });

  it("compares over the shared height only", () => {
    const top = solid(10, 20, [255, 255, 255]);
    const result = diffImages(top, solid(10, 10, [255, 255, 255]));
    expect([result.width, result.height]).toEqual([10, 10]);
    expect(result.differingFraction).toBe(0);
  });

  it("counts clearly different pixels", () => {
    const result = diffImages(
      solid(4, 4, [255, 255, 255]),
      solid(4, 4, [0, 0, 0]),
    );
    expect(result.differingFraction).toBe(1);
    expect(PNG.sync.read(Buffer.from(result.diff, "base64")).width).toBe(4);
  });
});
