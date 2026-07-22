/**
 * Input translation for the emulator gRPC backend.
 *
 * The renderer sends Android AKEYCODE_* values (see app/lib/androidKeycodeMap),
 * but the emulator's gRPC KeyboardEvent expects Linux evdev codes (or w3c key
 * strings). This maps the AKEYCODE_* subset produced by the renderer to evdev.
 */

/** Android AKEYCODE_* → Linux evdev code (input-event-codes.h). */
export const ANDROID_TO_EVDEV: Record<number, number> = {
  // Letters
  29: 30,
  30: 48,
  31: 46,
  32: 32,
  33: 18,
  34: 33,
  35: 34,
  36: 35,
  37: 23,
  38: 36,
  39: 37,
  40: 38,
  41: 50,
  42: 49,
  43: 24,
  44: 25,
  45: 16,
  46: 19,
  47: 31,
  48: 20,
  49: 22,
  50: 47,
  51: 17,
  52: 45,
  53: 21,
  54: 44,
  // Digits (AKEYCODE_0..9 = 7..16)
  7: 11,
  8: 2,
  9: 3,
  10: 4,
  11: 5,
  12: 6,
  13: 7,
  14: 8,
  15: 9,
  16: 10,
  // Function keys (AKEYCODE_F1..F12 = 131..142)
  131: 59,
  132: 60,
  133: 61,
  134: 62,
  135: 63,
  136: 64,
  137: 65,
  138: 66,
  139: 67,
  140: 68,
  141: 87,
  142: 88,
  // Navigation
  19: 103,
  20: 108,
  21: 105,
  22: 106,
  // Editing
  67: 14,
  112: 111,
  66: 28,
  61: 15,
  62: 57,
  111: 1,
  // Symbols
  55: 51,
  56: 52,
  74: 39,
  75: 40,
  71: 26,
  72: 27,
  68: 41,
  69: 12,
  70: 13,
  76: 53,
  73: 43,
  // Modifiers
  59: 42,
  60: 54,
  113: 29,
  114: 97,
  57: 56,
  58: 100,
  117: 125,
  118: 126,
  115: 58,
  // Media / special
  3: 102,
  123: 107,
  92: 104,
  93: 109,
  124: 110,
};

/** Named hardware buttons → emulator gRPC w3c key values. */
export const BUTTON_TO_KEY: Record<string, string> = {
  home: "GoHome",
  back: "GoBack",
  recents: "AppSwitch",
  power: "Power",
  volume_up: "AudioVolumeUp",
  volume_down: "AudioVolumeDown",
  // Android TV dpad
  up: "DpadUp",
  down: "DpadDown",
  left: "DpadLeft",
  right: "DpadRight",
  select: "DpadCenter",
};
