import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keyboardEvent } from "./conductorInput";

vi.mock("../conductor/logger", () => ({ logConductorHttp: () => undefined }));

describe("keyboardEvent", () => {
  let server: http.Server | undefined;

  afterEach(() => {
    server?.close();
  });

  it("presses a key once for its down and up", async () => {
    const pressed: string[] = [];
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        pressed.push(`${req.url} ${body}`);
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const reservation = {
      agentId: "a",
      deviceId: "web:chromium:1",
      cdpPort: 0,
      cdpTargetId: "t",
      driverPort: (server.address() as AddressInfo).port,
    };

    await keyboardEvent(reservation, "down", "b");
    await keyboardEvent(reservation, "up", "b");

    expect(pressed).toEqual(['/pressKey {"key":"b"}']);
  });
});
