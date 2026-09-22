import SwiftUI
import UIKit

/// Turns a hardware keyboard's arrows and Return into d-pad presses.
///
/// `UIKeyCommand` rather than `onKeyPress`: arrows are claimed by UIKit's own
/// focus engine long before SwiftUI sees them, and only a key command taking
/// priority over system behaviour gets them back.
struct HardwareKeyCatcher: UIViewRepresentable {
  /// Button ids as the host names them.
  let press: (String) -> Void

  func makeUIView(context: Context) -> KeyView {
    let view = KeyView()
    view.press = press
    return view
  }

  func updateUIView(_ view: KeyView, context: Context) {
    view.press = press
  }

  final class KeyView: UIView {
    var press: ((String) -> Void)?

    override var canBecomeFirstResponder: Bool { true }

    override func didMoveToWindow() {
      super.didMoveToWindow()
      if window != nil { becomeFirstResponder() }
    }

    override var keyCommands: [UIKeyCommand]? {
      let keys: [(String, String)] = [
        (UIKeyCommand.inputUpArrow, "up"),
        (UIKeyCommand.inputDownArrow, "down"),
        (UIKeyCommand.inputLeftArrow, "left"),
        (UIKeyCommand.inputRightArrow, "right"),
        ("\r", "select"),
        (UIKeyCommand.inputEscape, "menu"),
      ]
      return keys.map { input, button in
        let command = UIKeyCommand(
          action: #selector(handle(_:)), input: input, modifierFlags: [],
          propertyList: button)
        command.wantsPriorityOverSystemBehavior = true
        return command
      }
    }

    @objc private func handle(_ command: UIKeyCommand) {
      guard let button = command.propertyList as? String else { return }
      press?(button)
    }
  }
}
