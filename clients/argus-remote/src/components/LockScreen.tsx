/**
 * The gate shown before biometric unlock. Argus is the hundred-eyed watchman,
 * so the lock state is an eye sigil that keeps watch — rings breathing outward
 * while the app waits for you.
 */

import { useEffect, useRef } from "react";
import { Animated, Easing, Text, View } from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { Eye, Lock } from "./Icons";
import { Btn, useContentInsets } from "./ui";
import { useTheme, type Theme } from "../theme";

const SIGIL = 168;

export function LockScreen({
  canAuthenticate,
  biometryLabel,
  onUnlock,
}: {
  canAuthenticate: boolean;
  biometryLabel: string | null;
  onUnlock: () => void;
}) {
  const theme = useTheme();
  const insets = useContentInsets();
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 450,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter]);

  const rise = {
    opacity: enter,
    transform: [
      { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
    ],
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.bg,
        paddingTop: insets.top,
        paddingBottom: insets.bottom + 16,
        paddingHorizontal: theme.space * 2,
      }}
    >
      <Ambience theme={theme} />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 32 }}>
        <Sigil theme={theme} />
        <Animated.View style={[{ alignItems: "center", gap: 12 }, rise]}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingVertical: 5,
              paddingHorizontal: 11,
              borderRadius: 999,
              backgroundColor: theme.accentSoft,
              borderWidth: 1,
              borderColor: theme.accentBorder,
            }}
          >
            <Lock size={12} color={theme.accent} />
            <Text
              style={{
                color: theme.accent,
                fontSize: 11,
                fontWeight: "700",
                letterSpacing: 1.4,
              }}
            >
              LOCKED
            </Text>
          </View>
          <Text
            style={{
              color: theme.text,
              fontSize: 30,
              fontWeight: "700",
              letterSpacing: -0.5,
            }}
          >
            Argus Remote
          </Text>
          <Text
            style={{
              color: theme.textMuted,
              fontSize: 15,
              lineHeight: 21,
              textAlign: "center",
              maxWidth: 280,
            }}
          >
            {"Your agents keep working while you're away. Unlock to look in on them."}
          </Text>
        </Animated.View>
      </View>
      <Animated.View style={[{ gap: 10 }, rise]}>
        <Btn
          label={canAuthenticate ? `Unlock${biometryLabel ? ` with ${biometryLabel}` : ""}` : "Preparing…"}
          disabled={!canAuthenticate}
          onPress={onUnlock}
          icon={<Lock size={16} color={theme.onAccent} />}
          style={{ paddingVertical: 15, borderRadius: theme.radius }}
        />
        <Text
          style={{
            color: theme.textMuted,
            fontSize: 12,
            textAlign: "center",
          }}
        >
          Nothing leaves this phone unencrypted.
        </Text>
      </Animated.View>
    </View>
  );
}

/** Soft accent wash behind the sigil, with a cooler pool low on the screen. */
function Ambience({ theme }: { theme: Theme }) {
  return (
    <Svg style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      <Defs>
        <RadialGradient id="halo" cx="50%" cy="34%" r="62%">
          <Stop offset="0" stopColor={theme.accent} stopOpacity={0.16} />
          <Stop offset="1" stopColor={theme.accent} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="pool" cx="18%" cy="92%" r="55%">
          <Stop offset="0" stopColor={theme.brandPurple} stopOpacity={0.14} />
          <Stop offset="1" stopColor={theme.brandPurple} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#halo)" />
      <Rect width="100%" height="100%" fill="url(#pool)" />
    </Svg>
  );
}

/** Eye mark with two rings pulsing outward on a stagger, like a slow blink. */
function Sigil({ theme }: { theme: Theme }) {
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = (value: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, {
            toValue: 1,
            duration: 2600,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      );
    const animations = [loop(a, 0), loop(b, 1300)];
    animations.forEach((animation) => animation.start());

    return () => animations.forEach((animation) => animation.stop());
  }, [a, b]);

  const ring = (value: Animated.Value) => ({
    position: "absolute" as const,
    width: SIGIL,
    height: SIGIL,
    borderRadius: SIGIL / 2,
    borderWidth: 1,
    borderColor: theme.accentBorder,
    opacity: value.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.5, 0] }),
    transform: [
      { scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.62, 1.05] }) },
    ],
  });

  return (
    <View
      style={{
        width: SIGIL,
        height: SIGIL,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Animated.View style={ring(a)} />
      <Animated.View style={ring(b)} />
      <View
        style={{
          width: SIGIL * 0.62,
          height: SIGIL * 0.62,
          borderRadius: SIGIL,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.accentSoft,
          borderWidth: 1,
          borderColor: theme.accentBorder,
        }}
      >
        <Eye size={52} color={theme.accent} />
      </View>
    </View>
  );
}
