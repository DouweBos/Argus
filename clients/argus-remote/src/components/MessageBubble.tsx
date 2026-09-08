/** Chat bubble for one transcript message — role styling, text, images, tools. */

import type { ReactNode } from "react";
import { Image, Pressable, View } from "react-native";
import { Markdown } from "./Markdown";
import { Badge, Muted, Row } from "./ui";
import { openImageViewer } from "../stores/imageViewerStore";
import { useTheme } from "../theme";

export interface MessageImage {
  uri: string;
}

export function MessageBubble({
  role,
  textBlocks,
  chips,
  toolCalls,
  images,
  mcpLabel,
  isError,
  timestamp,
  toolOnly,
}: {
  role: "assistant" | "system" | "user";
  textBlocks: string[];
  chips?: ReactNode;
  toolCalls?: ReactNode;
  images?: MessageImage[];
  mcpLabel?: string;
  isError?: boolean;
  timestamp?: number;
  toolOnly?: boolean;
}) {
  const theme = useTheme();
  const isUser = role === "user";

  return (
    <View
      style={{
        alignSelf: isUser ? "flex-end" : "stretch",
        maxWidth: isUser ? "88%" : undefined,
        gap: 6,
      }}
    >
      {(mcpLabel || isError) && (
        <Row gap={6}>
          {mcpLabel ? <Badge label={mcpLabel} tone="accent" /> : null}
          {isError ? <Badge label="error" tone="danger" /> : null}
        </Row>
      )}

      {chips ? (
        <Row
          gap={6}
          style={{
            flexWrap: "wrap",
            justifyContent: isUser ? "flex-end" : "flex-start",
          }}
        >
          {chips}
        </Row>
      ) : null}

      {textBlocks.length > 0 && (
        <View
          style={{
            backgroundColor: isUser ? theme.accentSoft : theme.bgSecondary,
            borderWidth: toolOnly ? 0 : 1,
            borderColor: isUser ? theme.accentBorder : theme.border,
            borderRadius: theme.radius,
            padding: 11,
            gap: 8,
          }}
        >
          {textBlocks.map((text, i) => (
            <Markdown key={i} text={text} />
          ))}
        </View>
      )}

      {images && images.length > 0 && (
        <Row gap={6} style={{ flexWrap: "wrap" }}>
          {images.map((img, i) => (
            <Pressable
              key={i}
              accessibilityLabel="View image"
              onPress={() =>
                openImageViewer(
                  images.map((x) => x.uri),
                  i,
                )
              }
            >
              <Image
                source={{ uri: img.uri }}
                resizeMode="cover"
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: theme.radiusSm,
                  borderWidth: 1,
                  borderColor: theme.borderStrong,
                  backgroundColor: theme.bgTertiary,
                }}
              />
            </Pressable>
          ))}
        </Row>
      )}

      {toolCalls ? <View style={{ gap: 6 }}>{toolCalls}</View> : null}

      {timestamp ? (
        <Muted
          style={{
            fontSize: 10,
            alignSelf: isUser ? "flex-end" : "flex-start",
          }}
        >
          {new Date(timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </Muted>
      ) : null}
    </View>
  );
}
