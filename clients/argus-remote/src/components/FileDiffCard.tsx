/** One file's unified diff, collapsed by default — the changes-view row. */

import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import * as Icons from "./Icons";
import { Badge, MONO_FAMILY, Muted, Row } from "./ui";
import type { DiffFile } from "../lib/diff";
import { useTheme } from "../theme";

const STATUS_LABEL: Record<DiffFile["status"], string> = {
  A: "added",
  D: "deleted",
  M: "modified",
  R: "renamed",
};

export function FileDiffCard({ file }: { file: DiffFile }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const path = file.newPath || file.oldPath;

  let additions = 0;
  let deletions = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add") {
        additions++;
      } else if (line.type === "remove") {
        deletions++;
      }
    }
  }

  const tone =
    file.status === "A" ? "success" : file.status === "D" ? "danger" : "accent";

  return (
    <View
      style={{
        borderRadius: theme.radiusSm,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.bgSecondary,
        overflow: "hidden",
      }}
    >
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        style={{ padding: 10, gap: 6 }}
      >
        <Row gap={6}>
          {expanded ? (
            <Icons.ChevronDown size={12} color={theme.textMuted} />
          ) : (
            <Icons.ChevronRight size={12} color={theme.textMuted} />
          )}
          <Text
            numberOfLines={1}
            ellipsizeMode="head"
            style={{
              flex: 1,
              color: theme.text,
              fontSize: 12.5,
              fontFamily: MONO_FAMILY,
            }}
          >
            {path}
          </Text>
          <Badge label={STATUS_LABEL[file.status]} tone={tone} />
        </Row>
        <Row gap={8}>
          {additions > 0 && (
            <Text style={{ color: theme.success, fontSize: 11 }}>+{additions}</Text>
          )}
          {deletions > 0 && (
            <Text style={{ color: theme.error, fontSize: 11 }}>-{deletions}</Text>
          )}
          {file.status === "R" && file.oldPath ? (
            <Muted numberOfLines={1}>from {file.oldPath}</Muted>
          ) : null}
        </Row>
      </Pressable>

      {expanded && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ paddingBottom: 8 }}>
            {file.hunks.map((hunk, hi) => (
              <View key={hi}>
                <Text
                  style={{
                    color: theme.textMuted,
                    fontFamily: MONO_FAMILY,
                    fontSize: 11,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    backgroundColor: theme.bgTertiary,
                  }}
                >
                  {hunk.header}
                </Text>
                {hunk.lines.map((line, li) => {
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
                    <Text
                      key={li}
                      style={{
                        backgroundColor: bg,
                        color,
                        fontFamily: MONO_FAMILY,
                        fontSize: 11.5,
                        lineHeight: 16,
                        paddingHorizontal: 10,
                      }}
                    >
                      {line.type === "add"
                        ? "+"
                        : line.type === "remove"
                          ? "-"
                          : " "}
                      {line.content}
                    </Text>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
