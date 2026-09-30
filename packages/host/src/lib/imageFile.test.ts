import { describe, expect, it } from "vitest";
import { ensureExt, inferImageExt } from "./imageFile";

describe("image file names", () => {
  it("prefers the data URL's type, normalising jpeg", () => {
    expect(inferImageExt("data:image/jpeg;base64,xx", "a.png")).toBe("jpg");
    expect(inferImageExt("data:image/webp;base64,xx", "a.png")).toBe("webp");
  });

  it("falls back to the name, then png", () => {
    expect(inferImageExt("https://x/y", "shot.GIF")).toBe("gif");
    expect(inferImageExt("https://x/y", "shot")).toBe("png");
  });

  it("only appends an extension when there is none", () => {
    expect(ensureExt("shot", "png")).toBe("shot.png");
    expect(ensureExt("shot.jpg", "png")).toBe("shot.jpg");
  });
});
