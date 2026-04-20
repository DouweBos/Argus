import { describe, expect, it } from "vitest";
import { md5Hex } from "./md5";

// Standard MD5 test vectors — if these ever break, the hash function is wrong.
describe("md5Hex", () => {
  it("hashes the empty string", () => {
    expect(md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
  });

  it("hashes 'a'", () => {
    expect(md5Hex("a")).toBe("0cc175b9c0f1b6a831c399e269772661");
  });

  it("hashes 'abc'", () => {
    expect(md5Hex("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
  });

  it("hashes 'message digest'", () => {
    expect(md5Hex("message digest")).toBe("f96b697d7cb7938d525a2f31aaf161d0");
  });

  it("hashes the alphabet", () => {
    expect(md5Hex("abcdefghijklmnopqrstuvwxyz")).toBe(
      "c3fcd3d76192e4007dfb496cca67e13b",
    );
  });

  it("hashes a typical gravatar input (lowercased, trimmed email)", () => {
    // Well-known Gravatar example.
    expect(md5Hex("MyEmailAddress@example.com".toLowerCase().trim())).toBe(
      "0bc83cb571cd1c50ba6f3e8a78ef1346",
    );
  });

  it("produces a 32-character lowercase hex string", () => {
    const out = md5Hex("arbitrary input");
    expect(out).toHaveLength(32);
    expect(out).toMatch(/^[0-9a-f]{32}$/);
  });
});
