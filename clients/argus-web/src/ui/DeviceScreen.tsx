/**
 * Live device screen: subscribes to a device's H.264 stream (devices.watch),
 * decodes it to a canvas with WebCodecs, and forwards pointer/keyboard/button
 * input back (devices.touch/keyboard/button) for control-granted devices.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Banner, Button, Icons } from "@argus/peacock";
import { H264CanvasDecoder } from "@argus/remote-client";
import { toNativeKey } from "../lib/keymap";
import type { RemotePlatform } from "../lib/protocol";
import { useAppStore } from "../lib/store";

const DRAG_THROTTLE_MS = 17;

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
  const connection = useAppStore((s) => s.connection);
  const hasControl = useAppStore((s) => s.hasControl());
  const watchDevice = useAppStore((s) => s.watchDevice);
  const unwatchDevice = useAppStore((s) => s.unwatchDevice);
  const registerMediaSink = useAppStore((s) => s.registerMediaSink);
  const deviceTouch = useAppStore((s) => s.deviceTouch);
  const deviceButton = useAppStore((s) => s.deviceButton);
  const deviceKeyboard = useAppStore((s) => s.deviceKeyboard);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const decoderRef = useRef<H264CanvasDecoder | null>(null);
  const dimsRef = useRef({ width: 0, height: 0 });
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
      onDimensions: (width, height) => {
        dimsRef.current = { width, height };
      },
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
          } else {
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

  // --- Pointer → normalized touch ---
  const lastDrag = useRef(0);
  const pointerDown = useRef(false);

  const normCoords = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const { width, height } = dimsRef.current;
      if (!width || !height) {
        return {
          x: (e.clientX - rect.left) / rect.width,
          y: (e.clientY - rect.top) / rect.height,
        };
      }
      const scale = Math.min(rect.width / width, rect.height / height);
      const renderedW = width * scale;
      const renderedH = height * scale;
      const offsetX = (rect.width - renderedW) / 2;
      const offsetY = (rect.height - renderedH) / 2;

      return {
        x: Math.max(
          0,
          Math.min(0.9999, (e.clientX - rect.left - offsetX) / renderedW),
        ),
        y: Math.max(
          0,
          Math.min(0.9999, (e.clientY - rect.top - offsetY) / renderedH),
        ),
      };
    },
    [],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!hasControl) {
        return;
      }
      pointerDown.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      const { x, y } = normCoords(e);
      deviceTouch(deviceId, platform, x, y, 0);
    },
    [hasControl, normCoords, deviceTouch, deviceId, platform],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!pointerDown.current || e.buttons === 0) {
        return;
      }
      const now = performance.now();
      if (now - lastDrag.current < DRAG_THROTTLE_MS) {
        return;
      }
      lastDrag.current = now;
      const { x, y } = normCoords(e);
      deviceTouch(deviceId, platform, x, y, 1);
    },
    [normCoords, deviceTouch, deviceId, platform],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!pointerDown.current) {
        return;
      }
      pointerDown.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
      const { x, y } = normCoords(e);
      deviceTouch(deviceId, platform, x, y, 2);
    },
    [normCoords, deviceTouch, deviceId, platform],
  );

  // --- tvOS: pointer → dpad. A tap is Select; a drag is a directional swipe. ---
  const tvStart = useRef<{ x: number; y: number } | null>(null);

  const onTvPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!hasControl) {
        return;
      }
      tvStart.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [hasControl],
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

  const onKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, isDown: boolean) => {
      if (!hasControl) {
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
    [hasControl, isTv, platform, deviceButton, deviceKeyboard, deviceId],
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

  // tvOS maps pointer gestures to the remote dpad; phones/emulators forward
  // the raw touch.
  const stagePointerProps = isTv
    ? {
        onPointerDown: onTvPointerDown,
        onPointerUp: onTvPointerUp,
        onPointerCancel: onTvPointerUp,
      }
    : {
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel: onPointerUp,
      };

  return (
    <div className="aw-device">
      <div
        className="aw-device-stage"
        tabIndex={0}
        onKeyDown={(e) => onKey(e, true)}
        onKeyUp={(e) => onKey(e, false)}
        {...stagePointerProps}
      >
        <canvas ref={canvasRef} className="aw-device-canvas" />
        {status !== "streaming" && (
          <div className="aw-device-placeholder">
            <p>{PLACEHOLDER[status]}</p>
          </div>
        )}
      </div>

      {hasControl && (
        <div className="aw-device-buttons">
          {buttons.map((b) => (
            <Button
              key={b.button}
              variant="ghost"
              aria-label={b.label}
              title={b.label}
              onClick={() =>
                deviceButton(deviceId, platform, b.button).catch(() => {})
              }
            >
              {b.icon}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
