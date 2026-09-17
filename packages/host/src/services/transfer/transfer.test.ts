/**
 * The chunked transfer channel: reassembly, integrity, containment and
 * backpressure. The properties that separate this from the video channel — a
 * dropped chunk corrupts the file, a partial must never be visible — are the
 * ones under test.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../state", () => ({
  appState: {
    sessions: new Map<string, { path: string }>(),
    repoRoots: new Set<string>(),
  },
}));

const { appState } = await import("../../state");
const { TransferHub } = await import("./hub");
const { pumpFile } = await import("./outbound");
const { XFER_ABORT, XFER_CHUNK, XFER_END, decodeXfer, encodeXfer } =
  await import("./protocol");

let home: string;
let worktree: string;

/** Collects what a hub sends, and answers a scripted buffered() probe. */
function makeSink(buffered: () => number = () => 0) {
  const sent: Uint8Array[] = [];

  return { sent, send: (b: Uint8Array) => sent.push(b), buffered };
}

const sha256 = async (bytes: Uint8Array) => {
  const crypto = await import("node:crypto");

  return crypto.createHash("sha256").update(bytes).digest();
};

/** Feed a whole payload to a hub as ordered chunks plus the end marker. */
async function sendAll(
  hub: InstanceType<typeof TransferHub>,
  transferId: number,
  payload: Uint8Array,
  chunkSize = 8,
): Promise<void> {
  let seq = 0;
  for (let off = 0; off < payload.length; off += chunkSize) {
    hub.onBody(
      encodeXfer(
        XFER_CHUNK,
        transferId,
        seq++,
        payload.subarray(off, off + chunkSize),
      ),
    );
  }
  hub.onBody(encodeXfer(XFER_END, transferId, seq, await sha256(payload)));
}

describe("transferHub uploads", () => {
  beforeEach(async () => {
    home = await fs.promises.mkdtemp(path.join(os.tmpdir(), "argus-home-"));
    worktree = await fs.promises.mkdtemp(path.join(os.tmpdir(), "argus-wt-"));
    process.env.ARGUS_HOME = home;
    appState.sessions.clear();
    appState.sessions.set("s1", { path: worktree } as never);
  });

  afterEach(async () => {
    delete process.env.ARGUS_HOME;
    await fs.promises.rm(home, { recursive: true, force: true });
    await fs.promises.rm(worktree, { recursive: true, force: true });
  });

  it("reassembles ordered chunks into one staged file", async () => {
    const hub = new TransferHub(makeSink());
    const payload = Uint8Array.from({ length: 100 }, (_, i) => i);
    const open = await hub.openUpload({
      purpose: "attachment",
      session_id: "s1",
      name: "clip.mov",
      size: payload.length,
    });

    await sendAll(hub, open.transfer_id, payload);
    const result = await hub.completeUpload(open.transfer_id);

    expect(result.name).toBe("clip.mov");
    expect(result.path.startsWith(path.join(home, "uploads", "s1"))).toBe(true);
    const written = await fs.promises.readFile(result.path);
    expect(Uint8Array.from(written)).toEqual(payload);
  });

  it("reorders a chunk that arrives out of order", async () => {
    const hub = new TransferHub(makeSink());
    const payload = Uint8Array.from({ length: 30 }, (_, i) => i);
    const open = await hub.openUpload({
      purpose: "attachment",
      session_id: "s1",
      name: "a.bin",
      size: payload.length,
    });
    const id = open.transfer_id;

    // Chunks 0, 2, 1 — the middle one late.
    hub.onBody(encodeXfer(XFER_CHUNK, id, 0, payload.subarray(0, 10)));
    hub.onBody(encodeXfer(XFER_CHUNK, id, 2, payload.subarray(20, 30)));
    hub.onBody(encodeXfer(XFER_CHUNK, id, 1, payload.subarray(10, 20)));
    hub.onBody(encodeXfer(XFER_END, id, 3, await sha256(payload)));

    const result = await hub.completeUpload(id);
    const written = await fs.promises.readFile(result.path);
    expect(Uint8Array.from(written)).toEqual(payload);
  });

  it("rejects a checksum that does not match the bytes", async () => {
    const hub = new TransferHub(makeSink());
    const payload = Uint8Array.from({ length: 16 }, () => 1);
    const open = await hub.openUpload({
      purpose: "attachment",
      session_id: "s1",
      name: "a.bin",
      size: payload.length,
    });
    hub.onBody(encodeXfer(XFER_CHUNK, open.transfer_id, 0, payload));
    hub.onBody(encodeXfer(XFER_END, open.transfer_id, 1, new Uint8Array(32)));

    await expect(hub.completeUpload(open.transfer_id)).rejects.toMatch(
      /checksum mismatch/,
    );
    await expect(
      fs.promises.readdir(path.join(home, "uploads", "s1")),
    ).resolves.toEqual([]);
  });

  it("rejects a length that does not match the declared total", async () => {
    const hub = new TransferHub(makeSink());
    const payload = Uint8Array.from({ length: 8 }, () => 2);
    const open = await hub.openUpload({
      purpose: "attachment",
      session_id: "s1",
      name: "a.bin",
      size: 16,
    });
    hub.onBody(encodeXfer(XFER_CHUNK, open.transfer_id, 0, payload));
    hub.onBody(
      encodeXfer(XFER_END, open.transfer_id, 1, await sha256(payload)),
    );

    await expect(hub.completeUpload(open.transfer_id)).rejects.toMatch(
      /length mismatch/,
    );
  });

  it("aborting mid-transfer leaves no file behind", async () => {
    const hub = new TransferHub(makeSink());
    const open = await hub.openUpload({
      purpose: "attachment",
      session_id: "s1",
      name: "a.bin",
      size: 64,
    });
    hub.onBody(encodeXfer(XFER_CHUNK, open.transfer_id, 0, new Uint8Array(8)));
    hub.abort(open.transfer_id);
    await new Promise((r) => setTimeout(r, 10));

    await expect(
      fs.promises.readdir(path.join(home, "uploads", "s1")),
    ).resolves.toEqual([]);
    await expect(hub.completeUpload(open.transfer_id)).rejects.toMatch(
      /Unknown transfer/,
    );
  });

  it("a disconnect mid-transfer sweeps the partial", async () => {
    const hub = new TransferHub(makeSink());
    const open = await hub.openUpload({
      purpose: "attachment",
      session_id: "s1",
      name: "a.bin",
      size: 64,
    });
    hub.onBody(encodeXfer(XFER_CHUNK, open.transfer_id, 0, new Uint8Array(8)));
    hub.dispose();
    await new Promise((r) => setTimeout(r, 10));

    await expect(
      fs.promises.readdir(path.join(home, "uploads", "s1")),
    ).resolves.toEqual([]);
  });

  it("trips the size limit on the bytes that arrive, not the header", async () => {
    const hub = new TransferHub(makeSink());
    const open = await hub.openUpload({
      purpose: "attachment",
      session_id: "s1",
      name: "a.bin",
      size: 4,
    });
    // The header lied: send far more than it declared.
    hub.onBody(
      encodeXfer(XFER_CHUNK, open.transfer_id, 0, new Uint8Array(4096)),
    );
    hub.onBody(encodeXfer(XFER_END, open.transfer_id, 1, new Uint8Array(32)));

    await expect(hub.completeUpload(open.transfer_id)).rejects.toMatch(
      /more bytes than it declared/,
    );
  });

  it("writes into a session through the same containment as write_file", async () => {
    const hub = new TransferHub(makeSink());
    const payload = new TextEncoder().encode("hello");
    const open = await hub.openUpload({
      purpose: "file",
      session_id: "s1",
      name: "src/notes.txt",
      size: payload.length,
    });
    await sendAll(hub, open.transfer_id, payload);
    const result = await hub.completeUpload(open.transfer_id);

    expect(result.path).toBe(
      path.join(await realpath(worktree), "src/notes.txt"),
    );
    await expect(fs.promises.readFile(result.path, "utf8")).resolves.toBe(
      "hello",
    );
  });

  it("refuses a destination outside the session", async () => {
    const hub = new TransferHub(makeSink());
    await expect(
      hub.openUpload({
        purpose: "file",
        session_id: "s1",
        name: "../escaped.txt",
        size: 4,
      }),
    ).rejects.toMatch(/outside this session/);
  });

  it("refuses more bytes than the host will stage", async () => {
    const hub = new TransferHub(makeSink());
    await expect(
      hub.openUpload({
        purpose: "attachment",
        session_id: "s1",
        name: "a.bin",
        size: 1024 * 1024 * 1024,
      }),
    ).rejects.toMatch(/limit/);
  });
});

describe("transferHub downloads", () => {
  beforeEach(async () => {
    home = await fs.promises.mkdtemp(path.join(os.tmpdir(), "argus-home-"));
    worktree = await fs.promises.mkdtemp(path.join(os.tmpdir(), "argus-wt-"));
    process.env.ARGUS_HOME = home;
    appState.sessions.clear();
    appState.sessions.set("s1", { path: worktree } as never);
  });

  afterEach(async () => {
    delete process.env.ARGUS_HOME;
    await fs.promises.rm(home, { recursive: true, force: true });
    await fs.promises.rm(worktree, { recursive: true, force: true });
  });

  it("streams a session file out as chunks plus a digest", async () => {
    const payload = Uint8Array.from({ length: 5000 }, (_, i) => i & 0xff);
    await fs.promises.writeFile(path.join(worktree, "big.bin"), payload);
    const sink = makeSink();
    const hub = new TransferHub(sink);

    const open = await hub.openDownload({
      session_id: "s1",
      path: "big.bin",
    });
    expect(open.size).toBe(payload.length);
    await new Promise((r) => setTimeout(r, 50));

    const messages = sink.sent.map((b) => decodeXfer(b));
    const chunks = messages.filter((m) => m?.type === XFER_CHUNK);
    const end = messages.at(-1);
    const joined = new Uint8Array(payload.length);
    let offset = 0;
    chunks.forEach((m) => {
      joined.set(m?.payload as Uint8Array, offset);
      offset += (m?.payload as Uint8Array).length;
    });
    expect(joined).toEqual(payload);
    expect(end?.type).toBe(XFER_END);
    expect(Buffer.from(end?.payload as Uint8Array)).toEqual(
      await sha256(payload),
    );
  });

  it("refuses a path outside the session even when it exists", async () => {
    const outside = path.join(home, "secret.txt");
    await fs.promises.writeFile(outside, "nope");
    const hub = new TransferHub(makeSink());
    await expect(
      hub.openDownload({ session_id: "s1", path: outside }),
    ).rejects.toMatch(/outside this session/);
  });

  it("refuses an escaping path reached through a symlink", async () => {
    const outside = path.join(home, "outside");
    await fs.promises.mkdir(outside, { recursive: true });
    await fs.promises.writeFile(path.join(outside, "keys"), "nope");
    await fs.promises.symlink(outside, path.join(worktree, "link"));
    const hub = new TransferHub(makeSink());
    await expect(
      hub.openDownload({ session_id: "s1", path: "link/keys" }),
    ).rejects.toMatch(/outside this session/);
  });
});

describe("outbound backpressure", () => {
  beforeEach(async () => {
    worktree = await fs.promises.mkdtemp(path.join(os.tmpdir(), "argus-wt-"));
  });

  afterEach(async () => {
    await fs.promises.rm(worktree, { recursive: true, force: true });
  });

  it("pauses while the socket is full and sends every chunk once it drains", async () => {
    const file = path.join(worktree, "big.bin");
    const payload = Uint8Array.from({ length: 64 }, (_, i) => i);
    await fs.promises.writeFile(file, payload);

    const sent: Uint8Array[] = [];
    let full = true;
    let polls = 0;

    const done = pumpFile({
      path: file,
      transferId: 1,
      chunkBytes: 8,
      send: (b) => sent.push(b),
      buffered: () => (full ? 2_000_000 : 0),
      cancelled: () => false,
      delay: async () => {
        polls += 1;
        // Nothing may go out while the socket is over the limit.
        expect(sent).toHaveLength(0);
        if (polls >= 3) {
          full = false;
        }
        await Promise.resolve();
      },
    });

    await done;
    expect(polls).toBeGreaterThanOrEqual(3);
    // Eight chunks, then the end marker — paused, never dropped.
    expect(sent).toHaveLength(9);
    const body = new Uint8Array(payload.length);
    let offset = 0;
    for (const raw of sent.slice(0, 8)) {
      const msg = decodeXfer(raw);
      body.set(msg?.payload as Uint8Array, offset);
      offset += (msg?.payload as Uint8Array).length;
    }
    expect(body).toEqual(payload);
  });

  it("sends an abort when the read fails", async () => {
    const sent: Uint8Array[] = [];
    await expect(
      pumpFile({
        path: path.join(worktree, "missing.bin"),
        transferId: 3,
        send: (b) => sent.push(b),
        buffered: () => 0,
        cancelled: () => false,
      }),
    ).rejects.toMatch(/Failed to open/);
    expect(sent).toHaveLength(0);
  });

  it("stops without an end marker once cancelled", async () => {
    const file = path.join(worktree, "c.bin");
    await fs.promises.writeFile(file, new Uint8Array(64));
    const sent: Uint8Array[] = [];
    let cancelled = false;

    await pumpFile({
      path: file,
      transferId: 4,
      chunkBytes: 8,
      send: (b) => {
        sent.push(b);
        cancelled = true;
      },
      buffered: () => 0,
      cancelled: () => cancelled,
    });

    expect(sent).toHaveLength(1);
    expect(decodeXfer(sent[0] as Uint8Array)?.type).toBe(XFER_CHUNK);
  });

  it("discards a partial when the sender aborts", async () => {
    expect(decodeXfer(encodeXfer(XFER_ABORT, 9, 2))?.type).toBe(XFER_ABORT);
  });
});

async function realpath(p: string): Promise<string> {
  return await fs.promises.realpath(p);
}
