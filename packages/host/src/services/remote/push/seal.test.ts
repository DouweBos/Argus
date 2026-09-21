import { gcm } from "@noble/ciphers/aes.js";
import { createDecipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  collapseId,
  collapseSubject,
  seal,
  toSealedNotification,
} from "./seal";

const PUSH_KEY = randomBytes(32).toString("base64");

/**
 * The receiving half, written out the way an iOS Notification Service
 * Extension or an Android handler would: split `nonce ‖ ciphertext ‖ tag`,
 * open with AES-GCM. If this drifts, those extensions break.
 */
function open(pushKey: string, sealed: string): unknown {
  const blob = Buffer.from(sealed, "base64");
  const nonce = blob.subarray(0, 12);
  const tag = blob.subarray(blob.length - 16);
  const ciphertext = blob.subarray(12, blob.length - 16);

  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(pushKey, "base64"),
    nonce,
  );
  decipher.setAuthTag(tag);

  return JSON.parse(
    Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf-8",
    ),
  );
}

const NOTIFICATION = {
  agent_id: "agent-1",
  session_id: "session-1",
  tool_use_id: "tool-1",
  kind: "permission" as const,
  title: "Argus agent needs approval",
  body: "main - Agent requested Bash",
  actions: [
    { id: "approve" as const, title: "Approve" },
    { id: "deny" as const, title: "Deny" },
  ],
};

describe("seal", () => {
  it("round-trips everything the extension needs to render the alert", () => {
    const sealed = seal(PUSH_KEY, toSealedNotification(NOTIFICATION));

    expect(open(PUSH_KEY, sealed)).toEqual({
      title: "Argus agent needs approval",
      body: "main - Agent requested Bash",
      kind: "permission",
      agentId: "agent-1",
      sessionId: "session-1",
      toolUseId: "tool-1",
      actions: [
        { id: "approve", title: "Approve" },
        { id: "deny", title: "Deny" },
      ],
    });
  });

  it("lays the blob out as nonce, ciphertext, then tag", () => {
    const nonce = Buffer.alloc(12, 9);
    const sealed = seal(PUSH_KEY, toSealedNotification(NOTIFICATION), nonce);
    const blob = Buffer.from(sealed, "base64");

    expect(blob.subarray(0, 12).equals(nonce)).toBe(true);
    // 12-byte nonce + 16-byte tag of overhead, and nothing else.
    expect(blob).toHaveLength(
      12 + 16 + JSON.stringify(toSealedNotification(NOTIFICATION)).length,
    );
  });

  it("leaks nothing in the clear", () => {
    const sealed = seal(PUSH_KEY, toSealedNotification(NOTIFICATION));

    expect(sealed).not.toContain("agent-1");
    expect(sealed).not.toContain("approval");
  });

  it("uses a fresh nonce per send", () => {
    const payload = toSealedNotification(NOTIFICATION);

    expect(seal(PUSH_KEY, payload)).not.toBe(seal(PUSH_KEY, payload));
  });

  it("refuses a key that isn't 32 bytes", () => {
    expect(() =>
      seal(
        randomBytes(16).toString("base64"),
        toSealedNotification(NOTIFICATION),
      ),
    ).toThrow(/32 bytes/);
  });
});

describe("collapseSubject", () => {
  it("lets a newer turn result supersede the last one for that agent", () => {
    expect(collapseSubject({ ...NOTIFICATION, kind: "finished" })).toBe(
      "agent-agent-1",
    );
    expect(collapseSubject({ ...NOTIFICATION, kind: "failed" })).toBe(
      "agent-agent-1",
    );
  });

  it("keeps two pending approvals apart — collapsing would hide one", () => {
    const first = collapseSubject(NOTIFICATION);
    const second = collapseSubject({ ...NOTIFICATION, tool_use_id: "tool-2" });

    expect(first).toBe("prompt-tool-1");
    expect(second).toBe("prompt-tool-2");
    expect(first).not.toBe(second);
  });

  it("never collapses an MCP push — each one is its own event", () => {
    expect(collapseSubject({ ...NOTIFICATION, kind: "push" })).toBeNull();
  });
});

describe("collapseId", () => {
  it("is stable per subject but reveals nothing to the relay", () => {
    const id = collapseId(PUSH_KEY, "agent-agent-1");

    expect(id).toBe(collapseId(PUSH_KEY, "agent-agent-1"));
    expect(id).not.toContain("agent-1");
    expect(id).not.toBe(collapseId(PUSH_KEY, "agent-2"));
    // APNs caps the header at 64 bytes.
    expect(id.length).toBeLessThanOrEqual(64);
  });

  it("differs per device, so two devices can't be correlated by it", () => {
    const other = randomBytes(32).toString("base64");

    expect(collapseId(PUSH_KEY, "agent-1")).not.toBe(
      collapseId(other, "agent-1"),
    );
  });
});

describe("interop with the clients", () => {
  it("opens with @noble/ciphers the way the Android handler does", () => {
    const sealed = seal(PUSH_KEY, toSealedNotification(NOTIFICATION));
    const blob = Buffer.from(sealed, "base64");

    // Noble wants the tag left attached to the ciphertext, unlike node:crypto.
    const plaintext = gcm(
      new Uint8Array(Buffer.from(PUSH_KEY, "base64")),
      new Uint8Array(blob.subarray(0, 12)),
    ).decrypt(new Uint8Array(blob.subarray(12)));

    expect(JSON.parse(Buffer.from(plaintext).toString("utf-8"))).toMatchObject({
      title: NOTIFICATION.title,
      toolUseId: "tool-1",
    });
  });
});
