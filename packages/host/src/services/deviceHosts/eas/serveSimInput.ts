/**
 * serve-sim's input socket: tagged JSON over a WebSocket, with the session
 * token as a subprotocol so it stays on the host.
 */

import type { ServeSimEndpoint } from "./ids";
import type WebSocket from "ws";
import { easFetch, easSocket } from "./http";
import { enc } from "./serveSim";

const MSG_TOUCH = 0x03;
const MSG_BUTTON = 0x04;
const MSG_KEY = 0x06;
const TAG_SCREEN_CONFIG = 0x82;
const TAG_INPUT_ADMITTED = 0x83;

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

const BUTTONS: Record<string, string> = {
  ios_home: "home",
  home: "home",
  ios_lock: "lock",
  ios_power: "lock",
  lock: "lock",
  ios_app_switcher: "app_switcher",
  app_switcher: "app_switcher",
};

const TOUCH_PHASE = ["begin", "move", "end"] as const;

export interface ScreenConfig {
  height: number;
  orientation: string;
  width: number;
}

/**
 * serve-sim's input socket. The helper only admits HID once capture runs, so
 * the MJPEG endpoint is touched first (one aborted request is enough).
 */
export class ServeSimInput {
  private socket: WebSocket | null = null;
  private admitted: Promise<WebSocket> | null = null;
  private closed = false;
  screen: ScreenConfig | null = null;

  constructor(private readonly endpoint: () => ServeSimEndpoint | null) {}

  private connect(): Promise<WebSocket> {
    this.admitted ??= this.open().catch((e: unknown) => {
      this.admitted = null;
      throw e;
    });

    return this.admitted;
  }

  private async open(): Promise<WebSocket> {
    const ep = this.endpoint();
    if (!ep) {
      throw "This EAS Simulator session is no longer running.";
    }
    await this.prime(ep);
    const url = `${ep.origin.replace(/^http/, "ws")}/helper/ws?device=${enc(ep.udid)}`;
    const ws = easSocket(url, {
      headers: authHeaders(ep.token),
      protocols: [`serve-sim.token.${ep.token}`],
    });
    this.socket = ws;

    return new Promise<WebSocket>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close();
        reject("The EAS Simulator didn't accept input in time.");
      }, 10_000);
      ws.on("message", (data: Buffer) => {
        const bytes = new Uint8Array(data);
        if (bytes[0] === TAG_INPUT_ADMITTED) {
          clearTimeout(timer);
          resolve(ws);

          return;
        }
        if (bytes[0] === TAG_SCREEN_CONFIG) {
          try {
            const c = JSON.parse(
              Buffer.from(bytes.subarray(1)).toString("utf8"),
            ) as Partial<ScreenConfig>;
            if (typeof c.width === "number" && typeof c.height === "number") {
              this.screen = {
                width: c.width,
                height: c.height,
                orientation: String(c.orientation ?? "portrait"),
              };
            }
          } catch {
            // Not a config we understand.
          }
        }
      });
      ws.on("error", () => ws.close());
      ws.on("close", () => {
        clearTimeout(timer);
        if (this.socket === ws) {
          this.socket = null;
          this.admitted = null;
        }
        reject("The EAS Simulator closed its input connection.");
      });
    });
  }

  private async prime(ep: ServeSimEndpoint): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
      const res = await easFetch(
        `${ep.origin}/helper/${enc(ep.udid)}/stream.mjpeg`,
        { headers: authHeaders(ep.token), signal: controller.signal },
      );
      await res.body?.getReader().read();
    } catch {
      // Priming is best effort; WebRTC-locked hosts refuse MJPEG anyway.
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  private async send(tag: number, payload: unknown): Promise<void> {
    if (this.closed) {
      throw "Input for this EAS Simulator was closed.";
    }
    const ws = await this.connect();
    const json = Buffer.from(JSON.stringify(payload), "utf8");
    ws.send(Buffer.concat([Buffer.of(tag), json]));
  }

  touch(x: number, y: number, eventType: number): Promise<void> {
    const type = TOUCH_PHASE[eventType] ?? "end";

    return this.send(MSG_TOUCH, { type, x, y });
  }

  button(button: string): Promise<void> {
    const name = BUTTONS[button];
    if (!name) {
      return Promise.reject(
        `The ${button} button isn't available on EAS Simulator devices.`,
      );
    }

    return this.send(MSG_BUTTON, { button: name });
  }

  key(usage: number, down: boolean): Promise<void> {
    return this.send(MSG_KEY, { type: down ? "down" : "up", usage });
  }

  /** Connect ahead of the first touch, so it isn't delayed. */
  warm(): void {
    this.connect().catch(() => {});
  }

  close(): void {
    this.closed = true;
    this.socket?.close();
    this.socket = null;
    this.admitted = null;
  }
}
