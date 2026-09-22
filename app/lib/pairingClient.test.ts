import { describe, expect, it } from "vitest";
import { canDriveArgus, pairingClientLabel } from "./pairingClient";

describe("pairingClientLabel", () => {
  it("names the product, and what it runs on when it said", () => {
    expect(
      pairingClientLabel({
        product: "Argus Remote",
        kind: "mobile",
        device: "iPhone 17 Pro",
      }),
    ).toBe("Argus Remote on iPhone 17 Pro");
    expect(
      pairingClientLabel({ product: "Argus for Mac", kind: "desktop" }),
    ).toBe("Argus for Mac");
  });
});

describe("canDriveArgus", () => {
  it("offers the keyboard to a desktop only", () => {
    expect(canDriveArgus({ product: "Argus for Mac", kind: "desktop" })).toBe(
      true,
    );
    expect(canDriveArgus({ product: "Argus Remote", kind: "mobile" })).toBe(
      false,
    );
    expect(canDriveArgus({ product: "Argus Web", kind: "web" })).toBe(false);
  });

  it("keeps the choice for a client that did not identify itself", () => {
    expect(canDriveArgus(null)).toBe(true);
  });
});
