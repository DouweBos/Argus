/**
 * Full-screen image viewer. Mounted once at the app root and driven by
 * `imageViewerStore`, so any thumbnail can open it. Swipe between images in
 * the same message, tap the backdrop to dismiss.
 */

import { useEffect, useRef, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Icons from "./Icons";
import { Muted } from "./ui";
import {
  closeImageViewer,
  useImageViewerStore,
} from "../stores/imageViewerStore";
import { useTheme } from "../theme";

export function ImageViewer() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const uris = useImageViewerStore((s) => s.uris);
  const index = useImageViewerStore((s) => s.index);
  const scrollRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);

  const open = index !== null;

  // Jump to the tapped image once the pager has its width.
  useEffect(() => {
    if (open && index !== null) {
      setPage(index);
      scrollRef.current?.scrollTo({ x: index * width, animated: false });
    }
  }, [open, index, width]);

  if (!open) {
    return null;
  }

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  return (
    <Modal
      visible
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={closeImageViewer}
    >
      <View style={{ flex: 1, backgroundColor: theme.mediaBg }}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScroll}
        >
          {uris.map((uri, i) => (
            // Tapping the image (or the space around it) closes the viewer.
            <Pressable key={i} onPress={closeImageViewer} style={{ width, height }}>
              <Image
                source={{ uri }}
                resizeMode="contain"
                style={{ width, height }}
              />
            </Pressable>
          ))}
        </ScrollView>

        <Pressable
          accessibilityLabel="Close image"
          onPress={closeImageViewer}
          hitSlop={10}
          style={{
            position: "absolute",
            top: insets.top + 8,
            right: 16,
            width: 34,
            height: 34,
            borderRadius: 17,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.bgSecondary,
          }}
        >
          <Icons.Close size={16} color={theme.text} />
        </Pressable>

        {uris.length > 1 && (
          <View
            style={{
              position: "absolute",
              bottom: insets.bottom + 16,
              alignSelf: "center",
            }}
          >
            <Muted>
              {page + 1} of {uris.length}
            </Muted>
          </View>
        )}
      </View>
    </Modal>
  );
}
