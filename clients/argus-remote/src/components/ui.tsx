/** Small shared RN UI primitives (Peacock isn't reusable here). */

import type { ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { theme } from "../theme";

export function Screen({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
    >
      {children}
    </ScrollView>
  );
}

export function Card({
  children,
  onPress,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const content = <View style={[styles.card, style]}>{children}</View>;

  return onPress ? (
    <Pressable onPress={onPress}>{content}</Pressable>
  ) : (
    content
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function Body({ children }: { children: ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

export function Btn({
  label,
  onPress,
  tone = "primary",
  disabled,
}: {
  label: string;
  onPress: () => void;
  tone?: "danger" | "ghost" | "primary";
  disabled?: boolean;
}) {
  const bg =
    tone === "primary"
      ? theme.accent
      : tone === "danger"
        ? theme.danger
        : "transparent";
  const color = tone === "ghost" ? theme.textMuted : "#fff";

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={[
        styles.btn,
        { backgroundColor: bg, opacity: disabled ? 0.4 : 1 },
        tone === "ghost" && styles.btnGhost,
      ]}
    >
      <Text style={[styles.btnText, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  screenContent: { padding: theme.space, gap: theme.space },
  card: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: theme.space,
    gap: 6,
  },
  title: { color: theme.text, fontSize: 20, fontWeight: "700" },
  body: { color: theme.text, fontSize: 15 },
  muted: { color: theme.textMuted, fontSize: 13 },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: theme.radiusSm,
    alignItems: "center",
  },
  btnGhost: { borderWidth: 1, borderColor: theme.border },
  btnText: { fontSize: 15, fontWeight: "600" },
});
