import { describe, expect, it } from "vitest";
import { applyClientAuth } from "./oauth";

describe("applyClientAuth", () => {
  it("sends only Basic for client_secret_basic clients", () => {
    const body = new URLSearchParams();
    const headers: Record<string, string> = {};
    applyClientAuth(body, headers, {
      id: "abc",
      secret: "shh",
      authMethod: "client_secret_basic",
    });

    expect(body.has("client_id")).toBe(false);
    expect(body.has("client_secret")).toBe(false);
    expect(headers.authorization).toBe(
      `Basic ${Buffer.from("abc:shh").toString("base64")}`,
    );
  });

  it("sends form fields for client_secret_post clients", () => {
    const body = new URLSearchParams();
    const headers: Record<string, string> = {};
    applyClientAuth(body, headers, {
      id: "abc",
      secret: "shh",
      authMethod: "client_secret_post",
    });

    expect(body.get("client_id")).toBe("abc");
    expect(body.get("client_secret")).toBe("shh");
    expect(headers.authorization).toBeUndefined();
  });

  it("sends only client_id for public clients", () => {
    const body = new URLSearchParams();
    const headers: Record<string, string> = {};
    applyClientAuth(body, headers, { id: "abc" });

    expect(body.get("client_id")).toBe("abc");
    expect(body.has("client_secret")).toBe(false);
    expect(headers.authorization).toBeUndefined();
  });
});
