import AppKit
import ArgusCore
import CoreGraphics

/// The mirror's mouse and keyboard, posted straight to the app's process so they
/// land without moving the pointer or bringing the app forward. macOS drops
/// them unless Argus has Accessibility.
@MainActor
struct MacAppInput {
  let window: MacAppWindow
  /// Where the window is now, in global points.
  let frame: CGRect
  let stage: CGSize

  /// `CGEventField` has no names for these: the window a click is meant for,
  /// which a background app needs to route it.
  private static let windowUnderPointer = CGEventField(rawValue: 91)!
  private static let windowThatCanHandle = CGEventField(rawValue: 92)!
  /// ⇧⌃⌥⌘ and the rest arrive as their own key events; their flags ride on the next key instead.
  private static let modifierKeys: Set<Int> = [54, 55, 56, 57, 58, 59, 60, 61, 62, 63]

  private static let source = CGEventSource(stateID: .hidSystemState)

  /// Whether anything was sent.
  func post(_ input: RuntimeInput, clickCount: Int) -> Bool {
    switch input {
    case .pointer(let phase, let point, let secondary, _):
      guard let at = MacAppMirrorGeometry.screenPoint(point, stage: stage, window: frame) else { return false }
      let type: CGEventType =
        switch (phase, secondary) {
        case (.down, false): .leftMouseDown
        case (.down, true): .rightMouseDown
        case (.move, _): .leftMouseDragged
        case (.up, false): .leftMouseUp
        case (.up, true): .rightMouseUp
        }
      guard
        let event = CGEvent(
          mouseEventSource: Self.source, mouseType: type, mouseCursorPosition: at,
          mouseButton: secondary ? .right : .left)
      else { return false }
      event.setIntegerValueField(.mouseEventClickState, value: Int64(clickCount))
      event.setIntegerValueField(Self.windowUnderPointer, value: Int64(window.windowId))
      event.setIntegerValueField(Self.windowThatCanHandle, value: Int64(window.windowId))
      event.postToPid(window.pid)
      return true
    case .wheel(let point, let deltaX, let deltaY):
      guard let at = MacAppMirrorGeometry.screenPoint(point, stage: stage, window: frame),
        // RuntimeInput's deltas are the web's: positive scrolls down, which is a negative wheel here.
        let event = CGEvent(
          scrollWheelEvent2Source: Self.source, units: .pixel, wheelCount: 2, wheel1: Int32(-deltaY),
          wheel2: Int32(-deltaX), wheel3: 0)
      else { return false }
      event.location = at
      event.postToPid(window.pid)
      return true
    case .key(let down, let keyCode, let modifiers, let characters):
      guard !Self.modifierKeys.contains(keyCode),
        let event = CGEvent(keyboardEventSource: Self.source, virtualKey: CGKeyCode(keyCode), keyDown: down)
      else { return false }
      let flags = NSEvent.ModifierFlags(rawValue: UInt(modifiers)).intersection(.deviceIndependentFlagsMask)
      event.flags = CGEventFlags(rawValue: UInt64(flags.rawValue))
      // The typed text, so a non-US layout types what the user pressed rather than its US key.
      if down, let characters, !characters.isEmpty, flags.isDisjoint(with: [.command, .control]) {
        let units = Array(characters.utf16)
        event.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
      }
      event.postToPid(window.pid)
      return true
    case .hover:
      return false
    }
  }
}
