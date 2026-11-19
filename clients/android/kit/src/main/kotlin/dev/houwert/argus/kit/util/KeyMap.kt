package dev.houwert.argus.kit.util

import dev.houwert.argus.kit.protocol.generated.RemotePlatform

/**
 * Typed characters to the key codes the device bridges expect: macOS virtual keycodes for
 * iOS simulators, Android `KEYCODE_*` for emulators. Keyed by physical code, which is layout-stable.
 */
object KeyMap {
  data class NativeKey(val keyCode: Int, val modifiers: Int)

  /** `NSEventModifierFlagShift`: carries capitalisation and shifted symbols. */
  internal const val IOS_SHIFT = 0x20000

  /** `AMETA_SHIFT_ON`. */
  internal const val ANDROID_SHIFT = 0x1

  // macOS virtual keycodes (kVK_*).
  internal val iosCodes: Map<String, Int> = mapOf(
    "KeyA" to 0, "KeyS" to 1, "KeyD" to 2, "KeyF" to 3, "KeyH" to 4, "KeyG" to 5, "KeyZ" to 6, "KeyX" to 7,
    "KeyC" to 8, "KeyV" to 9, "KeyB" to 11, "KeyQ" to 12, "KeyW" to 13, "KeyE" to 14, "KeyR" to 15,
    "KeyY" to 16, "KeyT" to 17, "KeyO" to 31, "KeyU" to 32, "KeyI" to 34, "KeyP" to 35, "KeyL" to 37,
    "KeyJ" to 38, "KeyK" to 40, "KeyN" to 45, "KeyM" to 46,
    "Digit1" to 18, "Digit2" to 19, "Digit3" to 20, "Digit4" to 21, "Digit5" to 23, "Digit6" to 22,
    "Digit7" to 26, "Digit8" to 28, "Digit9" to 25, "Digit0" to 29,
    "Enter" to 36, "Tab" to 48, "Space" to 49, "Backspace" to 51, "Escape" to 53, "Delete" to 117,
    "ArrowLeft" to 123, "ArrowRight" to 124, "ArrowDown" to 125, "ArrowUp" to 126,
    "Minus" to 27, "Equal" to 24, "BracketLeft" to 33, "BracketRight" to 30, "Backslash" to 42,
    "Semicolon" to 41, "Quote" to 39, "Comma" to 43, "Period" to 47, "Slash" to 44, "Backquote" to 50,
  )

  /** What a hardware keyboard sends beyond typing, as in the renderer's `keycodeMap.ts`. */
  internal val iosHardwareCodes: Map<String, Int> = mapOf(
    "Home" to 115, "End" to 119, "PageUp" to 116, "PageDown" to 121,
    "ShiftLeft" to 56, "ShiftRight" to 60, "ControlLeft" to 59, "ControlRight" to 62,
    "AltLeft" to 58, "AltRight" to 61, "MetaLeft" to 55, "MetaRight" to 54, "CapsLock" to 57,
    "F1" to 122, "F2" to 120, "F3" to 99, "F4" to 118, "F5" to 96, "F6" to 97, "F7" to 98, "F8" to 100,
    "F9" to 101, "F10" to 109, "F11" to 103, "F12" to 111,
  ) + iosCodes

  // Android KEYCODE_* values.
  internal val androidCodes: Map<String, Int> = mapOf(
    "KeyA" to 29, "KeyB" to 30, "KeyC" to 31, "KeyD" to 32, "KeyE" to 33, "KeyF" to 34, "KeyG" to 35,
    "KeyH" to 36, "KeyI" to 37, "KeyJ" to 38, "KeyK" to 39, "KeyL" to 40, "KeyM" to 41, "KeyN" to 42,
    "KeyO" to 43, "KeyP" to 44, "KeyQ" to 45, "KeyR" to 46, "KeyS" to 47, "KeyT" to 48, "KeyU" to 49,
    "KeyV" to 50, "KeyW" to 51, "KeyX" to 52, "KeyY" to 53, "KeyZ" to 54,
    "Digit0" to 7, "Digit1" to 8, "Digit2" to 9, "Digit3" to 10, "Digit4" to 11, "Digit5" to 12,
    "Digit6" to 13, "Digit7" to 14, "Digit8" to 15, "Digit9" to 16,
    "Space" to 62, "Enter" to 66, "Backspace" to 67, "Tab" to 61, "Escape" to 111, "Delete" to 112,
    "ArrowUp" to 19, "ArrowDown" to 20, "ArrowLeft" to 21, "ArrowRight" to 22,
    "Comma" to 55, "Period" to 56, "Minus" to 69, "Equal" to 70, "BracketLeft" to 71,
    "BracketRight" to 72, "Backslash" to 73, "Semicolon" to 74, "Quote" to 75, "Slash" to 76,
    "Backquote" to 68,
  )

  /** The renderer's `androidKeycodeMap.ts` beyond typing. */
  internal val androidHardwareCodes: Map<String, Int> = mapOf(
    "F1" to 131, "F2" to 132, "F3" to 133, "F4" to 134, "F5" to 135, "F6" to 136, "F7" to 137,
    "F8" to 138, "F9" to 139, "F10" to 140, "F11" to 141, "F12" to 142,
    "ShiftLeft" to 59, "ShiftRight" to 60, "ControlLeft" to 113, "ControlRight" to 114,
    "AltLeft" to 57, "AltRight" to 58, "MetaLeft" to 117, "MetaRight" to 118, "CapsLock" to 115,
    "Home" to 3, "End" to 123, "PageUp" to 92, "PageDown" to 93,
  ) + androidCodes

  /** macOS keycode to physical key name; the simulator's own codes are macOS ones, so this is their inverse. */
  internal val codeByMacKeyCode: Map<Int, String> = buildMap {
    for ((code, keyCode) in iosHardwareCodes) putIfAbsent(keyCode, code)
  }

  /** `NSEvent.ModifierFlags` raw values, which are also what the iOS bridge takes. */
  object MacModifier {
    const val CAPS_LOCK = 0x10000
    const val SHIFT = 0x20000
    const val CONTROL = 0x40000
    const val OPTION = 0x80000
    const val COMMAND = 0x100000
  }

  /** The physical key a macOS `NSEvent.keyCode` names, e.g. `KeyH` or `ArrowUp`. */
  fun code(macKeyCode: Int): String? = codeByMacKeyCode[macKeyCode]

  /** A Mac key event to the device's key code and modifiers; null for keys the device has no equivalent of. */
  fun nativeKey(platform: RemotePlatform, macKeyCode: Int, modifierFlags: Int): NativeKey? {
    val code = code(macKeyCode) ?: return null
    return when (platform) {
      RemotePlatform.ios -> {
        val mask = MacModifier.CAPS_LOCK or MacModifier.SHIFT or MacModifier.CONTROL or MacModifier.OPTION or
          MacModifier.COMMAND
        NativeKey(macKeyCode, modifierFlags and mask)
      }
      RemotePlatform.android -> {
        val keyCode = androidHardwareCodes[code] ?: return null
        var meta = 0
        if (modifierFlags and MacModifier.SHIFT != 0) meta = meta or 0x1
        if (modifierFlags and MacModifier.OPTION != 0) meta = meta or 0x2
        if (modifierFlags and MacModifier.CONTROL != 0) meta = meta or 0x1000
        if (modifierFlags and MacModifier.COMMAND != 0) meta = meta or 0x10000
        NativeKey(keyCode, meta)
      }
      else -> null
    }
  }

  fun nativeKey(platform: RemotePlatform, code: String, shift: Boolean): NativeKey? = when (platform) {
    RemotePlatform.ios -> iosCodes[code]?.let { NativeKey(it, if (shift) IOS_SHIFT else 0) }
    RemotePlatform.android -> androidCodes[code]?.let { NativeKey(it, if (shift) ANDROID_SHIFT else 0) }
    else -> null
  }

  private val symbolCodes: Map<Char, Pair<String, Boolean>> = mapOf(
    ' ' to ("Space" to false), '\n' to ("Enter" to false),
    '-' to ("Minus" to false), '_' to ("Minus" to true),
    '=' to ("Equal" to false), '+' to ("Equal" to true),
    '[' to ("BracketLeft" to false), '{' to ("BracketLeft" to true),
    ']' to ("BracketRight" to false), '}' to ("BracketRight" to true),
    '\\' to ("Backslash" to false), '|' to ("Backslash" to true),
    ';' to ("Semicolon" to false), ':' to ("Semicolon" to true),
    '\'' to ("Quote" to false), '"' to ("Quote" to true),
    ',' to ("Comma" to false), '<' to ("Comma" to true),
    '.' to ("Period" to false), '>' to ("Period" to true),
    '/' to ("Slash" to false), '?' to ("Slash" to true),
    '`' to ("Backquote" to false), '~' to ("Backquote" to true),
  )

  private val shiftedDigits: Map<Char, String> = mapOf(
    '!' to "Digit1", '@' to "Digit2", '#' to "Digit3", '$' to "Digit4", '%' to "Digit5",
    '^' to "Digit6", '&' to "Digit7", '*' to "Digit8", '(' to "Digit9", ')' to "Digit0",
  )

  /** One character, or the literal "Backspace" / "Enter", to a key press. */
  fun nativeKey(platform: RemotePlatform, character: String): NativeKey? {
    if (character == "Backspace") return nativeKey(platform, "Backspace", false)
    if (character == "Enter" || character == "\n") return nativeKey(platform, "Enter", false)
    if (character.length != 1) return null
    val c = character[0]
    return when {
      c.isLetter() && c.isLowerCase() -> nativeKey(platform, "Key${c.uppercaseChar()}", false)
      c.isLetter() && c.isUpperCase() -> nativeKey(platform, "Key$c", true)
      c in '0'..'9' -> nativeKey(platform, "Digit$c", false)
      c in shiftedDigits -> nativeKey(platform, shiftedDigits.getValue(c), true)
      c in symbolCodes -> symbolCodes.getValue(c).let { (code, shift) -> nativeKey(platform, code, shift) }
      else -> null
    }
  }

  /** Named DOM `KeyboardEvent.key` values for keys that type nothing. */
  internal val domNamedKeys: Map<String, String> = mapOf(
    "Enter" to "Enter", "Tab" to "Tab", "Backspace" to "Backspace", "Escape" to "Escape",
    "Delete" to "Delete", "ArrowLeft" to "ArrowLeft", "ArrowRight" to "ArrowRight",
    "ArrowUp" to "ArrowUp", "ArrowDown" to "ArrowDown", "Home" to "Home", "End" to "End",
    "PageUp" to "PageUp", "PageDown" to "PageDown", "ShiftLeft" to "Shift", "ShiftRight" to "Shift",
    "ControlLeft" to "Control", "ControlRight" to "Control", "AltLeft" to "Alt", "AltRight" to "Alt",
    "MetaLeft" to "Meta", "MetaRight" to "Meta", "CapsLock" to "CapsLock",
    "F1" to "F1", "F2" to "F2", "F3" to "F3", "F4" to "F4", "F5" to "F5", "F6" to "F6", "F7" to "F7",
    "F8" to "F8", "F9" to "F9", "F10" to "F10", "F11" to "F11", "F12" to "F12",
  )

  /** A Mac key event as the DOM's `KeyboardEvent.key`, which the browser view forwards: a named key, else its character. */
  fun domKey(macKeyCode: Int, characters: String?): String? {
    code(macKeyCode)?.let { code -> domNamedKeys[code]?.let { return it } }
    if (characters == null || characters.codePointCount(0, characters.length) != 1) return null
    val scalar = characters.codePointAt(0)
    val type = Character.getType(scalar)
    // Foundation's controlCharacters set is Cc and Cf.
    if (type == Character.CONTROL.toInt() || type == Character.FORMAT.toInt()) return null
    // AppKit's private-use range for function keys it has no name for.
    if (scalar in 0xF700..0xF8FF) return null
    return characters
  }
}
