import { describe, expect, it } from "vitest";
import { textBesideImages } from "./images";

describe("textBesideImages", () => {
  it("keeps text copied with images", () => {
    expect(textBesideImages("look at this", [])).toBe("look at this");
    expect(textBesideImages("shot.png\nwhy?", ["shot.png"])).toBe(
      "shot.png\nwhy?",
    );
  });

  it("drops text that only names the images", () => {
    expect(textBesideImages("", [])).toBeNull();
    expect(textBesideImages(" \n", [])).toBeNull();
    expect(textBesideImages("a.png\r\nb.png", ["a.png", "b.png"])).toBeNull();
    expect(
      textBesideImages("https://x.dev/cat.png", ["https://x.dev/cat.png"]),
    ).toBeNull();
  });
});
