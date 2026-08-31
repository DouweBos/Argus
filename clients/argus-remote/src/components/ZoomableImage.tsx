/**
 * One page of the image viewer: pinch to zoom, drag to pan while zoomed,
 * double-tap to toggle zoom, and swipe down to dismiss at rest. Built on
 * PanResponder so the app stays free of native gesture dependencies.
 */

import { useEffect, useMemo, useRef } from "react";
import { Animated, PanResponder, View, type GestureResponderEvent } from "react-native";

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 280;
const TAP_SLOP = 12;
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 0.8;

function distance(touches: { pageX: number; pageY: number }[]): number {
  const [a, b] = touches;

  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

function midpoint(touches: { pageX: number; pageY: number }[]) {
  const [a, b] = touches;

  return { x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2 };
}

export function ZoomableImage({
  uri,
  active,
  width,
  height,
  dismissProgress,
  onZoomChange,
  onTap,
  onDismiss,
}: {
  uri: string;
  /** The page currently on screen; others reset their zoom when swiped away. */
  active: boolean;
  width: number;
  height: number;
  /** 0…1 drag-to-dismiss progress, so the viewer can fade its backdrop. */
  dismissProgress: Animated.Value;
  onZoomChange: (zoomed: boolean) => void;
  onTap: () => void;
  onDismiss: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  // Committed transform between gestures — Animated.Values can't be read
  // synchronously, and the responder math needs the current values.
  const view = useRef({ scale: 1, x: 0, y: 0 });
  const gesture = useRef({
    mode: "none" as "none" | "pan" | "pinch" | "dismiss",
    startDistance: 0,
    startScale: 1,
    startX: 0,
    startY: 0,
    focalX: 0,
    focalY: 0,
    lastTapAt: 0,
    lastTapX: 0,
    lastTapY: 0,
  });

  const clamp = useMemo(
    () => (next: { scale: number; x: number; y: number }) => {
      const s = Math.min(Math.max(next.scale, 1), MAX_SCALE);
      const maxX = Math.max((width * s - width) / 2, 0);
      const maxY = Math.max((height * s - height) / 2, 0);

      return {
        scale: s,
        x: Math.min(Math.max(next.x, -maxX), maxX),
        y: Math.min(Math.max(next.y, -maxY), maxY),
      };
    },
    [width, height],
  );

  const apply = useMemo(
    () => (next: { scale: number; x: number; y: number }, animated: boolean) => {
      const wasZoomed = view.current.scale > 1.01;
      view.current = next;
      if (animated) {
        Animated.parallel([
          Animated.spring(scale, { toValue: next.scale, useNativeDriver: true, bounciness: 0 }),
          Animated.spring(translateX, { toValue: next.x, useNativeDriver: true, bounciness: 0 }),
          Animated.spring(translateY, { toValue: next.y, useNativeDriver: true, bounciness: 0 }),
        ]).start();
      } else {
        scale.setValue(next.scale);
        translateX.setValue(next.x);
        translateY.setValue(next.y);
      }
      const isZoomed = next.scale > 1.01;
      if (isZoomed !== wasZoomed) {
        onZoomChange(isZoomed);
      }
    },
    [scale, translateX, translateY, onZoomChange],
  );

  // Zoom toward the tapped point so the detail under the finger stays put.
  const toggleZoom = useMemo(
    () => (e: GestureResponderEvent) => {
      if (view.current.scale > 1.01) {
        apply({ scale: 1, x: 0, y: 0 }, true);

        return;
      }
      const dx = width / 2 - e.nativeEvent.locationX;
      const dy = height / 2 - e.nativeEvent.locationY;
      apply(
        clamp({
          scale: DOUBLE_TAP_SCALE,
          x: dx * (DOUBLE_TAP_SCALE - 1),
          y: dy * (DOUBLE_TAP_SCALE - 1),
        }),
        true,
      );
    },
    [apply, clamp, width, height],
  );

  useEffect(() => {
    if (!active && view.current.scale !== 1) {
      apply({ scale: 1, x: 0, y: 0 }, false);
    }
  }, [active, apply]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        // Let the pager own horizontal swipes until the image is zoomed in.
        onMoveShouldSetPanResponder: (_e, g) =>
          g.numberActiveTouches === 2 ||
          view.current.scale > 1.01 ||
          (Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx)),
        onPanResponderTerminationRequest: () => false,

        onPanResponderGrant: (e) => {
          const now = Date.now();
          const { pageX, pageY } = e.nativeEvent;
          const g = gesture.current;
          const isDoubleTap =
            now - g.lastTapAt < DOUBLE_TAP_MS &&
            Math.hypot(pageX - g.lastTapX, pageY - g.lastTapY) < TAP_SLOP * 2;

          g.lastTapAt = isDoubleTap ? 0 : now;
          g.lastTapX = pageX;
          g.lastTapY = pageY;
          g.mode = "none";
          g.startScale = view.current.scale;
          g.startX = view.current.x;
          g.startY = view.current.y;

          if (isDoubleTap) {
            toggleZoom(e);
          }
        },

        onPanResponderMove: (e, state) => {
          const g = gesture.current;
          const touches = e.nativeEvent.touches;

          if (touches.length === 2) {
            const d = distance(touches);
            if (g.mode !== "pinch") {
              g.mode = "pinch";
              g.startDistance = d;
              g.startScale = view.current.scale;
              g.startX = view.current.x;
              g.startY = view.current.y;
              const m = midpoint(touches);
              g.focalX = m.x;
              g.focalY = m.y;
            }
            const ratio = d / (g.startDistance || d);
            const next = g.startScale * ratio;
            const m = midpoint(touches);
            apply(
              clamp({
                scale: next,
                x: g.startX * ratio + (m.x - g.focalX),
                y: g.startY * ratio + (m.y - g.focalY),
              }),
              false,
            );

            return;
          }

          if (g.mode === "pinch") {
            return;
          }

          if (view.current.scale > 1.01) {
            g.mode = "pan";
            apply(
              clamp({
                scale: view.current.scale,
                x: g.startX + state.dx,
                y: g.startY + state.dy,
              }),
              false,
            );

            return;
          }

          // At rest a vertical drag pulls the image away to dismiss it.
          if (g.mode === "dismiss" || Math.abs(state.dy) > Math.abs(state.dx)) {
            g.mode = "dismiss";
            translateX.setValue(state.dx);
            translateY.setValue(state.dy);
            const progress = Math.min(Math.abs(state.dy) / DISMISS_DISTANCE, 1);
            dismissProgress.setValue(progress);
            scale.setValue(1 - progress * 0.1);
          }
        },

        onPanResponderRelease: (e, state) => {
          const g = gesture.current;

          if (g.mode === "dismiss") {
            const shouldClose =
              Math.abs(state.dy) > DISMISS_DISTANCE ||
              Math.abs(state.vy) > DISMISS_VELOCITY;
            if (shouldClose) {
              onDismiss();

              return;
            }
            dismissProgress.setValue(0);
            apply({ scale: 1, x: 0, y: 0 }, true);
            g.mode = "none";

            return;
          }

          if (g.mode === "none") {
            const moved =
              Math.hypot(state.dx, state.dy) > TAP_SLOP ||
              e.nativeEvent.touches.length > 0;
            if (!moved && Date.now() - g.lastTapAt >= 0 && g.lastTapAt !== 0) {
              // Wait out the double-tap window before treating it as a tap.
              const tapAt = g.lastTapAt;
              setTimeout(() => {
                if (gesture.current.lastTapAt === tapAt) {
                  onTap();
                }
              }, DOUBLE_TAP_MS);
            }

            return;
          }

          apply(clamp(view.current), true);
          g.mode = "none";
        },
      }),
    [apply, clamp, dismissProgress, onDismiss, onTap, scale, toggleZoom, translateX, translateY],
  );

  return (
    <View style={{ width, height }} {...responder.panHandlers}>
      <Animated.Image
        source={{ uri }}
        resizeMode="contain"
        style={{
          width,
          height,
          transform: [{ translateX }, { translateY }, { scale }],
        }}
      />
    </View>
  );
}
