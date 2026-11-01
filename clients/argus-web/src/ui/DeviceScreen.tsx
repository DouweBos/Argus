/**
 * Live device screen: subscribes to a device's H.264 stream (devices.watch),
 * decodes it to a canvas with WebCodecs, and forwards pointer/keyboard/button
 * input back (devices.touch/keyboard/button) for control-granted devices.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppleTVRemote,
  Banner,
  Button,
  DeviceClaimBar,
  DeviceControlOverlay,
  DeviceStage,
  Icons,
} from "@argus/peacock";
import { H264CanvasDecoder } from "@argus/remote-client";
import { toNativeKey } from "../lib/keymap";
import type { RemoteDeviceOrientation, RemotePlatform } from "../lib/protocol";
import { useConnectionStore } from "../stores/connection";
import { useDevicesStore } from "../stores/devices";

const PLACEHOLDER: Record<string, string> = {
  connecting: "Connecting to device…",
  error: "Couldn't start the stream. Is the device still booted?",
  novideo: "No video from this device — it's booted but not producing a stream.",
};

/** Hardware buttons per platform (name → bridge button + label). `ios_home` is
 *  the real Home-button HID path; plain "home" would misfire as a key chord. */
const IOS_BUTTONS = [
  { button: "ios_home", label: "Home", icon: <Icons.HomeIcon size={16} /> },
];
const ANDROID_BUTTONS = [
  { button: "back", label: "Back", icon: <Icons.AndroidBackIcon size={16} /> },
  { button: "home", label: "Home", icon: <Icons.AndroidHomeIcon size={16} /> },
  {
    button: "recents",
    label: "Recents",
    icon: <Icons.AndroidRecentsIcon size={16} />,
  },
];
/** A swipe shorter than this (px) counts as a tap → dpad select. */
const TV_SWIPE_THRESHOLD = 24;

/** The "back" affordance differs per TV platform: tvOS Menu vs Android Back. */
function tvBackButton(platform: RemotePlatform): string {
  return platform === "ios" ? "menu" : "back";
}

/** Extra hardware buttons shown for a TV, per platform. */
function tvButtons(platform: RemotePlatform) {
  return [
    {
      button: tvBackButton(platform),
      label: platform === "ios" ? "Menu" : "Back",
      icon: <Icons.ArrowBackIcon size={16} />,
    },
    { button: "home", label: "Home", icon: <Icons.HomeIcon size={16} /> },
  ];
}

/** Map a keyboard code to a dpad button ("back" is translated per platform). */
function codeToTvButton(code: string): string | null {
  switch (code) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "Enter":
    case "Space":
      return "select";
    case "Escape":
    case "Backspace":
      return "back";
    default:
      return null;
  }
}

export function DeviceScreen({
  deviceId,
  platform,
  isTv,
}: {
  deviceId: string;
  platform: RemotePlatform;
  isTv: boolean;
}) {
  const connection = useConnectionStore((s) => s.connection);
  const hasControl = useConnectionStore((s) => s.hasControl());
  const watchDevice = useDevicesStore((s) => s.watchDevice);
  const unwatchDevice = useDevicesStore((s) => s.unwatchDevice);
  const registerMediaSink = useDevicesStore((s) => s.registerMediaSink);
  const deviceTouch = useDevicesStore((s) => s.deviceTouch);
  const deviceButton = useDevicesStore((s) => s.deviceButton);
  const deviceKeyboard = useDevicesStore((s) => s.deviceKeyboard);
  const holder = useDevicesStore((s) => s.claimByDevice[deviceId] ?? null);
  const loadDeviceState = useDevicesStore((s) => s.loadDeviceState);
  const setDeviceOrientation = useDevicesStore((s) => s.setDeviceOrientation);
  const setDeviceFold = useDevicesStore((s) => s.setDeviceFold);
  const deviceState = useDevicesStore((s) => s.deviceStateById[deviceId] ?? null);
  // The framebuffer is panel-native, so a device held sideways streams
  // sideways — present it the way it is actually being held.
  const rotation = deviceState?.display?.rotation ?? 0;
  const fold = deviceState?.fold ?? null;
  const claimConnectionId = useDevicesStore((s) => s.claimConnectionId);
  const loadClaim = useDevicesStore((s) => s.loadClaim);
  const claimDevice = useDevicesStore((s) => s.claimDevice);
  const releaseDevice = useDevicesStore((s) => s.releaseDevice);
  // Someone else is driving: their input wins until we take over, so say so
  // rather than letting taps be refused silently.
  const blocked = holder !== null && holder.connection_id !== claimConnectionId;
  const driving = holder !== null && holder.connection_id === claimConnectionId;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const decoderRef = useRef<H264CanvasDecoder | null>(null);
  // Rendered dimensions drive the stage's fit and its touch mapping, so they
  // are state rather than a ref.
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const [status, setStatus] = useState<
    "connecting" | "streaming" | "error" | "novideo"
  >("connecting");
  const supported = H264CanvasDecoder.supported;

  // No video within this window → the device is booted but not producing a
  // decodable stream (e.g. a capture the desktop can't encode). Surface it
  // instead of spinning forever.
  const NO_VIDEO_TIMEOUT_MS = 10_000;

  // Subscribe to the stream while connected; tear down on unmount / disconnect.
  useEffect(() => {
    if (!supported || connection !== "ready") {
      return;
    }
    let cancelled = false;
    let unregister: (() => void) | null = null;
    setStatus("connecting");
    const watchdog = setTimeout(() => {
      if (!cancelled) {
        setStatus((s) => (s === "connecting" ? "novideo" : s));
      }
    }, NO_VIDEO_TIMEOUT_MS);

    const decoder = new H264CanvasDecoder({
      onDimensions: (width, height) => setDims({ width, height }),
      onFirstFrame: () => setStatus("streaming"),
    });
    decoder.attachCanvas(canvasRef.current);
    decoderRef.current = decoder;

    watchDevice(deviceId, platform)
      .then((streamId) => {
        if (cancelled) {
          unwatchDevice(deviceId).catch(() => {});

          return;
        }
        unregister = registerMediaSink(streamId, (msg) => {
          if (msg.kind === "config") {
            decoder.configure(
              msg.codec,
              msg.codedWidth,
              msg.codedHeight,
              msg.description,
            );
          } else if (msg.kind === "frame") {
            decoder.decode(msg.data, msg.keyFrame, msg.timestamp);
          }
        });
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(watchdog);
      unregister?.();
      decoder.close();
      decoderRef.current = null;
      unwatchDevice(deviceId).catch(() => {});
    };
  }, [
    deviceId,
    platform,
    connection,
    supported,
    watchDevice,
    unwatchDevice,
    registerMediaSink,
  ]);

  // Seed the pose; the host pushes `device.state` from here on while we watch.
  useEffect(() => {
    if (connection !== "ready") {
      return;
    }
    loadDeviceState(deviceId, platform).catch(() => {});
  }, [connection, deviceId, platform, loadDeviceState]);

  // Who holds input, seeded before the first tap and released on the way out —
  // a client that walks away must not leave the device locked to it.
  useEffect(() => {
    if (connection !== "ready" || !hasControl) {
      return;
    }
    loadClaim(deviceId).catch(() => {});

    return () => releaseDevice(deviceId);
  }, [connection, hasControl, deviceId, loadClaim, releaseDevice]);

  // --- Touch: DeviceStage hands us normalized, un-rotated coordinates ---
  const onTouch = useCallback(
    (x: number, y: number, eventType: number) => {
      if (!hasControl || blocked) {
        return;
      }
      deviceTouch(deviceId, platform, x, y, eventType as 0 | 1 | 2);
    },
    [hasControl, blocked, deviceTouch, deviceId, platform],
  );

  // Rotating and folding are control, arbitrated by the same claim as a tap.
  const onRotate = useCallback(() => {
    const order: RemoteDeviceOrientation[] = [
      "portrait",
      "landscapeLeft",
      "portraitUpsideDown",
      "landscapeRight",
    ];
    const current = deviceState?.orientation ?? "portrait";
    const next = order[(order.indexOf(current) + 1) % order.length]!;
    setDeviceOrientation(deviceId, platform, next).catch(() => {});
  }, [deviceState, setDeviceOrientation, deviceId, platform]);

  const onFold = useCallback(() => {
    if (!fold) {
      return;
    }
    setDeviceFold(
      deviceId,
      platform,
      fold.pose === "open" ? "closed" : "open",
    ).catch(() => {});
  }, [fold, setDeviceFold, deviceId, platform]);

  // --- tvOS: pointer → dpad. A tap is Select; a drag is a directional swipe. ---
  const tvStart = useRef<{ x: number; y: number } | null>(null);

  const onTvPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!hasControl || blocked) {
        return;
      }
      tvStart.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [hasControl, blocked],
  );

  const onTvPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = tvStart.current;
      tvStart.current = null;
      if (!start || !hasControl) {
        return;
      }
      e.currentTarget.releasePointerCapture(e.pointerId);
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      let button: string;
      if (adx < TV_SWIPE_THRESHOLD && ady < TV_SWIPE_THRESHOLD) {
        button = "select";
      } else if (adx > ady) {
        button = dx > 0 ? "right" : "left";
      } else {
        button = dy > 0 ? "down" : "up";
      }
      deviceButton(deviceId, platform, button).catch(() => {});
    },
    [hasControl, deviceButton, deviceId, platform],
  );

  const onRemotePress = useCallback(
    (button: string) => {
      deviceButton(deviceId, platform, button).catch(() => {});
    },
    [deviceButton, deviceId, platform],
  );

  const onKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, isDown: boolean) => {
      if (!hasControl || blocked) {
        return;
      }
      // tvOS is driven by discrete remote presses, so fire on key-down only.
      if (isTv) {
        const tvButton = codeToTvButton(e.code);
        if (tvButton) {
          e.preventDefault();
          if (isDown) {
            const btn = tvButton === "back" ? tvBackButton(platform) : tvButton;
            deviceButton(deviceId, platform, btn).catch(() => {});
          }
        }

        return;
      }
      const native = toNativeKey(platform, e.code, e.shiftKey);
      if (!native) {
        return;
      }
      e.preventDefault();
      deviceKeyboard(
        deviceId,
        platform,
        native.keyCode,
        native.modifiers,
        isDown,
      );
    },
    [
      hasControl,
      blocked,
      isTv,
      platform,
      deviceButton,
      deviceKeyboard,
      deviceId,
    ],
  );

  if (!supported) {
    return (
      <div className="aw-main">
        <Banner tone="warning">
          Live device view needs a browser with WebCodecs (recent Safari,
          Chrome, or Edge).
        </Banner>
      </div>
    );
  }

  const buttons = isTv
    ? tvButtons(platform)
    : platform === "ios"
      ? IOS_BUTTONS
      : ANDROID_BUTTONS;

  // Rotating and folding are iOS-only: an Android emulator rotates its own
  // framebuffer and no simulator but the Duo has a hinge.
  const poseButtons = platform === "ios" && !isTv && (
    <>
      <Button
        variant="ghost"
        aria-label="Rotate device"
        title="Rotate device"
        disabled={blocked}
        onClick={onRotate}
      >
        <Icons.RotateDeviceIcon size={16} />
      </Button>
      {fold && (
        <Button
          variant="ghost"
          aria-label={fold.pose === "open" ? "Fold device" : "Unfold device"}
          title={fold.pose === "open" ? "Fold device" : "Unfold device"}
          disabled={blocked}
          onClick={onFold}
        >
          <Icons.FoldIcon size={16} />
        </Button>
      )}
    </>
  );

  const overlays = (
    <>
      <DeviceControlOverlay
        holderLabel={blocked ? holder.label : null}
        onTakeControl={() => {
          claimDevice(deviceId, true).catch(() => {});
        }}
      />
      {status !== "streaming" && (
        <div className="aw-device-placeholder">
          <p>{PLACEHOLDER[status]}</p>
        </div>
      )}
    </>
  );

  // The Siri Remote owns the arrow keys for a tvOS device, so the stage does
  // not also handle them — two listeners would double every press.
  const siriRemote = isTv && platform === "ios";

  return (
    <div className="aw-device">
      {hasControl && (
        <DeviceClaimBar
          holderLabel={holder?.label ?? null}
          mine={driving}
          onRelease={() => releaseDevice(deviceId)}
          onTakeControl={() => {
            claimDevice(deviceId, blocked).catch(() => {});
          }}
        />
      )}
      {isTv ? (
        // tvOS maps pointer gestures to the dpad rather than forwarding
        // touches, and a TV never rotates — so it keeps its own plain stage.
        <div className="aw-device-tv">
          <div
            className="aw-device-stage"
            tabIndex={0}
            onKeyDown={siriRemote ? undefined : (e) => onKey(e, true)}
            onKeyUp={siriRemote ? undefined : (e) => onKey(e, false)}
            onPointerCancel={onTvPointerUp}
            onPointerDown={onTvPointerDown}
            onPointerUp={onTvPointerUp}
          >
            <canvas ref={canvasRef} className="aw-device-canvas" />
            {overlays}
          </div>
          {siriRemote && hasControl && (
            <AppleTVRemote blocked={blocked} onPress={onRemotePress} />
          )}
        </div>
      ) : (
        <DeviceStage
          blocked={blocked}
          canvasRef={canvasRef}
          className="aw-device-frame"
          rotation={rotation}
          videoHeight={dims.height}
          videoWidth={dims.width}
          onKeyDown={(e) => onKey(e, true)}
          onKeyUp={(e) => onKey(e, false)}
          onTouch={onTouch}
        >
          {overlays}
        </DeviceStage>
      )}

      {hasControl && (
        <div className="aw-device-buttons">
          {buttons.map((b) => (
            <Button
              key={b.button}
              variant="ghost"
              aria-label={b.label}
              title={b.label}
              disabled={blocked}
              onClick={() =>
                deviceButton(deviceId, platform, b.button).catch(() => {})
              }
            >
              {b.icon}
            </Button>
          ))}
          {poseButtons}
        </div>
      )}
    </div>
  );
}
