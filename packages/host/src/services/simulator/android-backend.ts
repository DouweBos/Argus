/**
 * Common interface for Android screen-capture + input backends.
 *
 * Two implementations exist:
 *   - `EmulatorGrpcBridge` — emulators, via the emulator's native gRPC API
 *     (no jar push / app_process, lower startup + input latency).
 *   - `AndroidBridge` — physical devices, via scrcpy-server.
 *
 * Both emit the same `android_video_config` / `android_video_frame` IPC events
 * so the renderer decode path is identical regardless of backend.
 */
export interface AndroidCaptureBackend {
  /** Start capture: connect, stream video → IPC, ready for input. */
  start: () => Promise<void>;
  /**
   * Inject a touch event.
   * `action`: Android MotionEvent action (0=down, 1=up, 2=move).
   * `x`/`y`: normalized [0, 1] coordinates. `pressure`: 0 or 1.
   */
  sendTouch: (action: number, x: number, y: number, pressure: number) => void;
  /**
   * Inject a key event.
   * `action`: 0=down, 1=up. `keyCode`: Android AKEYCODE_* value.
   */
  sendKey: (action: number, keyCode: number, metaState: number) => void;
  /** Press a named hardware button (home/back/recents/power/volume_*). */
  sendButton: (button: string) => Promise<void>;
  /** Tear everything down. */
  kill: () => void;
}
