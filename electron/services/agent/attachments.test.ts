import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ATTACHMENT_BYTES, resolveAttachments } from "./attachments";

vi.mock("node:fs", () => ({
  default: {
    statSync: vi.fn(),
    readFileSync: vi.fn(),
  },
  statSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockStatSync = vi.mocked(fs.statSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);

function fakeFileStat(size: number): fs.Stats {
  return { size, isFile: () => true } as unknown as fs.Stats;
}

describe("resolveAttachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns [] for undefined or empty input", () => {
    expect(resolveAttachments(undefined)).toEqual([]);
    expect(resolveAttachments([])).toEqual([]);
  });

  it("reads a path attachment and infers mime from extension", () => {
    mockStatSync.mockReturnValue(fakeFileStat(10));
    mockReadFileSync.mockReturnValue(Buffer.from("hello"));

    const out = resolveAttachments([{ path: "/abs/screenshot.png" }]);
    expect(out).toEqual([
      {
        data: Buffer.from("hello").toString("base64"),
        media_type: "image/png",
      },
    ]);
  });

  it("honours an explicit mime_type on a path attachment", () => {
    mockStatSync.mockReturnValue(fakeFileStat(10));
    mockReadFileSync.mockReturnValue(Buffer.from("x"));

    const out = resolveAttachments([
      { path: "/abs/img.png", mime_type: "image/jpeg" },
    ]);
    expect(out[0].media_type).toBe("image/jpeg");
  });

  it("rejects non-absolute paths", () => {
    expect(() => resolveAttachments([{ path: "relative/foo.png" }])).toThrow(
      /must be absolute/,
    );
  });

  it("rejects unreadable files", () => {
    mockStatSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(() => resolveAttachments([{ path: "/abs/missing.png" }])).toThrow(
      /cannot read file/,
    );
  });

  it("rejects non-regular files", () => {
    mockStatSync.mockReturnValue({
      size: 10,
      isFile: () => false,
    } as unknown as fs.Stats);
    expect(() => resolveAttachments([{ path: "/abs/dir.png" }])).toThrow(
      /not a regular file/,
    );
  });

  it("rejects files larger than the cap", () => {
    mockStatSync.mockReturnValue(fakeFileStat(MAX_ATTACHMENT_BYTES + 1));
    expect(() => resolveAttachments([{ path: "/abs/big.png" }])).toThrow(
      /too large/,
    );
  });

  it("rejects unknown extensions without explicit mime_type", () => {
    mockStatSync.mockReturnValue(fakeFileStat(10));
    expect(() => resolveAttachments([{ path: "/abs/file.bmp" }])).toThrow(
      /cannot infer mime type/,
    );
  });

  it("rejects unsupported mime types", () => {
    mockStatSync.mockReturnValue(fakeFileStat(10));
    expect(() =>
      resolveAttachments([{ path: "/abs/file.png", mime_type: "image/bmp" }]),
    ).toThrow(/unsupported mime type/);
  });

  it("accepts inline base64 data with a mime_type", () => {
    const out = resolveAttachments([
      { data: "aGVsbG8=", mime_type: "image/png" },
    ]);
    expect(out).toEqual([{ data: "aGVsbG8=", media_type: "image/png" }]);
  });

  it("rejects inline data without mime_type", () => {
    expect(() => resolveAttachments([{ data: "aGVsbG8=" }])).toThrow(
      /mime_type is required/,
    );
  });

  it("rejects inline data whose approximate size exceeds the cap", () => {
    // base64 length * 3/4 ≈ byte count. Pick a length just over the cap.
    const bigLen = Math.ceil((MAX_ATTACHMENT_BYTES + 1) * (4 / 3));
    const payload = "A".repeat(bigLen);
    expect(() =>
      resolveAttachments([{ data: payload, mime_type: "image/png" }]),
    ).toThrow(/base64 payload too large/);
  });

  it("rejects entries missing both path and data", () => {
    expect(() => resolveAttachments([{ name: "nothing" }])).toThrow(
      /must provide either 'path' or 'data'/,
    );
  });

  it("uses the name field in error messages when provided", () => {
    expect(() =>
      resolveAttachments([{ data: "abc", name: "shot.png" }]),
    ).toThrow(/shot\.png/);
  });
});
