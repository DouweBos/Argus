/** Thumbnails of images staged for the next message, with remove buttons. */

import { Image, Pressable, ScrollView, View } from "react-native";
import * as Icons from "./Icons";
import type { PendingImage } from "../lib/images";
import { useTheme } from "../theme";

export function ImageAttachmentStrip({
  items,
  onRemove,
}: {
  items: PendingImage[];
  onRemove: (index: number) => void;
}) {
  const theme = useTheme();

  if (items.length === 0) {
    return null;
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ flexDirection: "row", gap: 8, paddingVertical: 6 }}>
        {items.map((item, i) => (
          <View key={`${item.name}-${i}`}>
            <Image
              source={{ uri: item.previewUri }}
              style={{
                width: 56,
                height: 56,
                borderRadius: theme.radiusSm,
                borderWidth: 1,
                borderColor: theme.borderStrong,
                backgroundColor: theme.bgTertiary,
              }}
            />
            <Pressable
              accessibilityLabel="Remove image"
              onPress={() => onRemove(i)}
              hitSlop={6}
              style={{
                position: "absolute",
                top: -6,
                right: -6,
                width: 20,
                height: 20,
                borderRadius: 10,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.bgTertiary,
                borderWidth: 1,
                borderColor: theme.border,
              }}
            >
              <Icons.Close size={11} color={theme.textSecondary} />
            </Pressable>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
