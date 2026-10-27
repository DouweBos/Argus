/**
 * EAS Simulator hosts as device sources: `eas:<hostId>:<slot>` ids, opened by
 * starting a billed session and closed by stopping it. No shell reaches the
 * simulator, so simctl- and conductor-backed capabilities are off.
 */

import type { EasHost } from "./host";
import type {
  DeviceCapability,
  DeviceInput,
  DeviceSession,
  DeviceSource,
  DeviceSourceProvider,
  SimulatorDevice,
  VideoSource,
} from "../../simulator/deviceSource";
import type { DisplayInfo } from "../../simulator/deviceState";
import { NO_CAPS } from "../../simulator/deviceSource";
import { EasError } from "./credential";
import { EAS_ID_PREFIX, parseEasDeviceId } from "./ids";
import { openServeSimVideo } from "./serveSim";
import { type ScreenConfig, ServeSimInput } from "./serveSimInput";

/** How long listing waits on housekeeping (a status check with Expo) before answering. */
const MAINTAIN_WAIT_MS = 1_000;

/** A user-facing string from whatever an EAS operation threw. */
export function easMessage(e: unknown): string {
  if (e instanceof EasError) {
    return e.message;
  }

  return typeof e === "string" ? e : String(e);
}

let captureHandles = 0;

/**
 * serve-sim streams the raw, panel-native framebuffer, so a UI turned
 * sideways arrives sideways: the clockwise turn a viewer applies to sit it
 * upright. A screen reported landscape-shaped is already upright.
 */
export function rotationFor(
  screen: ScreenConfig | null,
): DisplayInfo["rotation"] {
  if (!screen || screen.width > screen.height) {
    return 0;
  }
  switch (screen.orientation) {
    case "landscape_left":
      return 90;
    case "landscape_right":
      return 270;
    case "portrait_upside_down":
      return 180;
    default:
      return 0;
  }
}

/** One capture of a running session: serve-sim's video and input. */
class EasDeviceSession implements DeviceSession {
  private readonly input_: ServeSimInput;
  private size: { width: number; height: number } | null = null;
  private stopped = false;

  constructor(
    private readonly host: EasHost,
    private readonly slot: number,
  ) {
    this.input_ = new ServeSimInput(() => this.host.endpoint(this.slot));
  }

  start(): Promise<number> {
    if (!this.host.isRunning(this.slot)) {
      return Promise.reject("This EAS Simulator session isn't running.");
    }
    this.input_.warm();
    captureHandles += 1;

    return Promise.resolve(captureHandles);
  }

  isAlive(): boolean {
    return !this.stopped && this.host.isRunning(this.slot);
  }

  readonly video: VideoSource = {
    open: (sink) =>
      openServeSimVideo(
        () => this.host.endpoint(this.slot),
        sink,
        (width, height) => {
          this.size = { width, height };
        },
      ),
  };

  readonly adaptiveVideo = null;

  readonly input: DeviceInput = {
    touch: (x, y, eventType) => this.input_.touch(x, y, eventType),
    button: (button) => this.input_.button(button),
    key: (usage, down) => this.input_.key(usage, down),
  };

  displayInfo(): Promise<DisplayInfo | null> {
    const size = this.size ?? this.input_.screen;

    return Promise.resolve(
      size
        ? {
            width: size.width,
            height: size.height,
            rotation: rotationFor(this.input_.screen),
            screenID: 0,
          }
        : null,
    );
  }

  refreshDisplay(): Promise<void> {
    return Promise.resolve();
  }

  stop(): void {
    this.stopped = true;
    this.input_.close();
  }
}

export class EasDeviceSource implements DeviceSource {
  constructor(private readonly host: EasHost) {}

  get id(): string {
    return this.host.id;
  }

  private slotOf(id: string): number {
    const parsed = parseEasDeviceId(id);
    if (parsed?.hostId !== this.host.id) {
      throw `No EAS Simulator device ${id}.`;
    }

    return parsed.slot;
  }

  async list(): Promise<SimulatorDevice[]> {
    await Promise.race([
      this.host.maintain().catch(() => {}),
      new Promise((r) => setTimeout(r, MAINTAIN_WAIT_MS).unref?.()),
    ]);

    return this.host.listDevices();
  }

  find(id: string): Promise<SimulatorDevice | undefined> {
    return Promise.resolve(
      this.host.listDevices().find((d) => d.udid === id) ??
        // An id from a stale listing still names a slot that can start.
        (parseEasDeviceId(id)?.hostId === this.host.id
          ? {
              udid: id,
              name: `iPhone (EAS ${String(this.slotOf(id))})`,
              runtime: "EAS Simulator",
              booted: false,
              deviceHostId: this.host.id,
              deviceHostLabel: this.host.config.label,
            }
          : undefined),
    );
  }

  /** Starts a billed session; can take minutes. */
  async open(id: string): Promise<void> {
    try {
      await this.host.open(this.slotOf(id));
    } catch (e) {
      throw easMessage(e);
    }
  }

  async close(id: string): Promise<void> {
    try {
      await this.host.close(this.slotOf(id), "closed");
    } catch (e) {
      throw `Couldn't stop the EAS Simulator session; Argus keeps retrying. ${easMessage(e)}`;
    }
  }

  erase(): Promise<void> {
    return Promise.reject(this.unsupported("erase"));
  }

  delete(): Promise<void> {
    return Promise.reject(this.unsupported("delete"));
  }

  session(id: string): DeviceSession {
    return new EasDeviceSession(this.host, this.slotOf(id));
  }

  capabilities() {
    return NO_CAPS;
  }

  unsupported(capability: DeviceCapability): string {
    switch (capability) {
      case "erase":
      case "delete":
        return "EAS Simulator devices exist only while their session runs; closing one ends it.";
      default:
        return "EAS Simulator devices can't run host commands, so this isn't available for them.";
    }
  }
}

/** Claims `eas:` ids for the EAS hosts `hosts()` knows. */
export function easDeviceProvider(deps: {
  host: (hostId: string) => EasHost | undefined;
  hosts: () => EasHost[];
  onRemoved: (listener: (hostId: string) => void) => () => void;
}): DeviceSourceProvider {
  const sources = new WeakMap<EasHost, EasDeviceSource>();
  const sourceFor = (host: EasHost) => {
    let source = sources.get(host);
    if (!source) {
      source = new EasDeviceSource(host);
      sources.set(host, source);
    }

    return source;
  };

  return {
    sourceIdOf: (deviceId) =>
      deviceId.startsWith(EAS_ID_PREFIX)
        ? (parseEasDeviceId(deviceId)?.hostId ?? "eas")
        : null,
    resolve: (sourceId) => {
      const host = deps.host(sourceId);
      if (!host) {
        throw "That device's EAS Simulator host was removed from Settings → Tools → Device hosts.";
      }

      return sourceFor(host);
    },
    listable: () => deps.hosts().map(sourceFor),
    onGone: deps.onRemoved,
  };
}
