import AppKit

/// Gutter + the document's scroll view. The scroll view belongs to the document; this view only
/// borrows it while on screen.
final class EditorContainerView: NSView {
  let gutter = GutterView()
  private(set) var document: EditorDocument?

  override var isFlipped: Bool { true }

  func attach(_ document: EditorDocument) {
    guard self.document !== document else { return }
    detach()
    self.document = document
    gutter.document = document
    addSubview(gutter)
    addSubview(document.engine.scrollView)
    document.onDecorationsChange = { [weak self] in self?.decorationsChanged() }
    decorationsChanged()
    needsLayout = true
  }

  func detach() {
    guard let document else { return }
    document.interaction.completion.dismiss()
    document.interaction.hover.dismiss()
    document.onDecorationsChange = nil
    if document.engine.scrollView.superview === self { document.engine.scrollView.removeFromSuperview() }
    gutter.removeFromSuperview()
    self.document = nil
  }

  override func layout() {
    super.layout()
    guard let document else { return }
    let gutterWidth = gutter.preferredWidth
    gutter.frame = NSRect(x: 0, y: 0, width: gutterWidth, height: bounds.height)
    document.engine.scrollView.frame = NSRect(x: gutterWidth, y: 0, width: max(0, bounds.width - gutterWidth), height: bounds.height)
    document.engine.textView.updateFrameIfNeeded()
    document.engine.viewportChanged()
    if window != nil { document.applyPendingRevealIfAttached() }
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    needsLayout = true
  }

  private func decorationsChanged() {
    guard let document else { return }
    if abs(gutter.frame.width - gutter.preferredWidth) > 0.5 { needsLayout = true }
    gutter.decorationsChanged()
    document.engine.decorations.squiggles = document.diagnostics.map { diagnostic in
      .init(range: document.nsRange(diagnostic.range), color: document.engine.theme.severity(diagnostic.severity))
    }
  }

  /// Editor shortcuts with no standard menu item. Only while the editor has focus — this is not an app-wide monitor.
  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    guard let document, window?.firstResponder === document.engine.textView else {
      return super.performKeyEquivalent(with: event)
    }
    let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask).subtracting([.capsLock, .numericPad, .function])
    let key = event.charactersIgnoringModifiers?.lowercased()
    switch (flags, key) {
    case ([.control], " "):
      document.triggerCompletion()
    case ([.command, .shift], "l"):
      document.sendSelectionToAgent()
    case ([.command, .control], "j"):
      document.goToDefinition()
    case ([.command], "f"):
      document.showFind(replace: false)
    case ([.command, .option], "f"):
      document.showFind(replace: true)
    case ([.command], "g"):
      document.findNext()
    case ([.command, .shift], "g"):
      document.findPrevious()
    default:
      return super.performKeyEquivalent(with: event)
    }
    return true
  }
}
