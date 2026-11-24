import AppKit

/// A menu item that runs a closure; `NSMenu` only knows target and action.
final class ActionMenuItem: NSMenuItem {
  private let handler: () -> Void

  init(_ title: String, enabled: Bool = true, handler: @escaping () -> Void) {
    self.handler = handler
    super.init(title: title, action: #selector(fire), keyEquivalent: "")
    target = self
    isEnabled = enabled
  }

  @available(*, unavailable)
  required init(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  @objc private func fire() { handler() }
}
