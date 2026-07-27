import type { DeviceInfo } from "../../../lib/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAndroidVideoDecoder } from "../../../hooks/useAndroidVideoDecoder";
import { useIosVideoDecoder } from "../../../hooks/useIosVideoDecoder";
import { useVideoInputStream } from "../../../hooks/useVideoInputStream";
import {
  androidMetaStateFromEvent,
  ANDROID_KEYCODE_MAP,
} from "../../../lib/androidKeycodeMap";
import {
  androidButton,
  androidKeyboard,
  androidTouch,
  browserGetMjpegPort,
  browserKeyboardEvent,
  browserMouseEvent,
  browserViewEnsure,
  browserWheelEvent,
  simulatorButton,
  simulatorKeyboard,
  simulatorTouch,
  startAndroidCapture,
  startSimulatorCapture,
  stopAndroidCapture,
  stopSimulatorCapture,
} from "../../../lib/ipc";
import { KEYCODE_MAP, modifierFlagsFromEvent } from "../../../lib/keycodeMap";
import styles from "./DeviceDialog.module.css";
import { useNormalizedPointer } from "./useNormalizedPointer";

interface DevicePreviewProps {
  device: DeviceInfo;
  /**
   * When false, render a view-only monitor: no control bar and a passive
   * pointer layer (no tap/type). Used by the multi-device grid's compact
   * tiles. Defaults to true (full interaction) for the device dialog.
   */
  interactive?: boolean;
}

export function DevicePreview({
  device,
  interactive = true,
}: DevicePreviewProps) {
  if (!device.online) {
    return (
      <div className={styles.previewPlaceholder}>
        Device is offline. Boot it to show a live preview.
      </div>
    );
  }

  if (device.platform === "ios") {
    return <IosPreview device={device} interactive={interactive} />;
  }
  if (device.platform === "android") {
    return <AndroidPreview device={device} interactive={interactive} />;
  }
  if (device.platform === "video") {
    return <VideoPreview device={device} />;
  }

  return <WebPreview device={device} interactive={interactive} />;
}

// ---------------------------------------------------------------------------
// Video input (capture card / camera) — view only
// ---------------------------------------------------------------------------

function VideoPreview({ device }: { device: DeviceInfo }) {
  const { videoRef, playing, errorMsg } = useVideoInputStream(
    device.deviceKey,
    true,
  );

  return (
    <div className={styles.stageWrap}>
      <video
        ref={videoRef}
        className={
          playing
            ? styles.previewVideo
            : `${styles.previewVideo} ${styles.videoHidden}`
        }
        autoPlay
        muted
        playsInline
      />
      {!playing && (
        <div className={styles.previewPlaceholder}>
          {errorMsg ?? "Starting video…"}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// iOS
// ---------------------------------------------------------------------------

function IosPreview({
  device,
  interactive,
}: {
  device: DeviceInfo;
  interactive: boolean;
}) {
  const [active, setActive] = useState(false);
  const udid = device.reservationKey;
  const { canvasRef, isReceiving, isConfigured, videoWidth, videoHeight } =
    useIosVideoDecoder(active, udid);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    startSimulatorCapture(udid)
      .then(() => {
        if (!cancelled) {
          setActive(true);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      setActive(false);
      stopSimulatorCapture(udid).catch(() => {});
    };
  }, [udid]);

  const onTouch = useCallback(
    (x: number, y: number, type: 0 | 1 | 2) => {
      simulatorTouch(udid, x, y, type).catch(() => {});
    },
    [udid],
  );

  const { handlers } = useNormalizedPointer(stageRef, {
    getMediaSize: () => {
      if (videoWidth === 0 || videoHeight === 0) {
        return null;
      }

      return { width: videoWidth, height: videoHeight };
    },
    onTouch,
  });

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.repeat) {
        return;
      }
      const isCmdShiftH = e.metaKey && e.shiftKey && e.code === "KeyH";
      if (
        e.metaKey &&
        e.code !== "MetaLeft" &&
        e.code !== "MetaRight" &&
        !isCmdShiftH
      ) {
        return;
      }
      const code = KEYCODE_MAP[e.code];
      if (code === undefined) {
        return;
      }
      e.preventDefault();
      simulatorKeyboard(
        udid,
        code,
        modifierFlagsFromEvent(e.nativeEvent),
        true,
      ).catch(() => {});
    },
    [udid],
  );

  const onKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const code = KEYCODE_MAP[e.code];
      if (code === undefined) {
        return;
      }
      e.preventDefault();
      simulatorKeyboard(
        udid,
        code,
        modifierFlagsFromEvent(e.nativeEvent),
        false,
      ).catch(() => {});
    },
    [udid],
  );

  return (
    <>
      <div ref={stageRef} className={styles.stageWrap}>
        <canvas
          ref={canvasRef}
          className={styles.previewImg}
          style={{
            display: isConfigured ? "block" : "none",
            opacity: isReceiving ? 1 : 0.6,
          }}
        />
        {!isConfigured && (
          <div className={styles.previewPlaceholder}>Starting capture…</div>
        )}
        {interactive && (
          <div
            className={styles.pointerLayer}
            role="application"
            tabIndex={0}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            {...handlers}
          />
        )}
      </div>
      {interactive && (
        <div className={styles.controlBar}>
          <button
            type="button"
            className={styles.controlBtn}
            onClick={() => {
              simulatorButton(udid, "ios_home").catch(() => {});
            }}
          >
            Home
          </button>
          <button
            type="button"
            className={styles.controlBtn}
            onClick={() => {
              simulatorButton(udid, "ios_lock").catch(() => {});
            }}
          >
            Lock
          </button>
          <button
            type="button"
            className={styles.controlBtn}
            onClick={() => {
              simulatorButton(udid, "ios_siri").catch(() => {});
            }}
          >
            Siri
          </button>
          <span className={styles.controlHint}>
            Tap, drag, and type — click preview to focus keyboard
          </span>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Android
// ---------------------------------------------------------------------------

function AndroidPreview({
  device,
  interactive,
}: {
  device: DeviceInfo;
  interactive: boolean;
}) {
  const [active, setActive] = useState(false);
  const serial = device.reservationKey;
  const { canvasRef, isReceiving, isConfigured, videoWidth, videoHeight } =
    useAndroidVideoDecoder(
      active,
      `android_video_config:${serial}`,
      `android_video_frame:${serial}`,
    );
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    startAndroidCapture(serial)
      .then(() => {
        if (!cancelled) {
          setActive(true);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      setActive(false);
      stopAndroidCapture(serial).catch(() => {});
    };
  }, [serial]);

  const onTouch = useCallback(
    (x: number, y: number, type: 0 | 1 | 2) => {
      androidTouch(serial, x, y, type).catch(() => {});
    },
    [serial],
  );

  const { handlers } = useNormalizedPointer(stageRef, {
    getMediaSize: () => {
      if (videoWidth === 0 || videoHeight === 0) {
        return null;
      }

      return { width: videoWidth, height: videoHeight };
    },
    onTouch,
  });

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.repeat) {
        return;
      }
      if (e.metaKey && e.code !== "MetaLeft" && e.code !== "MetaRight") {
        return;
      }
      const code = ANDROID_KEYCODE_MAP[e.code];
      if (code === undefined) {
        return;
      }
      e.preventDefault();
      androidKeyboard(
        serial,
        code,
        androidMetaStateFromEvent(e.nativeEvent),
        true,
      ).catch(() => {});
    },
    [serial],
  );

  const onKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const code = ANDROID_KEYCODE_MAP[e.code];
      if (code === undefined) {
        return;
      }
      e.preventDefault();
      androidKeyboard(
        serial,
        code,
        androidMetaStateFromEvent(e.nativeEvent),
        false,
      ).catch(() => {});
    },
    [serial],
  );

  return (
    <>
      <div ref={stageRef} className={styles.stageWrap}>
        <canvas
          ref={canvasRef}
          className={styles.previewImg}
          style={{
            display: isConfigured ? "block" : "none",
            opacity: isReceiving ? 1 : 0.6,
          }}
        />
        {!isConfigured && (
          <div className={styles.previewPlaceholder}>Starting capture…</div>
        )}
        {interactive && (
          <div
            className={styles.pointerLayer}
            role="application"
            tabIndex={0}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            {...handlers}
          />
        )}
      </div>
      {interactive && (
        <div className={styles.controlBar}>
          <button
            type="button"
            className={styles.controlBtn}
            onClick={() => {
              androidButton(serial, "android_back").catch(() => {});
            }}
          >
            Back
          </button>
          <button
            type="button"
            className={styles.controlBtn}
            onClick={() => {
              androidButton(serial, "android_home").catch(() => {});
            }}
          >
            Home
          </button>
          <button
            type="button"
            className={styles.controlBtn}
            onClick={() => {
              androidButton(serial, "android_recent").catch(() => {});
            }}
          >
            Recents
          </button>
          <button
            type="button"
            className={styles.controlBtn}
            onClick={() => {
              androidButton(serial, "android_power").catch(() => {});
            }}
          >
            Power
          </button>
          <span className={styles.controlHint}>
            Tap, drag, and type — click preview to focus keyboard
          </span>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Web
// ---------------------------------------------------------------------------

function WebPreview({
  device,
  interactive,
}: {
  device: DeviceInfo;
  interactive: boolean;
}) {
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await browserViewEnsure(device.reservationKey);
        const port = await browserGetMjpegPort();
        if (cancelled) {
          return;
        }
        if (!port) {
          setLoadError("MJPEG server not available");

          return;
        }
        setStreamUrl(
          `http://127.0.0.1:${String(port)}/stream/${encodeURIComponent(device.reservationKey)}`,
        );
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [device.reservationKey]);

  const key = device.reservationKey;

  const pageCoords = useCallback(
    (
      e: React.MouseEvent<HTMLDivElement> | React.WheelEvent<HTMLDivElement>,
    ) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const img = imgRef.current;
      if (!img || img.naturalWidth === 0) {
        return {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
      }
      const scale = Math.min(
        rect.width / img.naturalWidth,
        rect.height / img.naturalHeight,
      );
      const renderedW = img.naturalWidth * scale;
      const renderedH = img.naturalHeight * scale;
      const offsetX = (rect.width - renderedW) / 2;
      const offsetY = (rect.height - renderedH) / 2;

      return {
        x: Math.round((e.clientX - rect.left - offsetX) / scale),
        y: Math.round((e.clientY - rect.top - offsetY) / scale),
      };
    },
    [],
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const { x, y } = pageCoords(e);
      browserMouseEvent(key, "down", x, y, "left").catch(() => {});
    },
    [key, pageCoords],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.buttons === 0) {
        return;
      }
      const { x, y } = pageCoords(e);
      browserMouseEvent(key, "move", x, y).catch(() => {});
    },
    [key, pageCoords],
  );

  const onMouseUp = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const { x, y } = pageCoords(e);
      browserMouseEvent(key, "up", x, y, "left").catch(() => {});
    },
    [key, pageCoords],
  );

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const { x, y } = pageCoords(e);
      browserMouseEvent(key, "click", x, y, "left").catch(() => {});
    },
    [key, pageCoords],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      const { x, y } = pageCoords(e);
      browserWheelEvent(key, x, y, e.deltaX, e.deltaY).catch(() => {});
    },
    [key, pageCoords],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      browserKeyboardEvent(key, "down", e.key).catch(() => {});
      if (e.key.length === 1) {
        browserKeyboardEvent(key, "press", e.key).catch(() => {});
      }
    },
    [key],
  );

  const onKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      browserKeyboardEvent(key, "up", e.key).catch(() => {});
    },
    [key],
  );

  if (loadError) {
    return (
      <div
        className={styles.previewPlaceholder}
        style={{ color: "var(--error)" }}
      >
        Could not start web preview: {loadError}
      </div>
    );
  }

  return (
    <>
      <div ref={stageRef} className={styles.stageWrap}>
        {streamUrl ? (
          <img
            ref={imgRef}
            src={streamUrl}
            alt={device.name}
            className={styles.previewImg}
          />
        ) : (
          <div className={styles.previewPlaceholder}>
            Starting browser capture…
          </div>
        )}
        {interactive && (
          <div
            className={styles.pointerLayer}
            role="application"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onWheel={onWheel}
            style={{ cursor: "default" }}
          />
        )}
      </div>
      {interactive && (
        <div className={styles.controlBar}>
          <span className={styles.controlHint}>
            Click, drag, scroll, and type — click preview to focus keyboard
          </span>
        </div>
      )}
    </>
  );
}
