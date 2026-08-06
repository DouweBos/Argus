/**
 * Live-edit a view property on the running app (Reveal-style editing).
 *
 * Talks to the in-process `/set` endpoint **directly over HTTP** rather than
 * through `conductor native-set`: the CLI's argument parser coerces a
 * hex-pointer id like `0x12bf3a6c0` into the decimal number `5032351232`, so the
 * server can't find the view ("no view with id …"). Passing the id as a
 * URL-encoded query param keeps it intact. The server applies the change and
 * returns `{status:"ok"}` or `{status:"error", message}`.
 */

import { inprocGetJson, readInprocPort } from "./inproc";

export interface SetPropertyRequest {
  deviceKey: string;
  key: string;
  nodeId: string;
  value: string;
}

export async function setNodeProperty(
  req: SetPropertyRequest,
): Promise<{ ok: boolean }> {
  const { deviceKey, nodeId, key, value } = req;
  if (!deviceKey || !nodeId || !key) {
    throw "Missing device, node, or property.";
  }

  const port = readInprocPort(deviceKey);
  if (port === null) {
    throw "In-process server not found — relaunch the app with inspection (launch-app --inject).";
  }

  const query =
    `id=${encodeURIComponent(nodeId)}` +
    `&key=${encodeURIComponent(key)}` +
    `&value=${encodeURIComponent(value)}`;
  const res = await inprocGetJson<{ message?: string; status?: string }>(
    port,
    `/set?${query}`,
  );

  if (res.status !== "ok") {
    throw (
      (typeof res.message === "string" && res.message) ||
      `native-set ${key} failed`
    );
  }

  return { ok: true };
}
