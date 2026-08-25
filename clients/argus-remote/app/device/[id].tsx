/**
 * Live device screen: subscribes to a device's H.264 stream (devices.watch),
 * hands the access units to the native renderer, and forwards touch, hardware
 * buttons and typed keys back (devices.touch/button/keyboard) for
 * control-granted devices.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  StyleSheet,
  TextInput,
  View,
  type LayoutChangeEvent,
} from "react-native";
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
const DRAG_THROTTLE_MS = 17;
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
  const dims = useRef({ width: 0, height: 0 });
  const stageLayout = useRef({ width: 0, height: 0 });
  const lastDrag = useRef(0);
  const tvStart = useRef<{ x: number; y: number } | null>(null);
  const keyboardRef = useRef<TextInput>(null);
  const [status, setStatus] = useState<
    "connecting" | "error" | "novideo" | "streaming"
  >("connecting");
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  // Subscribe to the stream while connected; tear down on unmount / disconnect.
  useEffect(() => {
    if (connection !== "ready") {
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

    watchDevice(deviceId, platform)
      .then((streamId) => {
        if (cancelled) {
          unwatchDevice(deviceId).catch(() => {});

          return;
        }
        unregister = registerMediaSink(streamId, (msg) => {
          if (msg.kind === "config") {
            dims.current = { width: msg.codedWidth, height: msg.codedHeight };
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
    stageLayout.current = { width, height };
  }, []);

  /** Normalize a touch to 0–1 within the letterboxed video, not the stage. */
  const normCoords = useCallback((x: number, y: number) => {
    const stage = stageLayout.current;
    const { width, height } = dims.current;
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
  }, []);

  const touchResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => hasControl,
        onMoveShouldSetPanResponder: () => hasControl,
        onPanResponderGrant: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          if (isTv) {
            tvStart.current = { x: locationX, y: locationY };

            return;
          }
          const { x, y } = normCoords(locationX, locationY);
          deviceTouch(deviceId, platform, x, y, 0);
        },
        onPanResponderMove: (e) => {
          if (isTv) {
            return;
          }
          const now = Date.now();
          if (now - lastDrag.current < DRAG_THROTTLE_MS) {
            return;
          }
          lastDrag.current = now;
          const { locationX, locationY } = e.nativeEvent;
          const { x, y } = normCoords(locationX, locationY);
          deviceTouch(deviceId, platform, x, y, 1);
        },
        onPanResponderRelease: (e, gesture) => {
          if (isTv) {
            // A tap is Select; a drag is a directional swipe on the remote.
            const start = tvStart.current;
            tvStart.current = null;
            if (!start) {
              return;
            }
            const adx = Math.abs(gesture.dx);
            const ady = Math.abs(gesture.dy);
            let button: string;
            if (adx < TV_SWIPE_THRESHOLD && ady < TV_SWIPE_THRESHOLD) {
              button = "select";
            } else if (adx > ady) {
              button = gesture.dx > 0 ? "right" : "left";
            } else {
              button = gesture.dy > 0 ? "down" : "up";
            }
            deviceButton(deviceId, platform, button).catch(() => {});

            return;
          }
          const { locationX, locationY } = e.nativeEvent;
          const { x, y } = normCoords(locationX, locationY);
          deviceTouch(deviceId, platform, x, y, 2);
        },
      }),
    [deviceButton, deviceId, deviceTouch, hasControl, isTv, normCoords, platform],
  );

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

      <View
        onLayout={onStageLayout}
        style={{ flex: 1, backgroundColor: theme.mediaBg }}
        {...touchResponder.panHandlers}
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
            <Muted style={{ textAlign: "center" }}>{PLACEHOLDER[status]}</Muted>
          </View>
        )}
      </View>

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
