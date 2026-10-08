import AppKit

/// Pressing, dragging and hovering transcript text. A drag selects across
/// messages through the shared `TranscriptSelection`, scrolling the
/// transcript when it leaves the top or bottom; a click on a link opens it.
extension TranscriptNSTextView {
  override func mouseDown(with event: NSEvent) {
    guard let window else { return super.mouseDown(with: event) }
    // Word and paragraph selection stay within this text.
    if event.clickCount > 1 {
      selection?.clear()
      super.mouseDown(with: event)
      adoptLocalSelection()
      return
    }
    if window.firstResponder !== self { window.makeFirstResponder(self) }
    let shared = unit != nil ? selection : nil
    let link = link(atWindowPoint: event.locationInWindow)
    let anchor = localIndex(atWindowPoint: event.locationInWindow)
    if let shared, let start = position(atWindowPoint: event.locationInWindow) {
      if event.modifierFlags.contains(.shift) { shared.extend(to: start) } else { shared.begin(at: start) }
    } else {
      setSelectedRange(NSRange(location: anchor, length: 0))
    }

    var dragged = false
    var last = event
    NSEvent.startPeriodicEvents(afterDelay: 0.1, withPeriod: 0.05)
    defer { NSEvent.stopPeriodicEvents() }
    while let next = window.nextEvent(matching: [.leftMouseDragged, .leftMouseUp, .periodic]) {
      if next.type == .leftMouseUp { break }
      if next.type == .leftMouseDragged {
        last = next
        let start = event.locationInWindow
        dragged = dragged || hypot(next.locationInWindow.x - start.x, next.locationInWindow.y - start.y) > 3
      }
      guard dragged else { continue }
      transcriptTable?.autoscroll(with: last)
      let point = last.locationInWindow
      if let shared {
        if let position = shared.position(at: point, in: window) { shared.extend(to: position) }
      } else {
        let index = localIndex(atWindowPoint: point)
        setSelectedRange(NSRange(location: min(anchor, index), length: abs(index - anchor)))
      }
    }
    guard !dragged else { return }
    if let link {
      shared?.clear()
      setSelectedRange(NSRange(location: anchor, length: 0))
      links?.open(link)
    } else if !event.modifierFlags.contains(.shift) {
      shared?.clear()
    }
  }

  /// A double or triple click picked a word or paragraph here; the shared
  /// selection takes it over so ⌘C and other rows agree.
  private func adoptLocalSelection() {
    guard let unit, let selection else { return }
    let range = selectedRange()
    guard range.length > 0 else { return }
    selection.begin(at: .init(unit: unit, index: base + range.location))
    selection.extend(to: .init(unit: unit, index: base + range.location + range.length))
  }

  var transcriptTable: NSView? {
    var view = superview
    while let current = view {
      if current is TranscriptTableView { return current }
      view = current.superview
    }
    return nil
  }

  // MARK: Links

  /// The link under a window point, only when the point is on its text.
  func link(atWindowPoint point: NSPoint) -> URL? {
    guard let storage = textStorage, storage.length > 0, let window else { return nil }
    let screen = window.convertPoint(toScreen: point)
    let index = characterIndex(for: screen)
    guard index != NSNotFound, index < storage.length,
      let url = storage.attribute(.link, at: index, effectiveRange: nil) as? URL
    else { return nil }
    var actual = NSRange()
    let rect = firstRect(forCharacterRange: NSRange(location: index, length: 1), actualRange: &actual)
    return rect.insetBy(dx: -1, dy: -2).contains(screen) ? url : nil
  }

  // MARK: Cursor

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let cursorArea { removeTrackingArea(cursorArea) }
    let area = NSTrackingArea(
      rect: .zero, options: [.mouseMoved, .cursorUpdate, .activeInActiveApp, .inVisibleRect], owner: self)
    addTrackingArea(area)
    cursorArea = area
  }

  override func mouseMoved(with event: NSEvent) {
    updateCursor(event)
  }

  override func cursorUpdate(with event: NSEvent) {
    updateCursor(event)
  }

  private func updateCursor(_ event: NSEvent) {
    (link(atWindowPoint: event.locationInWindow) != nil ? NSCursor.pointingHand : NSCursor.iBeam).set()
  }
}
