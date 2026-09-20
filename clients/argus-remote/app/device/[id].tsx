/**
 * Live device screen: subscribes to a device's H.264 stream (devices.watch),
 * hands the access units to the native renderer, and forwards touch, hardware
 * buttons and typed keys back (devices.touch/button/keyboard) for
 * control-granted devices.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  StyleSheet,
  TextInput,
  View,
  type LayoutChangeEvent,
  type TextInputInstance,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS, useSharedValue } from "react-native-reanimated";
import { Stack, useLocalSearchParams } from "expo-router";
import { ArgusVideoView, type ArgusVideoHandle } from "../../modules/argus-video";
import * as Icons from "../../src/components/Icons";
import {
  Banner,
  IconBtn,
  Muted,
  Row,
  useContentInsets,
} from "../../src/components/ui";
import { characterToNativeKey } from "../../src/lib/keyboardInput";
import type { RemotePlatform } from "../../src/lib/protocol";
import { useAppStore } from "../../src/stores/appStore";
import { useTheme } from "../../src/theme";

/** No video within this window → booted but not producing a decodable stream. */
const NO_VIDEO_TIMEOUT_MS = 10_000;
/** Minimum finger travel, in points, between injected drag samples. */
const DRAG_MIN_TRAVEL = 2;
/** A drag shorter than this (px) counts as a tap → dpad select on a TV. */
const TV_SWIPE_THRESHOLD = 24;

const PLACEHOLDER: Record<string, string> = {
  connecting: "Connecting to device…",
  error: "Couldn't start the stream. Is the device still booted?",
  novideo: "No video from this device — it's booted but not producing a stream.",
};

/** The "back" affordance differs per TV platform: tvOS Menu vs Android Back. */
function tvBackButton(platform: RemotePlatform): string {
  return platform === "ios" ? "menu" : "back";
}

export default function DeviceScreen() {
  const theme = useTheme();
  const insets = useContentInsets();
  const params = useLocalSearchParams<{
    id: string;
    platform: RemotePlatform;
    name?: string;
    tv?: string;
  }>();
  const deviceId = params.id ?? "";
  const platform: RemotePlatform = params.platform === "android" ? "android" : "ios";
  const isTv = params.tv === "1";

  const connection = useAppStore((s) => s.connection);
  const hasControl = useAppStore((s) => s.hasControl());
  const watchDevice = useAppStore((s) => s.watchDevice);
  const unwatchDevice = useAppStore((s) => s.unwatchDevice);
  const registerMediaSink = useAppStore((s) => s.registerMediaSink);
  const deviceTouch = useAppStore((s) => s.deviceTouch);
  const deviceButton = useAppStore((s) => s.deviceButton);
  const deviceKeyboard = useAppStore((s) => s.deviceKeyboard);

  const videoRef = useRef<ArgusVideoHandle>(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const [stageLayout, setStageLayout] = useState({ width: 0, height: 0 });
  const keyboardRef = useRef<TextInputInstance>(null);
  const [status, setStatus] = useState<
    "connecting" | "error" | "novideo" | "streaming"
  >("connecting");
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const lastDrag = useSharedValue({ x: 0, y: 0 });
  const tvStart = useSharedValue<{ x: number; y: number } | null>(null);
  const subscription = `${deviceId}:${platform}:${connection}`;
  const [syncedSubscription, setSyncedSubscription] = useState(subscription);

  if (subscription !== syncedSubscription) {
    setSyncedSubscription(subscription);
    setStatus("connecting");
  }

  // Subscribe to the stream while connected; tear down on unmount / disconnect.
  useEffect(() => {
    if (connection !== "ready") {
      return;
    }
    let cancelled = false;
    let unregister: (() => void) | null = null;
    const watchdog = setTimeout(() => {
      if (!cancelled) {
        setStatus((s) => (s === "connecting" ? "novideo" : s));
      }
    }, NO_VIDEO_TIMEOUT_MS);

    watchDevice(deviceId, platform)
      .then((streamId) => {
        if (cancelled) {
          unwatchDevice(deviceId).catch(() => {});

          return;
        }
        unregister = registerMediaSink(streamId, (msg) => {
          if (msg.kind === "config") {
            setDims({ width: msg.codedWidth, height: msg.codedHeight });
            videoRef.current
              ?.configure(msg.codec, msg.codedWidth, msg.codedHeight, msg.description)
              .catch(() => {});
          } else {
            videoRef.current
              ?.enqueue(msg.data, msg.keyFrame, msg.timestamp)
              .catch(() => {});
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
      unwatchDevice(deviceId).catch(() => {});
    };
  }, [connection, deviceId, platform, registerMediaSink, unwatchDevice, watchDevice]);

  const onStageLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setStageLayout((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height },
    );
  }, []);

  /** Normalize a touch to 0–1 within the letterboxed video, not the stage. */
  const normCoords = useCallback(
    (x: number, y: number) => {
    "worklet";
    const stage = stageLayout;
    const { width, height } = dims;
    if (!width || !height || !stage.width || !stage.height) {
      return { x: 0, y: 0 };
    }
    const scale = Math.min(stage.width / width, stage.height / height);
    const renderedW = width * scale;
    const renderedH = height * scale;
    const offsetX = (stage.width - renderedW) / 2;
    const offsetY = (stage.height - renderedH) / 2;

    return {
      x: Math.max(0, Math.min(0.9999, (x - offsetX) / renderedW)),
      y: Math.max(0, Math.min(0.9999, (y - offsetY) / renderedH)),
    };
    },
    [dims, stageLayout],
  );

  const sendTouch = useCallback(
    (x: number, y: number, phase: 0 | 1 | 2) => {
      deviceTouch(deviceId, platform, x, y, phase);
    },
    [deviceId, deviceTouch, platform],
  );

  const pressButton = useCallback(
    (button: string) => {
      deviceButton(deviceId, platform, button).catch(() => {});
    },
    [deviceButton, deviceId, platform],
  );

  // Handlers are worklets so the throttle and the per-gesture bookkeeping stay
  // on the UI thread; only the injection itself hops back to JS.
  const touchGesture = Gesture.Pan()
    .enabled(hasControl)
        .minDistance(0)
        .onBegin((e) => {
          if (isTv) {
            tvStart.value = { x: e.x, y: e.y };

            return;
          }
          const { x, y } = normCoords(e.x, e.y);
          runOnJS(sendTouch)(x, y, 0);
        })
        .onUpdate((e) => {
          if (isTv) {
            return;
          }
          // Throttle by travel rather than elapsed time: no clock read, and it
          // tracks what the far end actually needs to redraw.
          const last = lastDrag.value;
          if (Math.hypot(e.x - last.x, e.y - last.y) < DRAG_MIN_TRAVEL) {
            return;
          }
          lastDrag.value = { x: e.x, y: e.y };
          const { x, y } = normCoords(e.x, e.y);
          runOnJS(sendTouch)(x, y, 1);
        })
        .onFinalize((e) => {
          if (isTv) {
            // A tap is Select; a drag is a directional swipe on the remote.
            const start = tvStart.value;
            tvStart.value = null;
            if (!start) {
              return;
            }
            const adx = Math.abs(e.x - start.x);
            const ady = Math.abs(e.y - start.y);
            let button: string;
            if (adx < TV_SWIPE_THRESHOLD && ady < TV_SWIPE_THRESHOLD) {
              button = "select";
            } else if (adx > ady) {
              button = e.x > start.x ? "right" : "left";
            } else {
              button = e.y > start.y ? "down" : "up";
            }
            runOnJS(pressButton)(button);

            return;
          }
          lastDrag.value = { x: 0, y: 0 };
          const { x, y } = normCoords(e.x, e.y);
          runOnJS(sendTouch)(x, y, 2);
        });

  const sendKey = useCallback(
    (char: string) => {
      const native = characterToNativeKey(platform, char);
      if (!native) {
        return;
      }
      deviceKeyboard(deviceId, platform, native.keyCode, native.modifiers, true);
      deviceKeyboard(deviceId, platform, native.keyCode, native.modifiers, false);
    },
    [deviceId, deviceKeyboard, platform],
  );

  const buttons = isTv
    ? [
        {
          button: tvBackButton(platform),
          label: platform === "ios" ? "Menu" : "Back",
          icon: <Icons.ArrowBack size={17} color={theme.textSecondary} />,
        },
        {
          button: "home",
          label: "Home",
          icon: <Icons.Home size={17} color={theme.textSecondary} />,
        },
      ]
    : platform === "ios"
      ? [
          {
            button: "ios_home",
            label: "Home",
            icon: <Icons.Home size={17} color={theme.textSecondary} />,
          },
        ]
      : [
          {
            button: "back",
            label: "Back",
            icon: <Icons.AndroidBack size={17} color={theme.textSecondary} />,
          },
          {
            button: "home",
            label: "Home",
            icon: <Icons.Home size={17} color={theme.textSecondary} />,
          },
          {
            button: "recents",
            label: "Recents",
            icon: <Icons.AndroidRecents size={17} color={theme.textSecondary} />,
          },
        ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Stack.Screen options={{ title: params.name ?? "Device" }} />

      <GestureDetector gesture={touchGesture}>
        <View
          onLayout={onStageLayout}
          style={{ flex: 1, backgroundColor: theme.mediaBg }}
        >
          <ArgusVideoView
            ref={videoRef}
            style={{ flex: 1 }}
            onFirstFrame={() => setStatus("streaming")}
          />
          {status !== "streaming" && (
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  alignItems: "center",
                  justifyContent: "center",
                  padding: theme.space,
                },
              ]}
            >
              <Muted style={{ textAlign: "center" }}>
                {PLACEHOLDER[status]}
              </Muted>
            </View>
          )}
        </View>
      </GestureDetector>

      {!hasControl && (
        <View style={{ padding: theme.space }}>
          <Banner>
            This device can watch but not control. Grant it control in Argus →
            Settings → Remote Access to tap and type here.
          </Banner>
        </View>
      )}

      {hasControl && (
        <Row
          gap={4}
          style={{
            justifyContent: "center",
            paddingTop: 8,
            paddingBottom: 8 + insets.bottom,
            borderTopWidth: 1,
            borderTopColor: theme.border,
            backgroundColor: theme.bgSecondary,
          }}
        >
          {buttons.map((b) => (
            <IconBtn
              key={b.button}
              label={b.label}
              onPress={() => deviceButton(deviceId, platform, b.button).catch(() => {})}
            >
              {b.icon}
            </IconBtn>
          ))}
          {!isTv && (
            <IconBtn
              label="Keyboard"
              onPress={() => {
                setKeyboardOpen(true);
                keyboardRef.current?.focus();
              }}
            >
              <Icons.Keyboard size={17} color={theme.textSecondary} />
            </IconBtn>
          )}
        </Row>
      )}

      {/* Off-screen capture field: typed characters forward as key events and
          nothing is kept locally, so the device holds the real text. */}
      <TextInput
        ref={keyboardRef}
        value=""
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={(text) => {
          for (const char of text) {
            sendKey(char);
          }
        }}
        onKeyPress={(e) => {
          if (e.nativeEvent.key === "Backspace") {
            sendKey("Backspace");
          }
        }}
        onSubmitEditing={() => sendKey("Enter")}
        onBlur={() => setKeyboardOpen(false)}
        style={{ height: 0, opacity: keyboardOpen ? 0.01 : 0 }}
      />
    </View>
  );
}
