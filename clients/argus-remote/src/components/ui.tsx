/**
 * Shared RN UI primitives — the phone-side mirror of the Peacock components the
 * web client uses (Peacock is DOM-only, so it can't be imported here). All
 * colours come from `useTheme()`; nothing is hardcoded per screen.
 */

import type { ReactNode } from "react";
import { useContext, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { HeaderShownContext } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, type Theme } from "../theme";

export type Tone = "accent" | "danger" | "muted" | "success" | "warning";

function toneColor(theme: Theme, tone: Tone): string {
  switch (tone) {
    case "accent":
      return theme.accent;
    case "success":
      return theme.success;
    case "warning":
      return theme.warning;
    case "danger":
      return theme.error;
    default:
      return theme.textMuted;
  }
}

/**
 * Safe-area padding for screen content. A native stack header already clears
 * the status bar, so the top inset only applies to headerless screens (the
 * lock gate); the bottom inset always clears the home indicator.
 */
export function useContentInsets(): { top: number; bottom: number } {
  const insets = useSafeAreaInsets();
  const headerShown = useContext(HeaderShownContext);

  return { top: headerShown ? 0 : insets.top, bottom: insets.bottom };
}

/**
 * How much of the window the keyboard currently covers, in points.
 *
 * Measured from the keyboard's own frame rather than derived from the header
 * height, so it can't drift out of step with the navigation bar the way
 * `KeyboardAvoidingView`'s `keyboardVerticalOffset` does. Apply it as bottom
 * padding and the content above ends exactly at the keyboard's top edge.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const onFrame = (e: KeyboardEvent) => {
      const windowHeight = Dimensions.get("window").height;
      setInset(Math.max(0, windowHeight - e.endCoordinates.screenY));
    };
    const change = Keyboard.addListener("keyboardWillChangeFrame", onFrame);
    const hide = Keyboard.addListener("keyboardWillHide", () => setInset(0));

    return () => {
      change.remove();
      hide.remove();
    };
  }, []);

  return inset;
}

/** Whether the software keyboard is up — it already covers the home indicator. */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", () => setVisible(true));
    const hide = Keyboard.addListener("keyboardWillHide", () => setVisible(false));

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return visible;
}

export function Screen({
  children,
  scroll = true,
  contentStyle,
}: {
  children: ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const insets = useContentInsets();
  const padding = {
    padding: theme.space,
    gap: theme.space,
    paddingTop: theme.space + insets.top,
    paddingBottom: theme.space + insets.bottom,
  };

  if (!scroll) {
    return (
      <View style={[{ flex: 1, backgroundColor: theme.bg }, padding, contentStyle]}>
        {children}
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={[padding, contentStyle]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function Card({
  children,
  onPress,
  style,
  tone,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  tone?: Tone;
}) {
  const theme = useTheme();
  const cardStyle: StyleProp<ViewStyle> = [
    {
      backgroundColor: theme.bgSecondary,
      borderRadius: theme.radius,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: tone ? toneColor(theme, tone) : theme.border,
      padding: theme.space,
      gap: 6,
    },
    style,
  ];

  if (!onPress) {
    return <View style={cardStyle}>{children}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [cardStyle, pressed && { opacity: 0.75 }]}
    >
      {children}
    </Pressable>
  );
}

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const theme = useTheme();

  return (
    <Text style={[{ color: theme.text, fontSize: 19, fontWeight: "700" }, style]}>
      {children}
    </Text>
  );
}

export function Body({
  children,
  numberOfLines,
  style,
}: {
  children: ReactNode;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
}) {
  const theme = useTheme();

  return (
    <Text
      numberOfLines={numberOfLines}
      style={[{ color: theme.text, fontSize: 15 }, style]}
    >
      {children}
    </Text>
  );
}

export function Muted({
  children,
  numberOfLines,
  style,
}: {
  children: ReactNode;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
}) {
  const theme = useTheme();

  return (
    <Text
      numberOfLines={numberOfLines}
      style={[{ color: theme.textMuted, fontSize: 13 }, style]}
    >
      {children}
    </Text>
  );
}

export function Mono({
  children,
  numberOfLines,
  style,
}: {
  children: ReactNode;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
}) {
  const theme = useTheme();

  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        {
          color: theme.textSecondary,
          fontSize: 12,
          fontFamily: MONO_FAMILY,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export const MONO_FAMILY = "Menlo";

export function Btn({
  label,
  onPress,
  tone = "primary",
  disabled,
  size = "md",
  icon,
  style,
}: {
  label?: string;
  onPress: () => void;
  tone?: "danger" | "ghost" | "primary" | "secondary";
  disabled?: boolean;
  size?: "md" | "sm";
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const bg =
    tone === "primary"
      ? theme.accent
      : tone === "danger"
        ? theme.error
        : tone === "secondary"
          ? theme.bgTertiary
          : "transparent";
  const color =
    tone === "primary"
      ? theme.onAccent
      : tone === "danger"
        ? "#ffffff"
        : tone === "secondary"
          ? theme.text
          : theme.textSecondary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          paddingVertical: size === "sm" ? 7 : 11,
          paddingHorizontal: size === "sm" ? 11 : 15,
          borderRadius: theme.radiusSm,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 6,
          borderWidth: tone === "ghost" ? StyleSheet.hairlineWidth * 2 : 0,
          borderColor: theme.border,
          opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
        },
        style,
      ]}
    >
      {icon}
      {label != null && (
        <Text
          style={{ color, fontSize: size === "sm" ? 13 : 15, fontWeight: "600" }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/** Compact square icon-only button, used in headers and toolbars. */
export function IconBtn({
  children,
  onPress,
  label,
  disabled,
}: {
  children: ReactNode;
  onPress: () => void;
  label: string;
  disabled?: boolean;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 32,
        height: 32,
        borderRadius: theme.radiusSm,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? theme.bgHover : "transparent",
        opacity: disabled ? 0.4 : 1,
      })}
    >
      {children}
    </Pressable>
  );
}

export function Chip({
  label,
  onPress,
  tone,
  leading,
  mono,
}: {
  label: string;
  onPress?: () => void;
  tone?: Tone;
  leading?: ReactNode;
  mono?: boolean;
}) {
  const theme = useTheme();
  const color = tone ? toneColor(theme, tone) : theme.textSecondary;
  const content = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingVertical: 5,
        paddingHorizontal: 9,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: tone ? color : theme.border,
        backgroundColor: theme.bgTertiary,
      }}
    >
      {leading}
      <Text
        numberOfLines={1}
        style={{
          color,
          fontSize: 12,
          fontWeight: "600",
          fontFamily: mono ? MONO_FAMILY : undefined,
        }}
      >
        {label}
      </Text>
    </View>
  );

  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}>
      {content}
    </Pressable>
  ) : (
    content
  );
}

export function Badge({ label, tone = "muted" }: { label: string; tone?: Tone }) {
  const theme = useTheme();
  const color = toneColor(theme, tone);

  return (
    <View
      style={{
        paddingVertical: 2,
        paddingHorizontal: 7,
        borderRadius: 6,
        backgroundColor:
          tone === "muted" ? theme.bgTertiary : `${softFor(theme, tone)}`,
      }}
    >
      <Text style={{ color, fontSize: 11, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

function softFor(theme: Theme, tone: Tone): string {
  switch (tone) {
    case "accent":
      return theme.accentSoft;
    case "success":
      return theme.successSoft;
    case "warning":
      return theme.warningSoft;
    case "danger":
      return theme.errorSoft;
    default:
      return theme.bgTertiary;
  }
}

export function Banner({
  children,
  tone = "warning",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  const theme = useTheme();
  const color = toneColor(theme, tone);

  return (
    <View
      style={{
        backgroundColor: softFor(theme, tone),
        borderRadius: theme.radiusSm,
        borderLeftWidth: 3,
        borderLeftColor: color,
        padding: 10,
      }}
    >
      <Text style={{ color: theme.text, fontSize: 13 }}>{children}</Text>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  body,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
}) {
  const theme = useTheme();

  return (
    <View style={{ alignItems: "center", gap: 8, paddingVertical: 48 }}>
      {icon}
      <Text style={{ color: theme.text, fontSize: 15, fontWeight: "600" }}>
        {title}
      </Text>
      {body && (
        <Text
          style={{
            color: theme.textMuted,
            fontSize: 13,
            textAlign: "center",
            maxWidth: 300,
          }}
        >
          {body}
        </Text>
      )}
    </View>
  );
}

export function Spinner({ size = "small" }: { size?: "large" | "small" }) {
  const theme = useTheme();

  return <ActivityIndicator size={size} color={theme.accent} />;
}

export function Loading({ label }: { label: string }) {
  return (
    <View style={{ alignItems: "center", gap: 8, paddingVertical: 48 }}>
      <Spinner />
      <Muted>{label}</Muted>
    </View>
  );
}

export function SectionHeader({
  children,
  count,
}: {
  children: ReactNode;
  count?: number;
}) {
  const theme = useTheme();

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
      <Text
        style={{
          color: theme.textMuted,
          fontSize: 11,
          fontWeight: "700",
          letterSpacing: 0.6,
          textTransform: "uppercase",
        }}
      >
        {children}
      </Text>
      {count != null && <Muted>{count}</Muted>}
    </View>
  );
}

export function Field({
  label,
  caption,
  children,
}: {
  label: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <Body style={{ fontWeight: "600" }}>{label}</Body>
      {caption && <Muted>{caption}</Muted>}
      <View style={{ marginTop: 6, gap: 8 }}>{children}</View>
    </Card>
  );
}

export function TextField({
  value,
  onChangeText,
  placeholder,
  multiline,
  autoFocus,
  onSubmitEditing,
  maxLength,
  style,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
  maxLength?: number;
  style?: StyleProp<TextStyle>;
}) {
  const theme = useTheme();

  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.textMuted}
      autoCapitalize="none"
      autoCorrect={false}
      autoFocus={autoFocus}
      multiline={multiline}
      maxLength={maxLength}
      onSubmitEditing={onSubmitEditing}
      style={[
        {
          color: theme.text,
          backgroundColor: theme.bgTertiary,
          borderRadius: theme.radiusSm,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: theme.border,
          paddingHorizontal: 10,
          paddingVertical: 9,
          fontSize: 15,
          minHeight: multiline ? 64 : undefined,
        },
        style,
      ]}
    />
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const theme = useTheme();

  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: theme.bgTertiary,
        borderRadius: theme.radiusSm,
        padding: 3,
        gap: 3,
      }}
    >
      {options.map((o) => {
        const active = o.value === value;

        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              paddingVertical: 7,
              borderRadius: theme.radiusSm - 2,
              alignItems: "center",
              backgroundColor: active ? theme.bgSecondary : "transparent",
            }}
          >
            <Text
              style={{
                color: active ? theme.text : theme.textMuted,
                fontSize: 13,
                fontWeight: "600",
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function StatusDot({
  tone = "muted",
  pulse,
  size = 8,
  style,
  accessibilityLabel,
}: {
  tone?: Tone;
  pulse?: boolean;
  size?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pulse) {
      opacity.setValue(1);

      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();

    return () => loop.stop();
  }, [pulse, opacity]);

  return (
    <Animated.View
      accessibilityLabel={accessibilityLabel}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: toneColor(theme, tone),
          opacity,
        },
        style,
      ]}
    />
  );
}

/** Animated "…" shown while the agent is working. */
export function ThinkingDots() {
  const theme = useTheme();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(anim, {
        toValue: 3,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();

    return () => loop.stop();
  }, [anim]);

  return (
    <View style={{ flexDirection: "row", gap: 3 }}>
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={{
            width: 4,
            height: 4,
            borderRadius: 2,
            backgroundColor: theme.textMuted,
            opacity: anim.interpolate({
              inputRange: [i, i + 0.5, i + 1, 3],
              outputRange: [0.25, 1, 0.25, 0.25],
              extrapolate: "clamp",
            }),
          }}
        />
      ))}
    </View>
  );
}

export function Row({
  children,
  gap = 8,
  style,
}: {
  children: ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>
      {children}
    </View>
  );
}
