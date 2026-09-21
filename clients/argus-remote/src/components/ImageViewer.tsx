/**
 * Full-screen image viewer. Mounted once at the app root and driven by
 * `imageViewerStore`, so any thumbnail can open it. Pinch/double-tap to zoom,
 * drag to pan, swipe sideways between images, swipe down or tap to dismiss.
 */

import { useEffect, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Icons from "./Icons";
import { ZoomableImage } from "./ZoomableImage";
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
  const scrollRef = useRef<ScrollViewInstance>(null);
  const [page, setPage] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const dismissProgress = useSharedValue(0);

  const open = index !== null;
  const [syncedIndex, setSyncedIndex] = useState(index);

  if (index !== syncedIndex) {
    setSyncedIndex(index);
    setPage(index ?? 0);
    setZoomed(false);
  }

  // Pages report their drag rather than writing here directly, so the value
  // stays owned by the component that animates it.
  function setDismissProgress(value: number, animated: boolean) {
    "worklet";
    dismissProgress.value = animated
      ? withSpring(value, { damping: 22, stiffness: 220, mass: 0.6 })
      : value;
  }

  // Chrome and backdrop fade out as the image is dragged away.
  const chromeStyle = useAnimatedStyle(() => ({
    opacity: 1 - dismissProgress.value,
  }));

  // Jump to the tapped image once the pager has its width.
  useEffect(() => {
    if (open && index !== null) {
      dismissProgress.value = 0;
      scrollRef.current?.scrollTo({ x: index * width, animated: false });
    }
  }, [open, index, width, dismissProgress]);

  if (!open) {
    return null;
  }

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(e.nativeEvent.contentOffset.x / width));
    setZoomed(false);
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={closeImageViewer}
    >
      <Animated.View
        style={[{ flex: 1, backgroundColor: theme.mediaBg }, chromeStyle]}
      >
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          // A zoomed image owns the drag, so paging waits until it is back at rest.
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScroll}
        >
          {uris.map((uri, i) => (
            <ZoomableImage
              key={i}
              active={i === page}
              zoomed={zoomed && i === page}
              uri={uri}
              width={width}
              height={height}
              onDismissProgress={setDismissProgress}
              onZoomChange={setZoomed}
              onTap={closeImageViewer}
              onDismiss={closeImageViewer}
            />
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
      </Animated.View>
    </Modal>
  );
}
