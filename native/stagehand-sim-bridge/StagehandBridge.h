#ifndef STAGEHAND_BRIDGE_H
#define STAGEHAND_BRIDGE_H

#include <stdbool.h>
#include <stdint.h>

/// Callback invoked for each JPEG-encoded frame.
typedef void (*FrameCallback)(const uint8_t *data, uintptr_t len);

/// Start capturing the simulator framebuffer via CoreSimulator IOSurface.
/// Calls `callback` with JPEG bytes at ~30fps.
/// Returns 0 on success, non-zero on failure.
int32_t cs_start_framebuffer(const char *udid, FrameCallback callback);

/// Stop the active framebuffer capture.
void cs_stop_framebuffer(void);

/// Inject a touch event into the simulator via the Indigo HID protocol.
/// norm_x, norm_y: normalized screen coordinates in [0.0, 1.0].
/// event_type: 0 = Down, 1 = Drag, 2 = Up.
/// Returns 0 on success, -1 on failure.
int32_t sc_indigo_touch(const char *udid, float norm_x, float norm_y, int32_t event_type);

/// Inject a keyboard event into the simulator via the Indigo HID protocol.
/// key_code: macOS virtual key code (e.g. 126=Up, 36=Return).
/// modifier_flags: NSEvent modifier flags (e.g. NSEventModifierFlagCommand).
/// is_down: true for key-down, false for key-up.
/// Returns 0 on success, negative on failure.
int32_t sc_indigo_keyboard(const char *udid, uint16_t key_code,
                            uint64_t modifier_flags, bool is_down);

#endif
