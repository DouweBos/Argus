/**
 * One page of the image viewer: pinch to zoom, drag to pan while zoomed,
 * double-tap to toggle zoom, and swipe down to dismiss at rest. Gesture state
 * lives on the UI thread so the transform never waits on a JS frame.
 */

import { useEffect } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  runOnUI,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 280;
const DISMISS_DISTANCE = 120;
/** Gesture handler reports px/s where PanResponder reported px/ms. */
const DISMISS_VELOCITY = 800;
/** Vertical travel before a drag at rest commits to dismissing, leaving
 *  shorter horizontal swipes to the pager underneath. */
const DRAG_SLOP = 8;
const ZOOMED = 1.01;
const SPRING = { damping: 22, stiffness: 220, mass: 0.6 } as const;

export function ZoomableImage({
  uri,
  active,
  zoomed,
  width,
  height,
  onDismissProgress,
  onZoomChange,
  onTap,
  onDismiss,
}: {
  uri: string;
  /** The page currently on screen; others reset their zoom when swiped away. */
  active: boolean;
  /** Whether the viewer considers this page zoomed, which frees the pan
   *  gesture to claim horizontal drags from the pager. */
  zoomed: boolean;
  width: number;
  height: number;
  /** Reports 0…1 drag-to-dismiss progress so the viewer can fade its backdrop.
   *  A worklet — called from the gesture, on the UI thread. */
  onDismissProgress: (value: number, animated: boolean) => void;
  onZoomChange: (zoomed: boolean) => void;
  onTap: () => void;
  onDismiss: () => void;
}) {
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  // Committed transform as of the start of the current gesture.
  const startScale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startFocalX = useSharedValue(0);
  const startFocalY = useSharedValue(0);
  const dismissing = useSharedValue(false);

  function clamp(s: number, x: number, y: number) {
    "worklet";
    const next = Math.min(Math.max(s, 1), MAX_SCALE);
    const maxX = Math.max((width * next - width) / 2, 0);
    const maxY = Math.max((height * next - height) / 2, 0);

    return {
      scale: next,
      x: Math.min(Math.max(x, -maxX), maxX),
      y: Math.min(Math.max(y, -maxY), maxY),
    };
  }

  function settle(s: number, x: number, y: number) {
    "worklet";
    const c = clamp(s, x, y);
    scale.value = withSpring(c.scale, SPRING);
    translateX.value = withSpring(c.x, SPRING);
    translateY.value = withSpring(c.y, SPRING);
  }

  // One notification per crossing, whichever gesture caused it.
  useAnimatedReaction(
    () => scale.value > ZOOMED,
    (is, was) => {
      if (was !== null && is !== was) {
        runOnJS(onZoomChange)(is);
      }
    },
  );

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      startScale.value = scale.value;
      startX.value = translateX.value;
      startY.value = translateY.value;
      startFocalX.value = e.focalX;
      startFocalY.value = e.focalY;
    })
    .onUpdate((e) => {
      const c = clamp(
        startScale.value * e.scale,
        startX.value * e.scale + (e.focalX - startFocalX.value),
        startY.value * e.scale + (e.focalY - startFocalY.value),
      );
      scale.value = c.scale;
      translateX.value = c.x;
      translateY.value = c.y;
    })
    .onEnd(() => settle(scale.value, translateX.value, translateY.value));

  const panBase = Gesture.Pan()
    .maxPointers(1)
    .onStart(() => {
      startX.value = translateX.value;
      startY.value = translateY.value;
      dismissing.value = scale.value <= ZOOMED;
    })
    .onUpdate((e) => {
      if (dismissing.value) {
        translateX.value = e.translationX;
        translateY.value = e.translationY;
        const progress = Math.min(
          Math.abs(e.translationY) / DISMISS_DISTANCE,
          1,
        );
        onDismissProgress(progress, false);
        scale.value = 1 - progress * 0.1;

        return;
      }
      const c = clamp(
        scale.value,
        startX.value + e.translationX,
        startY.value + e.translationY,
      );
      translateX.value = c.x;
      translateY.value = c.y;
    })
    .onEnd((e) => {
      if (dismissing.value) {
        if (
          Math.abs(e.translationY) > DISMISS_DISTANCE ||
          Math.abs(e.velocityY) > DISMISS_VELOCITY
        ) {
          runOnJS(onDismiss)();

          return;
        }
        dismissing.value = false;
        onDismissProgress(0, true);
        settle(1, 0, 0);

        return;
      }
      settle(scale.value, translateX.value, translateY.value);
    });

  // At rest only a vertical pull counts, so the pager still gets its swipes.
  const pan = zoomed ? panBase : panBase.activeOffsetY([-DRAG_SLOP, DRAG_SLOP]);

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(DOUBLE_TAP_MS)
    .onEnd((e) => {
      if (scale.value > ZOOMED) {
        settle(1, 0, 0);

        return;
      }
      // Zoom toward the tapped point so the detail under the finger stays put.
      const dx = width / 2 - e.x;
      const dy = height / 2 - e.y;
      settle(
        DOUBLE_TAP_SCALE,
        dx * (DOUBLE_TAP_SCALE - 1),
        dy * (DOUBLE_TAP_SCALE - 1),
      );
    });

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd(() => runOnJS(onTap)());

  const gesture = Gesture.Race(
    Gesture.Simultaneous(pinch, pan),
    Gesture.Exclusive(doubleTap, singleTap),
  );

  // A page swiped away gives up its zoom, on the UI thread: shared values
  // written straight from JS race an in-flight gesture.
  useEffect(() => {
    if (!active) {
      runOnUI(() => {
        "worklet";
        scale.value = withSpring(1, SPRING);
        translateX.value = withSpring(0, SPRING);
        translateY.value = withSpring(0, SPRING);
      })();
    }
  }, [active, scale, translateX, translateY]);

  const imageStyle = useAnimatedStyle(() => ({
    width,
    height,
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={{ width, height }}>
        <Animated.Image
          source={{ uri }}
          resizeMode="contain"
          style={imageStyle}
        />
      </Animated.View>
    </GestureDetector>
  );
}
