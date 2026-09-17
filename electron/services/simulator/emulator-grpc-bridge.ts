/**
 * EmulatorGrpcBridge — Android emulator mirroring via the emulator's native
 * gRPC EmulatorController API (no scrcpy jar push / app_process).
 *
 * Pipeline:
 *   1. Discover the emulator's gRPC port + auth token
 *   2. streamScreenshot(RGB888) → raw frames (change-driven)
 *   3. Pipe raw frames to ffmpeg (h264_videotoolbox, hardware encode)
 *   4. Parse the H.264 Annex-B output and emit the same IPC events as the
 *      scrcpy backend (android_video_config / android_video_frame)
 *   5. Input via gRPC sendTouch / sendKey — no separate control socket
 *
 * The emulator's streamScreenshot only offers raw (PNG/RGBA/RGB) frames, so we
 * transcode to H.264 on the host to keep the renderer + IPC contract unchanged.
 */

import type { AndroidCaptureBackend } from "./android-backend";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import {
  execFile,
  execFileSync,
  spawn,
  type ChildProcess,
} from "node:child_process";
import { promisify } from "node:util";
import { emitHostEvent } from "@argus/host/bus";
import { log } from "../../../app/lib/logger";
import { resolveAssetPath } from "../tools/assets";
import { discoverEmulatorGrpc } from "./emulator-discovery";
import { ANDROID_TO_EVDEV, BUTTON_TO_KEY } from "./emulator-input";
import { H264AccessUnitParser } from "./h264-parser";

const execFileAsync = promisify(execFile);

const MAX_GRPC_MESSAGE = 64 * 1024 * 1024;

// Minimal typing for the dynamically-loaded gRPC client. Requests/responses are
// plain objects matching emulator_controller.proto.
interface EmulatorClient {
  getStatus: (
    req: unknown,
    meta: grpc.Metadata,
    opts: grpc.CallOptions,
    cb: (err: grpc.ServiceError | null, res: unknown) => void,
  ) => void;
  sendTouch: (
    req: unknown,
    meta: grpc.Metadata,
    cb: (err: grpc.ServiceError | null) => void,
  ) => void;
  sendKey: (
    req: unknown,
    meta: grpc.Metadata,
    cb: (err: grpc.ServiceError | null) => void,
  ) => void;
  streamScreenshot: (
    req: unknown,
    meta: grpc.Metadata,
  ) => grpc.ClientReadableStream<EmulatorImage>;
  close: () => void;
}

interface EmulatorImage {
  format?: { width?: number; height?: number };
  image?: Buffer;
}

let cachedFfmpeg: string | null = null;

/** Resolve the ffmpeg binary (env override → PATH). */
function findFfmpeg(): string {
  if (cachedFfmpeg) {
    return cachedFfmpeg;
  }
  const override = process.env.ARGUS_FFMPEG_PATH;
  if (override) {
    cachedFfmpeg = override;

    return override;
  }
  try {
    cachedFfmpeg = execFileSync("which", ["ffmpeg"]).toString().trim();
  } catch {
    throw "ffmpeg not found. Install it (brew install ffmpeg) or set ARGUS_FFMPEG_PATH.";
  }

  return cachedFfmpeg;
}

export interface EmulatorGrpcBridgeOptions {
  serial: string;
  adbPath: string;
  /** Maximum video dimension (default 1280). */
  maxSize?: number;
  /** Video bitrate in bps (default 6000000). */
  bitRate?: number;
}

export class EmulatorGrpcBridge implements AndroidCaptureBackend {
  private serial: string;
  private adbPath: string;
  private maxSize: number;
  private bitRate: number;

  private client: EmulatorClient | null = null;
  private meta = new grpc.Metadata();
  private screenStream: grpc.ClientReadableStream<EmulatorImage> | null = null;
  private ffmpeg: ChildProcess | null = null;
  private ffmpegWritable = true;
  private h264Parser: H264AccessUnitParser | null = null;

  // Idle keep-alive: the emulator only streams screenshots when the display
  // changes, so a static screen sends one frame then nothing. A single frame
  // never primes the encoder (no H.264 out → decoder never configures). We
  // cache the last raw frame and re-push it on a timer so the encoder keeps
  // producing output (and its first keyframe) even when the screen is idle.
  private lastFrame: Buffer | null = null;
  private lastWriteAt = 0;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  // Encoder input dimensions (raw frame size). ffmpeg is restarted if these
  // change (e.g. device rotation).
  private frameWidth = 0;
  private frameHeight = 0;

  // Device resolution for touch coordinate mapping.
  private deviceWidth = 0;
  private deviceHeight = 0;

  constructor(opts: EmulatorGrpcBridgeOptions) {
    this.serial = opts.serial;
    this.adbPath = opts.adbPath;
    this.maxSize = opts.maxSize ?? 1280;
    this.bitRate = opts.bitRate ?? 6_000_000;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    const endpoint = discoverEmulatorGrpc(this.serial);
    if (!endpoint) {
      throw `No emulator gRPC endpoint found for ${this.serial}`;
    }
    if (endpoint.token) {
      this.meta.set("authorization", `Bearer ${endpoint.token}`);
    }

    this.client = this.createClient(endpoint.port);

    // Confirm the emulator is reachable + booted before streaming.
    await this.getStatus();

    // Real device resolution for touch mapping (full res, unscaled).
    await this.queryDeviceResolution();

    this.startVideoPipeline();
  }

  sendTouch(_action: number, x: number, y: number, pressure: number): void {
    if (!this.client) {
      return;
    }
    const px = Math.round(x * this.deviceWidth);
    const py = Math.round(y * this.deviceHeight);
    this.client.sendTouch(
      {
        touches: [
          { x: px, y: py, identifier: 0, pressure: pressure > 0 ? 1 : 0 },
        ],
      },
      this.meta,
      () => {},
    );
  }

  sendKey(action: number, keyCode: number, _metaState: number): void {
    if (!this.client) {
      return;
    }
    const evdev = ANDROID_TO_EVDEV[keyCode];
    if (evdev === undefined) {
      return;
    }
    this.client.sendKey(
      {
        codeType: "Evdev",
        eventType: action === 0 ? "keydown" : "keyup",
        keyCode: evdev,
      },
      this.meta,
      () => {},
    );
  }

  sendButton(button: string): Promise<void> {
    const key = BUTTON_TO_KEY[button];
    if (!key || !this.client) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      this.client!.sendKey(
        { codeType: "Evdev", eventType: "keypress", key },
        this.meta,
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }

  kill(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    this.lastFrame = null;

    this.screenStream?.cancel();
    this.screenStream = null;

    this.ffmpeg?.stdin?.end();
    this.ffmpeg?.kill();
    this.ffmpeg = null;

    this.h264Parser?.reset();
    this.h264Parser = null;

    this.client?.close();
    this.client = null;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private createClient(port: number): EmulatorClient {
    const protoPath = resolveAssetPath("emulator_controller.proto");
    const def = protoLoader.loadSync(protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const pkg = grpc.loadPackageDefinition(def) as unknown as {
      android: {
        emulation: {
          control: {
            EmulatorController: new (
              addr: string,
              creds: grpc.ChannelCredentials,
              opts: object,
            ) => EmulatorClient;
          };
        };
      };
    };

    return new pkg.android.emulation.control.EmulatorController(
      `localhost:${String(port)}`,
      grpc.credentials.createInsecure(),
      { "grpc.max_receive_message_length": MAX_GRPC_MESSAGE },
    );
  }

  private getStatus(): Promise<void> {
    return new Promise((resolve, reject) => {
      const deadline = new Date(Date.now() + 5000);
      this.client!.getStatus({}, this.meta, { deadline }, (err) =>
        err ? reject(err) : resolve(),
      );
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
    // Prefer "Override size" (current) over "Physical size" if both present.
    const match =
      /Override size:\s*(\d+)x(\d+)/.exec(stdout) ??
      /Physical size:\s*(\d+)x(\d+)/.exec(stdout);
    if (!match) {
      throw `Failed to parse device resolution from: ${stdout.trim()}`;
    }
    this.deviceWidth = parseInt(match[1], 10);
    this.deviceHeight = parseInt(match[2], 10);
  }

  private startVideoPipeline(): void {
    // Broadcast to every live window (not a captured main-window ref) so the
    // stream survives HMR renderer reloads and reaches popouts — matching the
    // iOS video path. A stale captured webContents silently drops all frames.
    this.h264Parser = new H264AccessUnitParser({
      onConfig: (config) => {
        log(
          `[EmulatorGrpc] H.264 config: ${config.codec}, ${String(config.codedWidth)}x${String(config.codedHeight)}`,
        );
        emitHostEvent(`android_video_config:${this.serial}`, config);
      },
      onFrame: (data, keyFrame, timestamp) => {
        emitHostEvent(`android_video_frame:${this.serial}`, {
          data,
          keyFrame,
          timestamp,
        });
      },
    });

    // Request a bounding box; the emulator scales to fit maintaining aspect.
    const req = {
      format: "RGB888",
      width: this.maxSize,
      height: this.maxSize,
    };
    this.screenStream = this.client!.streamScreenshot(req, this.meta);

    this.screenStream.on("data", (img: EmulatorImage) => {
      const w = img.format?.width ?? 0;
      const h = img.format?.height ?? 0;
      const buf = img.image;
      if (!w || !h || !buf || buf.length === 0) {
        return;
      }
      if (w !== this.frameWidth || h !== this.frameHeight) {
        this.restartEncoder(w, h);
      }
      this.lastFrame = buf;
      this.writeFrame(buf);
    });

    this.screenStream.on("error", (err: grpc.ServiceError) => {
      if (err.code !== grpc.status.CANCELLED) {
        log(`[EmulatorGrpc] screenshot stream error: ${err.message}`);
      }
    });

    // Re-push the last frame when the real stream goes quiet (~6fps floor) so
    // an idle emulator keeps the encoder producing frames + keyframes.
    this.keepAliveTimer = setInterval(() => {
      if (this.lastFrame && Date.now() - this.lastWriteAt >= 150) {
        this.writeFrame(this.lastFrame);
      }
    }, 200);
    this.keepAliveTimer.unref?.();
  }

  /** Write a raw frame to ffmpeg, honoring stdin backpressure. Records the
   *  write time so the idle keep-alive only fires when the stream is quiet. */
  private writeFrame(buf: Buffer): void {
    if (this.ffmpeg?.stdin?.writable && this.ffmpegWritable) {
      this.ffmpegWritable = this.ffmpeg.stdin.write(buf);
      this.lastWriteAt = Date.now();
    }
  }

  /** (Re)spawn ffmpeg for the given raw frame dimensions. */
  private restartEncoder(width: number, height: number): void {
    this.frameWidth = width;
    this.frameHeight = height;

    this.ffmpeg?.stdin?.end();
    this.ffmpeg?.kill();
    this.h264Parser?.reset();

    const ffmpegPath = findFfmpeg();
    // rawvideo rgb24 in → hardware H.264 (Annex-B) out. Force even dimensions
    // (H.264 requires them); realtime + short GOP keep latency low.
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-fflags",
      "nobuffer",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-s",
      `${String(width)}x${String(height)}`,
      "-r",
      "30",
      "-i",
      "-",
      "-an",
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v",
      "h264_videotoolbox",
      "-realtime",
      "1",
      "-prio_speed",
      "1",
      "-g",
      "120",
      "-b:v",
      String(this.bitRate),
      "-f",
      "h264",
      "-",
    ];

    this.ffmpeg = spawn(ffmpegPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.ffmpegWritable = true;

    this.ffmpeg.stdin?.on("drain", () => {
      this.ffmpegWritable = true;
    });
    this.ffmpeg.stdin?.on("error", () => {
      // Encoder gone — ignore stray write errors during teardown/restart.
    });
    this.ffmpeg.stdout?.on("data", (chunk: Buffer) => {
      this.h264Parser?.push(chunk);
    });
    this.ffmpeg.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(`[ffmpeg] ${data.toString()}`);
    });

    log(
      `[EmulatorGrpc] ffmpeg encoder started for ${String(width)}x${String(height)}`,
    );
  }
}
