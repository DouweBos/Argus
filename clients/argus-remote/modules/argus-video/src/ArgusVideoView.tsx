/**
 * Native H.264 surface. Frames arrive in JS (they're decrypted there), so the
 * view exposes imperative `configure`/`enqueue` calls that hand the bytes
 * straight to VideoToolbox (iOS) / MediaCodec (Android) — no base64, no canvas.
 */

import { requireNativeView } from "expo";
import { forwardRef, useImperativeHandle, useRef, type ComponentType, type Ref } from "react";
import type { ViewProps } from "react-native";

export interface ArgusVideoHandle {
  /** Apply the stream's avcC description; safe to call again on re-config. */
  configure: (
    codec: string,
    width: number,
    height: number,
    description: Uint8Array,
  ) => Promise<void>;
  /** Queue one access unit (AVCC length-prefixed) for display. */
  enqueue: (
    data: Uint8Array,
    isKeyFrame: boolean,
    timestamp: number,
  ) => Promise<void>;
}

interface NativeProps extends ViewProps {
  onFirstFrame?: () => void;
  ref?: Ref<ArgusVideoHandle>;
}

const NativeView: ComponentType<NativeProps> =
  requireNativeView<NativeProps>("ArgusVideo");

export interface ArgusVideoViewProps extends ViewProps {
  /** Fired once the first frame has been rendered. */
  onFirstFrame?: () => void;
}

export const ArgusVideoView = forwardRef<ArgusVideoHandle, ArgusVideoViewProps>(
  function ArgusVideoView({ onFirstFrame, ...props }, ref) {
    const nativeRef = useRef<ArgusVideoHandle>(null);

    useImperativeHandle(ref, () => ({
      configure: async (codec, width, height, description) => {
        await nativeRef.current?.configure(codec, width, height, description);
      },
      enqueue: async (data, isKeyFrame, timestamp) => {
        await nativeRef.current?.enqueue(data, isKeyFrame, timestamp);
      },
    }));

    return <NativeView ref={nativeRef} onFirstFrame={onFirstFrame} {...props} />;
  },
);
