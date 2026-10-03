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

  /// What a hardware keyboard can send beyond typing: navigation, modifiers
  /// and function keys, as in the renderer's `keycodeMap.ts`.
  static let iosHardwareCodes: [String: Int] = iosCodes.merging([
    "Home": 115, "End": 119, "PageUp": 116, "PageDown": 121,
    "ShiftLeft": 56, "ShiftRight": 60, "ControlLeft": 59, "ControlRight": 62,
    "AltLeft": 58, "AltRight": 61, "MetaLeft": 55, "MetaRight": 54, "CapsLock": 57,
    "F1": 122, "F2": 120, "F3": 99, "F4": 118, "F5": 96, "F6": 97, "F7": 98, "F8": 100,
    "F9": 101, "F10": 109, "F11": 103, "F12": 111,
  ]) { current, _ in current }

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

  /// The renderer's `androidKeycodeMap.ts` beyond typing.
  static let androidHardwareCodes: [String: Int] = androidCodes.merging([
    "F1": 131, "F2": 132, "F3": 133, "F4": 134, "F5": 135, "F6": 136, "F7": 137,
    "F8": 138, "F9": 139, "F10": 140, "F11": 141, "F12": 142,
    "ShiftLeft": 59, "ShiftRight": 60, "ControlLeft": 113, "ControlRight": 114,
    "AltLeft": 57, "AltRight": 58, "MetaLeft": 117, "MetaRight": 118, "CapsLock": 115,
    "Home": 3, "End": 123, "PageUp": 92, "PageDown": 93,
  ]) { current, _ in current }

  /// macOS virtual keycode → physical key name; the simulator's own codes are
  /// macOS ones, so this is their inverse.
  static let codeByMacKeyCode: [Int: String] = Dictionary(
    iosHardwareCodes.map { ($0.value, $0.key) }, uniquingKeysWith: { first, _ in first })

  /// `NSEvent.ModifierFlags` raw values, which are also what the iOS bridge takes.
  public enum MacModifier {
    public static let capsLock = 0x10000
    public static let shift = 0x20000
    public static let control = 0x40000
    public static let option = 0x80000
    public static let command = 0x100000
  }

  /// The physical key a macOS `NSEvent.keyCode` names, e.g. `KeyH` or `ArrowUp`.
  public static func code(macKeyCode: Int) -> String? {
    codeByMacKeyCode[macKeyCode]
  }

  /// A Mac key event to the device's own key code and modifiers; nil for keys
  /// the device has no equivalent of.
  public static func nativeKey(platform: RemotePlatform, macKeyCode: Int, modifierFlags: Int)
    -> NativeKey?
  {
    guard let code = code(macKeyCode: macKeyCode) else { return nil }
    switch platform {
    case .ios:
      let mask =
        MacModifier.capsLock | MacModifier.shift | MacModifier.control | MacModifier.option
        | MacModifier.command
      return NativeKey(keyCode: macKeyCode, modifiers: modifierFlags & mask)
    case .android:
      guard let keyCode = androidHardwareCodes[code] else { return nil }
      var meta = 0
      if modifierFlags & MacModifier.shift != 0 { meta |= 0x1 }
      if modifierFlags & MacModifier.option != 0 { meta |= 0x2 }
      if modifierFlags & MacModifier.control != 0 { meta |= 0x1000 }
      if modifierFlags & MacModifier.command != 0 { meta |= 0x10000 }
      return NativeKey(keyCode: keyCode, modifiers: meta)
    }
  }

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
