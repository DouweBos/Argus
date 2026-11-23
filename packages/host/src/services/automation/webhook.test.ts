import crypto from "node:crypto";
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@argus/host/bus", () => ({ emitHostEvent: vi.fn() }));
vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));
const fireAutomationFromEvent = vi.fn();
vi.mock("./eventDispatch", () => ({ fireAutomationFromEvent }));
vi.mock("../remote/managedTunnel", () => ({
  getManagedTunnelUrl: () => "wss://host.example.dev",
}));

const { createAutomation, resetAutomationCache } = await import("./manager");
const {
  handleWebhook,
  hasWebhookSecret,
  resetWebhookSecrets,
  rotateWebhookSecret,
  verifyWebhook,
} = await import("./webhook");

let home: string;
let previousHome: string | undefined;

function request(
  id: string,
  body: string,
  headers: Record<string, string>,
  method = "POST",
): IncomingMessage {
  const req = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage;
  Object.assign(req, {
    method,
    url: `/hooks/automations/${id}`,
    headers,
  });

  return req;
}

function response(): ServerResponse & { status?: number; body?: string } {
  const res = {
    headersSent: false,
    writeHead(status: number) {
      res.status = status;

      return res;
    },
    end(body: string) {
      res.body = body;

      return res;
    },
  } as unknown as ServerResponse & { status?: number; body?: string };

  return res;
}

function sign(secret: string, body: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

function hook(): string {
  return createAutomation({
    name: "Hook",
    enabled: true,
    playbook: "x",
    trigger: { kind: "webhook", fire: "each", max_runs_per_hour: 4 },
  }).id;
}

describe("automation webhook", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-webhook-"));
    process.env.ARGUS_HOME = home;
    resetAutomationCache();
    resetWebhookSecrets();
    fireAutomationFromEvent.mockReset();
    fireAutomationFromEvent.mockReturnValue({ accepted: true, queued: 0 });
  });

  afterEach(() => {
    process.env.ARGUS_HOME = previousHome;
    fs.rmSync(home, { force: true, recursive: true });
  });

  it("hands out a secret once, behind the tunnel's https address", () => {
    const id = hook();
    expect(hasWebhookSecret(id)).toBe(false);
    const { secret, url } = rotateWebhookSecret(id);
    expect(url).toBe(`https://host.example.dev/hooks/automations/${id}`);
    expect(secret.length).toBeGreaterThan(30);
    expect(hasWebhookSecret(id)).toBe(true);
    expect(rotateWebhookSecret(id).secret).not.toBe(secret);
  });

  it("verifies a GitHub-style signature or a bearer secret", () => {
    const body = Buffer.from('{"a":1}');
    expect(
      verifyWebhook("s3cret", body, {
        "x-hub-signature-256": sign("s3cret", '{"a":1}'),
      }),
    ).toBe(true);
    expect(
      verifyWebhook("s3cret", body, {
        "x-hub-signature-256": sign("other", '{"a":1}'),
      }),
    ).toBe(false);
    expect(
      verifyWebhook("s3cret", body, { authorization: "Bearer s3cret" }),
    ).toBe(true);
    expect(verifyWebhook("s3cret", body, {})).toBe(false);
  });

  it("fires with the posted JSON as the payload", async () => {
    const id = hook();
    const { secret } = rotateWebhookSecret(id);
    const body = '{"action":"opened"}';
    const res = response();
    await handleWebhook(
      request(id, body, {
        "x-hub-signature-256": sign(secret, body),
        "x-github-event": "issues",
      }),
      res,
    );
    expect(res.status).toBe(202);
    expect(fireAutomationFromEvent).toHaveBeenCalledWith(
      id,
      expect.objectContaining({
        origin: "webhook",
        kind: "webhook",
        summary: "webhook github:issues",
        payload: { sender_event: "github:issues", body: { action: "opened" } },
      }),
    );
  });

  it("answers an unknown automation and a bad secret the same way", async () => {
    const id = hook();
    rotateWebhookSecret(id);
    const bad = response();
    await handleWebhook(
      request(id, "{}", { authorization: "Bearer nope" }),
      bad,
    );
    const missing = response();
    await handleWebhook(
      request("nope", "{}", { authorization: "Bearer nope" }),
      missing,
    );
    expect(bad.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(fireAutomationFromEvent).not.toHaveBeenCalled();
  });

  it("answers GitHub's ping without starting a run", async () => {
    const id = hook();
    const { secret } = rotateWebhookSecret(id);
    const res = response();
    await handleWebhook(
      request(id, "{}", {
        authorization: `Bearer ${secret}`,
        "x-github-event": "ping",
      }),
      res,
    );
    expect(res.status).toBe(200);
    expect(fireAutomationFromEvent).not.toHaveBeenCalled();
  });
});
