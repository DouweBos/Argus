import Foundation

/// Translate typed characters into the platform-native key codes the device
/// bridges expect: macOS virtual keycodes for iOS simulators, Android
/// `KEYCODE_*` for emulators. Keyed by physical code, which is layout-stable.
public enum KeyMap {
  public struct NativeKey: Sendable, Equatable {
    public var keyCode: Int
    public var modifiers: Int
  }

  /// `NSEventModifierFlagShift` — carries capitalisation and shifted symbols.
  static let iosShift = 0x20000
  /// `AMETA_SHIFT_ON`.
  static let androidShift = 0x1

  // macOS virtual keycodes (kVK_*).
  static let iosCodes: [String: Int] = [
    "KeyA": 0, "KeyS": 1, "KeyD": 2, "KeyF": 3, "KeyH": 4, "KeyG": 5, "KeyZ": 6, "KeyX": 7,
    "KeyC": 8, "KeyV": 9, "KeyB": 11, "KeyQ": 12, "KeyW": 13, "KeyE": 14, "KeyR": 15,
    "KeyY": 16, "KeyT": 17, "KeyO": 31, "KeyU": 32, "KeyI": 34, "KeyP": 35, "KeyL": 37,
    "KeyJ": 38, "KeyK": 40, "KeyN": 45, "KeyM": 46,
    "Digit1": 18, "Digit2": 19, "Digit3": 20, "Digit4": 21, "Digit5": 23, "Digit6": 22,
    "Digit7": 26, "Digit8": 28, "Digit9": 25, "Digit0": 29,
    "Enter": 36, "Tab": 48, "Space": 49, "Backspace": 51, "Escape": 53, "Delete": 117,
    "ArrowLeft": 123, "ArrowRight": 124, "ArrowDown": 125, "ArrowUp": 126,
    "Minus": 27, "Equal": 24, "BracketLeft": 33, "BracketRight": 30, "Backslash": 42,
    "Semicolon": 41, "Quote": 39, "Comma": 43, "Period": 47, "Slash": 44, "Backquote": 50,
  ]

  // Android KEYCODE_* values.
  static let androidCodes: [String: Int] = [
    "KeyA": 29, "KeyB": 30, "KeyC": 31, "KeyD": 32, "KeyE": 33, "KeyF": 34, "KeyG": 35,
    "KeyH": 36, "KeyI": 37, "KeyJ": 38, "KeyK": 39, "KeyL": 40, "KeyM": 41, "KeyN": 42,
    "KeyO": 43, "KeyP": 44, "KeyQ": 45, "KeyR": 46, "KeyS": 47, "KeyT": 48, "KeyU": 49,
    "KeyV": 50, "KeyW": 51, "KeyX": 52, "KeyY": 53, "KeyZ": 54,
    "Digit0": 7, "Digit1": 8, "Digit2": 9, "Digit3": 10, "Digit4": 11, "Digit5": 12,
    "Digit6": 13, "Digit7": 14, "Digit8": 15, "Digit9": 16,
    "Space": 62, "Enter": 66, "Backspace": 67, "Tab": 61, "Escape": 111, "Delete": 112,
    "ArrowUp": 19, "ArrowDown": 20, "ArrowLeft": 21, "ArrowRight": 22,
    "Comma": 55, "Period": 56, "Minus": 69, "Equal": 70, "BracketLeft": 71,
    "BracketRight": 72, "Backslash": 73, "Semicolon": 74, "Quote": 75, "Slash": 76,
    "Backquote": 68,
  ]

  public static func nativeKey(platform: RemotePlatform, code: String, shift: Bool)
    -> NativeKey?
  {
    switch platform {
    case .ios:
      guard let keyCode = iosCodes[code] else { return nil }
      return NativeKey(keyCode: keyCode, modifiers: shift ? iosShift : 0)
    case .android:
      guard let keyCode = androidCodes[code] else { return nil }
      return NativeKey(keyCode: keyCode, modifiers: shift ? androidShift : 0)
    }
  }

  private static let symbolCodes: [Character: (code: String, shift: Bool)] = [
    " ": ("Space", false), "\n": ("Enter", false),
    "-": ("Minus", false), "_": ("Minus", true),
    "=": ("Equal", false), "+": ("Equal", true),
    "[": ("BracketLeft", false), "{": ("BracketLeft", true),
    "]": ("BracketRight", false), "}": ("BracketRight", true),
    "\\": ("Backslash", false), "|": ("Backslash", true),
    ";": ("Semicolon", false), ":": ("Semicolon", true),
    "'": ("Quote", false), "\"": ("Quote", true),
    ",": ("Comma", false), "<": ("Comma", true),
    ".": ("Period", false), ">": ("Period", true),
    "/": ("Slash", false), "?": ("Slash", true),
    "`": ("Backquote", false), "~": ("Backquote", true),
  ]

  private static let shiftedDigits: [Character: String] = [
    "!": "Digit1", "@": "Digit2", "#": "Digit3", "$": "Digit4", "%": "Digit5",
    "^": "Digit6", "&": "Digit7", "*": "Digit8", "(": "Digit9", ")": "Digit0",
  ]

  /// One character, or the literal "Backspace" / "Enter", to a key press.
  public static func nativeKey(platform: RemotePlatform, character: String) -> NativeKey? {
    if character == "Backspace" {
      return nativeKey(platform: platform, code: "Backspace", shift: false)
    }
    if character == "Enter" || character == "\n" {
      return nativeKey(platform: platform, code: "Enter", shift: false)
    }
    guard character.count == 1, let scalar = character.first else { return nil }

    if scalar.isLowercase, scalar.isLetter {
      return nativeKey(
        platform: platform, code: "Key\(scalar.uppercased())", shift: false)
    }
    if scalar.isUppercase, scalar.isLetter {
      return nativeKey(platform: platform, code: "Key\(scalar)", shift: true)
    }
    if scalar.isNumber, scalar.isASCII {
      return nativeKey(platform: platform, code: "Digit\(scalar)", shift: false)
    }
    if let digit = shiftedDigits[scalar] {
      return nativeKey(platform: platform, code: digit, shift: true)
    }
    if let symbol = symbolCodes[scalar] {
      return nativeKey(platform: platform, code: symbol.code, shift: symbol.shift)
    }
    return nil
  }
}
