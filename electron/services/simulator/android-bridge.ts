/**
 * AndroidBridge — manages scrcpy-server lifecycle and the scrcpy control
 * protocol for Android device mirroring.
 *
 * Architecture:
 *   1. Push scrcpy-server.jar to device via adb
 *   2. Start the server via `adb shell app_process`
 *   3. Connect to video socket (H.264 stream) and control socket (binary input)
 *   4. Parse H.264 NAL units and send frames to renderer via IPC events
 *   5. Send touch/key events via the scrcpy binary control protocol
 */

import { app } from "electron";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import * as net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { log } from "../../../app/lib/logger";
import { getMainWindow } from "../../main";
import { H264AccessUnitParser } from "./h264-parser";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// scrcpy-server jar path resolution
// ---------------------------------------------------------------------------

const JAR_NAME = "scrcpy-server.jar";

function scrcpyServerPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, JAR_NAME);
  }

  return path.join(process.cwd(), "native", "scrcpy-server", JAR_NAME);
}

// ---------------------------------------------------------------------------
// scrcpy control protocol — binary message builders
// ---------------------------------------------------------------------------

/** Inject a keycode event (type 0). */
function buildKeyMessage(
  action: number,
  keycode: number,
  repeat: number,
  metaState: number,
): Buffer {
  const buf = Buffer.alloc(14);
  buf.writeUInt8(0, 0); // type = inject keycode
  buf.writeUInt8(action, 1); // 0 = ACTION_DOWN, 1 = ACTION_UP
  buf.writeUInt32BE(keycode, 2);
  buf.writeUInt32BE(repeat, 6);
  buf.writeUInt32BE(metaState, 10);

  return buf;
}

/** Inject a touch event (type 2). */
function buildTouchMessage(
  action: number,
  pointerId: bigint,
  x: number,
  y: number,
  width: number,
  height: number,
  pressure: number,
): Buffer {
  const buf = Buffer.alloc(32);
  buf.writeUInt8(2, 0); // type = inject touch
  buf.writeUInt8(action, 1);
  buf.writeBigUInt64BE(pointerId, 2);
  buf.writeInt32BE(x, 10);
  buf.writeInt32BE(y, 14);
  buf.writeUInt16BE(width, 18);
  buf.writeUInt16BE(height, 20);
  buf.writeUInt16BE(pressure === 0 ? 0 : 0xffff, 22); // normalized pressure
  buf.writeInt32BE(1, 24); // actionButton (primary)
  buf.writeInt32BE(action === 0 ? 1 : 0, 28); // buttons (pressed on DOWN)

  return buf;
}

/** Back-or-screen-on event (type 4). */
function buildBackOrScreenOnMessage(action: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt8(4, 0); // type = back or screen on
  buf.writeUInt8(action, 1);

  return buf;
}

// ---------------------------------------------------------------------------
// AndroidBridge
// ---------------------------------------------------------------------------

export interface AndroidBridgeOptions {
  serial: string;
  adbPath: string;
  /** Maximum video dimension (default 1280). */
  maxSize?: number;
  /** Video bitrate in bps (default 4000000). */
  bitRate?: number;
}

const SCRCPY_VERSION = "3.1";

export class AndroidBridge {
  static instance: AndroidBridge | null = null;

  private serial: string;
  private adbPath: string;
  private maxSize: number;
  private bitRate: number;

  private serverProc: ChildProcess | null = null;
  private videoSocket: net.Socket | null = null;
  private controlSocket: net.Socket | null = null;
  private h264Parser: H264AccessUnitParser | null = null;
  private localPort: number | null = null;
  private deviceWidth = 0;
  private deviceHeight = 0;

  constructor(opts: AndroidBridgeOptions) {
    this.serial = opts.serial;
    this.adbPath = opts.adbPath;
    this.maxSize = opts.maxSize ?? 1280;
    this.bitRate = opts.bitRate ?? 4_000_000;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Start the full capture pipeline:
   *   push jar → start server → connect sockets → H.264 parser → IPC events
   */
  async start(): Promise<void> {
    await this.pushServer();

    // Query the real device resolution before starting the server so we have
    // correct dimensions for touch coordinate mapping.
    await this.queryDeviceResolution();

    this.localPort = await this.findFreePort();
    await this.setupForward();
    await this.startServer();

    // scrcpy-server opens two sequential connections on the same port:
    // first is the video socket, second is the control socket
    this.videoSocket = await this.connectSocket();
    this.controlSocket = await this.connectSocket();

    // Parse H.264 from the video socket and send frames to renderer via IPC.
    // The first 64 bytes are the device name header — stripped inline.
    this.startVideoPipeline();
  }

  /** Send a touch event via the scrcpy control protocol. */
  sendTouch(action: number, x: number, y: number, pressure: number): void {
    if (!this.controlSocket) {
      return;
    }

    // Convert normalized [0, 1] coordinates to device pixels
    const px = Math.round(x * this.deviceWidth);
    const py = Math.round(y * this.deviceHeight);

    const msg = buildTouchMessage(
      action,
      0n, // pointerId
      px,
      py,
      this.deviceWidth,
      this.deviceHeight,
      pressure,
    );
    this.controlSocket.write(msg);
  }

  /** Send a key event via the scrcpy control protocol. */
  sendKey(action: number, keycode: number, metaState: number): void {
    if (!this.controlSocket) {
      return;
    }
    const msg = buildKeyMessage(action, keycode, 0, metaState);
    this.controlSocket.write(msg);
  }

  /** Send back-or-screen-on event. */
  sendBackOrScreenOn(action: number): void {
    if (!this.controlSocket) {
      return;
    }
    const msg = buildBackOrScreenOnMessage(action);
    this.controlSocket.write(msg);
  }

  /** Tear everything down. */
  kill(): void {
    this.h264Parser?.reset();
    this.h264Parser = null;

    // Close sockets
    this.videoSocket?.destroy();
    this.videoSocket = null;
    this.controlSocket?.destroy();
    this.controlSocket = null;

    // Kill server process
    this.serverProc?.kill();
    this.serverProc = null;

    // Remove adb port forwarding (best-effort)
    if (this.localPort) {
      execFile(
        this.adbPath,
        [
          "-s",
          this.serial,
          "forward",
          "--remove",
          `tcp:${String(this.localPort)}`,
        ],
        () => {},
      );
      this.localPort = null;
    }

    if (AndroidBridge.instance === this) {
      AndroidBridge.instance = null;
    }
  }

  // -------------------------------------------------------------------------
  // Private — server lifecycle
  // -------------------------------------------------------------------------

  private async pushServer(): Promise<void> {
    const jarPath = scrcpyServerPath();
    await execFileAsync(this.adbPath, [
      "-s",
      this.serial,
      "push",
      jarPath,
      "/data/local/tmp/scrcpy-server.jar",
    ]);
  }

  private async setupForward(): Promise<void> {
    await execFileAsync(this.adbPath, [
      "-s",
      this.serial,
      "forward",
      `tcp:${String(this.localPort)}`,
      "localabstract:scrcpy",
    ]);
  }

  private async startServer(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const args = [
        "-s",
        this.serial,
        "shell",
        `CLASSPATH=/data/local/tmp/scrcpy-server.jar`,
        "app_process",
        "/",
        "com.genymobile.scrcpy.Server",
        SCRCPY_VERSION,
        "tunnel_forward=true",
        "video=true",
        "audio=false",
        "control=true",
        `max_size=${String(this.maxSize)}`,
        `video_bit_rate=${String(this.bitRate)}`,
        "send_frame_meta=false",
        "video_codec=h264",
        // Force the encoder to re-emit frames even when the screen is static.
        // Without this, MediaCodec produces nothing until pixels change.
        "video_codec_options=repeat-previous-frame-after=20000",
      ];

      this.serverProc = spawn(this.adbPath, args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let resolved = false;

      // The server prints to stderr when ready. We wait for the first
      // output line or a short timeout, then attempt to connect.
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      }, 2000);

      this.serverProc.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        process.stderr.write(`[scrcpy-server] ${text}`);
        if (!resolved && text.includes("INFO")) {
          resolved = true;
          clearTimeout(timer);
          resolve();
        }
      });

      this.serverProc.stdout?.on("data", (data: Buffer) => {
        process.stderr.write(`[scrcpy-server stdout] ${data.toString()}`);
      });

      this.serverProc.on("error", (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          reject(err);
        }
      });

      this.serverProc.on("close", (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          reject(new Error(`scrcpy-server exited with code ${String(code)}`));
        }
      });
    });
  }

  // -------------------------------------------------------------------------
  // Private — socket connection
  // -------------------------------------------------------------------------

  private connectSocket(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const tryConnect = (attempts: number) => {
        const sock = net.connect(this.localPort!, "127.0.0.1", () => {
          resolve(sock);
        });
        sock.on("error", (err) => {
          if (attempts > 0) {
            setTimeout(() => tryConnect(attempts - 1), 100);
          } else {
            reject(err);
          }
        });
      };
      tryConnect(30); // retry for up to 3 seconds
    });
  }

  private async queryDeviceResolution(): Promise<void> {
    const { stdout } = await execFileAsync(this.adbPath, [
      "-s",
      this.serial,
      "shell",
      "wm",
      "size",
    ]);
    // Output format: "Physical size: 1080x1920\n" (may also include "Override size: …")
    const match = stdout.match(/Physical size:\s*(\d+)x(\d+)/);
    if (!match) {
      throw new Error(
        `Failed to parse device resolution from: ${stdout.trim()}`,
      );
    }
    let w = parseInt(match[1], 10);
    let h = parseInt(match[2], 10);

    // scrcpy scales the video so the largest dimension equals maxSize.
    // Apply the same scaling so touch coordinates map correctly.
    const maxDim = Math.max(w, h);
    if (maxDim > this.maxSize) {
      const scale = this.maxSize / maxDim;
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    this.deviceWidth = w;
    this.deviceHeight = h;
  }

  // -------------------------------------------------------------------------
  // Private — video pipeline
  // -------------------------------------------------------------------------

  /**
   * Sets up a single continuous data listener on the video socket. The first
   * 64 bytes (scrcpy device name header) are stripped inline, then all H.264
   * data is fed to the NAL parser which emits config + frame IPC events.
   */
  private startVideoPipeline(): void {
    const HEADER_SIZE = 64;
    const win = getMainWindow();

    let headerBuf = Buffer.alloc(0);
    let headerParsed = false;

    this.h264Parser = new H264AccessUnitParser({
      onConfig: (config) => {
        log(
          `[AndroidBridge] H.264 config: ${config.codec}, ${String(config.codedWidth)}x${String(config.codedHeight)}`,
        );
        win?.webContents.send("android_video_config", config);
      },
      onFrame: (data, keyFrame, timestamp) => {
        win?.webContents.send("android_video_frame", {
          data,
          keyFrame,
          timestamp,
        });
      },
    });

    this.videoSocket!.on("data", (chunk: Buffer) => {
      if (!headerParsed) {
        headerBuf = Buffer.concat([headerBuf, chunk]);
        if (headerBuf.length < HEADER_SIZE) {
          return;
        }

        headerParsed = true;
        const nameEnd = headerBuf.indexOf(0);
        const deviceName = headerBuf
          .subarray(0, nameEnd > 0 ? nameEnd : HEADER_SIZE)
          .toString("utf-8");
        log(
          `[AndroidBridge] Device: ${deviceName}, resolution: ${String(this.deviceWidth)}x${String(this.deviceHeight)}`,
        );

        // Everything after the header is H.264
        const overflow = headerBuf.subarray(HEADER_SIZE);
        if (overflow.length > 0) {
          this.h264Parser?.push(overflow);
        }
        headerBuf = Buffer.alloc(0);

        return;
      }

      this.h264Parser?.push(chunk);
    });

    this.videoSocket!.on("end", () => {
      log("[AndroidBridge] Video socket ended");
    });
  }

  // -------------------------------------------------------------------------
  // Private — helpers
  // -------------------------------------------------------------------------

  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const port = (srv.address() as net.AddressInfo).port;
        srv.close(() => resolve(port));
      });
      srv.on("error", reject);
    });
  }
}
