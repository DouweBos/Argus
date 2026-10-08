import AppKit
@preconcurrency import CodeEditTextView

/// What the text view hands back to the editor: key commands, menus, pointer gestures.
@MainActor protocol ArgusTextViewHost: AnyObject {
  /// Return true when the command was handled.
  func textView(_ textView: ArgusTextView, doCommand selector: Selector) -> Bool
  /// A key before it's typed; true when it was an editor shortcut.
  func textView(_ textView: ArgusTextView, keyDown event: NSEvent) -> Bool
  func contextMenu(for textView: ArgusTextView, at offset: Int?) -> NSMenu
  func textView(_ textView: ArgusTextView, commandClickedAt offset: Int)
  func textView(_ textView: ArgusTextView, mouseMovedTo offset: Int?, at point: NSPoint)
  func textViewMouseExited(_ textView: ArgusTextView)
  func textView(_ textView: ArgusTextView, performFindAction action: FindAction) -> Bool
  func textViewDidBecomeFirstResponder(_ textView: ArgusTextView)
  func textViewDidResignFirstResponder(_ textView: ArgusTextView)
}

enum FindAction {
  case show, showReplace, next, previous, useSelection
}

/// CodeEditTextView's view with Argus's hooks. Keys go through `doCommand(by:)` and the responder
/// chain (Find menu items, the context menu), never through an app-wide event monitor.
final class ArgusTextView: TextView, NSGestureRecognizerDelegate, NSMenuItemValidation {
  weak var host: ArgusTextViewHost?
  private var trackingArea: NSTrackingArea?

  func installGestures() {
    let click = NSClickGestureRecognizer(target: self, action: #selector(handleCommandClick(_:)))
    click.delegate = self
    click.delaysPrimaryMouseButtonEvents = true
    addGestureRecognizer(click)
  }

  // MARK: Keys

  /// ⌥ keys reach here before any key equivalent: editor shortcuts on them must win over typing.
  override func keyDown(with event: NSEvent) {
    if host?.textView(self, keyDown: event) == true { return }
    super.keyDown(with: event)
  }

  override func doCommand(by selector: Selector) {
    if host?.textView(self, doCommand: selector) == true { return }
    super.doCommand(by: selector)
  }

  override func becomeFirstResponder() -> Bool {
    let accepted = super.becomeFirstResponder()
    if accepted { host?.textViewDidBecomeFirstResponder(self) }
    return accepted
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window == nil { host?.textViewDidResignFirstResponder(self) }
  }

  override func resignFirstResponder() -> Bool {
    let resigned = super.resignFirstResponder()
    if resigned { host?.textViewDidResignFirstResponder(self) }
    return resigned
  }

  // MARK: Find (the standard Find menu items arrive here through the responder chain)

  @objc override func performTextFinderAction(_ sender: Any?) {
    guard let tag = (sender as? NSValidatedUserInterfaceItem)?.tag,
      let action = NSTextFinder.Action(rawValue: tag)
    else { return }
    _ = performFind(action)
  }

  @objc func performFindPanelAction(_ sender: Any?) {
    performTextFinderAction(sender)
  }

  private func performFind(_ action: NSTextFinder.Action) -> Bool {
    let mapped: FindAction? =
      switch action {
      case .showFindInterface: .show
      case .showReplaceInterface: .showReplace
      case .nextMatch: .next
      case .previousMatch: .previous
      case .setSearchString: .useSelection
      default: nil
      }
    guard let mapped else { return false }
    return host?.textView(self, performFindAction: mapped) ?? false
  }

  func validateMenuItem(_ item: NSMenuItem) -> Bool {
    if item.action == #selector(performTextFinderAction(_:)) || item.action == #selector(performFindPanelAction(_:)) {
      guard let action = NSTextFinder.Action(rawValue: item.tag) else { return false }
      return [.showFindInterface, .showReplaceInterface, .nextMatch, .previousMatch, .setSearchString].contains(action)
    }
    return item.action.map { responds(to: $0) } ?? false
  }

  // MARK: Pointer

  override func rightMouseDown(with event: NSEvent) {
    let point = convert(event.locationInWindow, from: nil)
    let offset = layoutManager.textOffsetAtPoint(point)
    if let offset, !selectionManager.textSelections.contains(where: { $0.range.contains(offset) || $0.range.max == offset }) {
      selectionManager.setSelectedRange(NSRange(location: offset, length: 0))
    }
    guard let menu = host?.contextMenu(for: self, at: offset) else { return super.rightMouseDown(with: event) }
    NSMenu.popUpContextMenu(menu, with: event, for: self)
  }

  @objc private func handleCommandClick(_ recognizer: NSClickGestureRecognizer) {
    guard recognizer.state == .ended else { return }
    let point = recognizer.location(in: self)
    guard let offset = layoutManager.textOffsetAtPoint(point) else { return }
    selectionManager.setSelectedRange(NSRange(location: offset, length: 0))
    host?.textView(self, commandClickedAt: offset)
  }

  func gestureRecognizer(_ gestureRecognizer: NSGestureRecognizer, shouldAttemptToRecognizeWith event: NSEvent) -> Bool {
    event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea { removeTrackingArea(trackingArea) }
    let area = NSTrackingArea(
      rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
    addTrackingArea(area)
    trackingArea = area
  }

  override func mouseMoved(with event: NSEvent) {
    super.mouseMoved(with: event)
    let point = convert(event.locationInWindow, from: nil)
    host?.textView(self, mouseMovedTo: characterOffset(at: point), at: point)
  }

  override func mouseExited(with event: NSEvent) {
    super.mouseExited(with: event)
    host?.textViewMouseExited(self)
  }

  /// The character under `point`, or nil past the end of a line (so hovering empty space shows nothing).
  func characterOffset(at point: NSPoint) -> Int? {
    guard let offset = layoutManager.textOffsetAtPoint(point),
      let line = layoutManager.textLineForOffset(offset),
      let rect = layoutManager.rectForOffset(offset)
    else { return nil }
    if point.x > rect.maxX + 12, offset >= line.range.max - 1 { return nil }
    return offset
  }
}
