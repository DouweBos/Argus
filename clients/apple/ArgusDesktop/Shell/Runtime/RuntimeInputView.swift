import AppKit
import SwiftUI

/// What a pointer, wheel or key on the runtime surface did, in the view's own
/// top-left coordinates.
enum RuntimeInput {
  enum Phase: Int {
    case down = 0
    case move = 1
    case up = 2
  }

  case pointer(Phase, CGPoint, secondary: Bool)
  case wheel(CGPoint, deltaX: CGFloat, deltaY: CGFloat)
  /// `keyCode` is the macOS virtual keycode; modifier keys arrive as their own
  /// down/up from `flagsChanged`.
  case key(down: Bool, keyCode: Int, modifiers: Int, characters: String?)
}

/// A transparent AppKit surface over a device or browser picture that takes
/// the mouse and the keyboard. SwiftUI's gestures can't see key-ups, modifier
/// keys or the scroll wheel, and a picture has to own focus to type into it.
struct RuntimeInputView: NSViewRepresentable {
  let onInput: (RuntimeInput) -> Void

  func makeNSView(context: Context) -> InputNSView {
    let view = InputNSView()
    view.onInput = onInput
    return view
  }

  func updateNSView(_ view: InputNSView, context: Context) {
    view.onInput = onInput
  }

  final class InputNSView: NSView {
    var onInput: ((RuntimeInput) -> Void)?
    private var lastDrag = Date.distantPast
    private var pressedModifiers: Set<UInt16> = []

    /// As the renderer's `DeviceStage`: ~60 drag samples a second is all the
    /// far end can redraw.
    private static let dragInterval: TimeInterval = 0.017

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    private func location(_ event: NSEvent) -> CGPoint {
      convert(event.locationInWindow, from: nil)
    }

    override func mouseDown(with event: NSEvent) {
      window?.makeFirstResponder(self)
      onInput?(.pointer(.down, location(event), secondary: false))
    }

    override func mouseDragged(with event: NSEvent) {
      let now = Date()
      guard now.timeIntervalSince(lastDrag) >= Self.dragInterval else { return }
      lastDrag = now
      onInput?(.pointer(.move, location(event), secondary: false))
    }

    override func mouseUp(with event: NSEvent) {
      onInput?(.pointer(.up, location(event), secondary: false))
    }

    override func rightMouseDown(with event: NSEvent) {
      window?.makeFirstResponder(self)
      onInput?(.pointer(.down, location(event), secondary: true))
    }

    override func rightMouseUp(with event: NSEvent) {
      onInput?(.pointer(.up, location(event), secondary: true))
    }

    override func scrollWheel(with event: NSEvent) {
      // The web's wheel deltas: pixels, positive means scroll down.
      let scale: CGFloat = event.hasPreciseScrollingDeltas ? 1 : 16
      onInput?(
        .wheel(
          location(event), deltaX: -event.scrollingDeltaX * scale,
          deltaY: -event.scrollingDeltaY * scale))
    }

    override func keyDown(with event: NSEvent) {
      guard !event.isARepeat else { return }
      send(event, down: true)
    }

    override func keyUp(with event: NSEvent) {
      send(event, down: false)
    }

    /// ⌘-combos belong to the app's menus, except ⌘⇧H — the simulator's own
    /// Home shortcut, as in the desktop app.
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
      guard window?.firstResponder === self else { return false }
      let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
      if flags == [.command, .shift], event.charactersIgnoringModifiers?.lowercased() == "h" {
        send(event, down: true)
        send(event, down: false)
        return true
      }
      return false
    }

    override func flagsChanged(with event: NSEvent) {
      let code = event.keyCode
      let down = !pressedModifiers.contains(code)
      if down { pressedModifiers.insert(code) } else { pressedModifiers.remove(code) }
      onInput?(
        .key(
          down: down, keyCode: Int(code), modifiers: Int(event.modifierFlags.rawValue),
          characters: nil))
    }

    override func resignFirstResponder() -> Bool {
      pressedModifiers.removeAll()
      return super.resignFirstResponder()
    }

    private func send(_ event: NSEvent, down: Bool) {
      onInput?(
        .key(
          down: down, keyCode: Int(event.keyCode), modifiers: Int(event.modifierFlags.rawValue),
          characters: event.characters))
    }
  }
}
