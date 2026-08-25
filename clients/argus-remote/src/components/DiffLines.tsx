/** Collapsible line-diff renderer for Edit/Write tool previews. */

import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { MONO_FAMILY } from "./ui";
import { useTheme } from "../theme";
import type { EditDiffLine } from "../lib/diffLines";

const COLLAPSED_LINE_COUNT = 12;

export function DiffLines({ lines }: { lines: EditDiffLine[] }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const overflows = lines.length > COLLAPSED_LINE_COUNT;
  const visible = overflows && !expanded ? lines.slice(0, COLLAPSED_LINE_COUNT) : lines;

  return (
    <View
      style={{
        backgroundColor: theme.bgTertiary,
        borderRadius: theme.radiusSm,
        borderWidth: 1,
        borderColor: theme.borderSubtle,
        overflow: "hidden",
      }}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ paddingVertical: 6 }}>
          {visible.map((line, i) => {
            const bg =
              line.type === "add"
                ? theme.successSoft
                : line.type === "remove"
                  ? theme.errorSoft
                  : "transparent";
            const color =
              line.type === "add"
                ? theme.success
                : line.type === "remove"
                  ? theme.error
                  : theme.textSecondary;

            return (
              <View
                key={i}
                style={{
                  flexDirection: "row",
                  backgroundColor: bg,
                  paddingHorizontal: 8,
                }}
              >
                <Text
                  style={{
                    color: theme.textMuted,
                    fontFamily: MONO_FAMILY,
                    fontSize: 11,
                    width: 34,
                    textAlign: "right",
                  }}
                >
                  {line.lineNo ?? ""}
                </Text>
                <Text
                  style={{
                    color,
                    fontFamily: MONO_FAMILY,
                    fontSize: 11.5,
                    lineHeight: 16,
                    paddingLeft: 8,
                  }}
                >
                  {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                  {line.content}
                </Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
      {overflows && (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          style={{
            paddingVertical: 7,
            alignItems: "center",
            borderTopWidth: 1,
            borderTopColor: theme.borderSubtle,
          }}
        >
          <Text style={{ color: theme.accent, fontSize: 12, fontWeight: "600" }}>
            {expanded ? "Collapse" : `See all ${lines.length} lines`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
