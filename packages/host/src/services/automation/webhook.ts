/**
 * The webhook trigger: `POST /hooks/automations/<id>` on the gateway, reached
 * from outside through the managed tunnel. A request must prove it knows the
 * automation's secret — a GitHub-style `X-Hub-Signature-256` HMAC of the body,
 * or `Authorization: Bearer <secret>` for senders that can't sign. The body
 * becomes the run's event payload; `fireAutomationFromEvent` applies the cap
 * and the no-overlap rule.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { warn } from "@argus/host/logger";
import { getManagedTunnelUrl } from "../remote/managedTunnel";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { fireAutomationFromEvent } from "./eventDispatch";
import { writeJson } from "./jsonFile";
import { getAutomation, requireAutomation } from "./manager";
import { automationWebhooksFilePath } from "./paths";

export const WEBHOOK_PREFIX = "/hooks/automations/";
const MAX_BODY_BYTES = 1024 * 1024;

type Secrets = Record<string, { secret: string; created_at: number }>;
let cache: Secrets | null = null;

function load(): Secrets {
  if (cache) {
    return cache;
  }
  try {
    cache = JSON.parse(
      fs.readFileSync(automationWebhooksFilePath(), "utf8"),
    ) as Secrets;
  } catch {
    cache = {};
  }

  return cache;
}

function save(next: Secrets): void {
  cache = next;
  writeJson(automationWebhooksFilePath(), next);
  try {
    fs.chmodSync(automationWebhooksFilePath(), 0o600);
  } catch (e) {
    warn(`webhook secrets: chmod failed: ${String(e)}`);
  }
}

/** Test hook. */
export function resetWebhookSecrets(): void {
  cache = null;
}

export function hasWebhookSecret(automationId: string): boolean {
  return automationId in load();
}

/** The public URL, or null while the managed tunnel isn't up. */
export function webhookUrl(automationId: string): string | null {
  const base = getManagedTunnelUrl();
  if (!base) {
    return null;
  }
  const https = base.replace(/^wss:/, "https:").replace(/\/+$/, "");

  return `${https}${WEBHOOK_PREFIX}${automationId}`;
}

/** A fresh secret, replacing any old one. Shown once; never read back. */
export function rotateWebhookSecret(automationId: string): {
  secret: string;
  url: string | null;
} {
  requireAutomation(automationId);
  const secret = crypto.randomBytes(32).toString("base64url");
  // Secrets of deleted automations go on the next rotation.
  const kept = Object.fromEntries(
    Object.entries(load()).filter(([id]) => getAutomation(id)),
  );
  save({ ...kept, [automationId]: { secret, created_at: Date.now() } });
  telemetryCapture("automation_trigger_changed", {
    trigger_kind: "webhook",
    action: "secret_rotated",
  });

  return { secret, url: webhookUrl(automationId) };
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** Whether the request proves it knows `secret`. */
export function verifyWebhook(
  secret: string,
  body: Buffer,
  headers: IncomingMessage["headers"],
): boolean {
  const signature =
    headers["x-hub-signature-256"] ?? headers["x-argus-signature-256"];
  if (typeof signature === "string") {
    const expected = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;

    return safeEqual(signature.trim(), expected);
  }
  const auth = headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return safeEqual(auth.slice("Bearer ".length).trim(), secret);
  }

  return false;
}

function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve(null);
        req.destroy();

        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function reply(res: ServerResponse, status: number, body: object): void {
  res
    .writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    })
    .end(JSON.stringify(body));
}

/** `github:pull_request` and the like, for the run history; never free text. */
function senderEvent(headers: IncomingMessage["headers"]): string | null {
  const github = headers["x-github-event"];
  if (typeof github === "string" && /^[a-z_]{1,40}$/.test(github)) {
    return `github:${github}`;
  }
  const gitlab = headers["x-gitlab-event"];
  if (typeof gitlab === "string" && /^[A-Za-z ]{1,40}$/.test(gitlab)) {
    return `gitlab:${gitlab.toLowerCase().replaceAll(" ", "_")}`;
  }

  return null;
}

export function isWebhookRoute(pathname: string): boolean {
  return pathname.startsWith(WEBHOOK_PREFIX);
}

export async function handleWebhook(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    reply(res, 405, { error: "POST only" });

    return;
  }
  const id = decodeURIComponent(
    (req.url ?? "").split("?")[0].slice(WEBHOOK_PREFIX.length),
  );
  const body = await readBody(req);
  if (body === null) {
    reply(res, 413, { error: "Body too large" });

    return;
  }
  // One answer for "no such automation" and "wrong secret": the URL is public.
  const secret = load()[id]?.secret;
  if (!secret || !verifyWebhook(secret, body, req.headers)) {
    reply(res, 401, { error: "Bad signature" });

    return;
  }
  const automation = getAutomation(id);
  if (automation?.trigger.kind !== "webhook") {
    reply(res, 409, { error: "This automation doesn't run on a webhook." });

    return;
  }

  const event = senderEvent(req.headers);
  if (event === "github:ping") {
    reply(res, 200, { ok: true });

    return;
  }

  const text = body.toString("utf8");
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: the run reads it as text.
  }
  const result = fireAutomationFromEvent(id, {
    origin: "webhook",
    kind: "webhook",
    summary: event ? `webhook ${event}` : "webhook",
    items: [],
    payload: { sender_event: event, body: payload },
    received_at: Date.now(),
  });
  if (result.accepted) {
    reply(res, 202, { queued: result.queued });
  } else {
    reply(res, 409, { error: result.reason });
  }
}
