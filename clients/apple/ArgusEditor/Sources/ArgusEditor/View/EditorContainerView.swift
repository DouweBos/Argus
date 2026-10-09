import AppKit

/// Hosts the document's scroll view (gutter included) while on screen. The scroll view belongs to
/// the document; this view only borrows it.
final class EditorContainerView: NSView {
  private(set) var document: EditorDocument?

  override var isFlipped: Bool { true }

  override init(frame: NSRect) {
    super.init(frame: frame)
    // Nothing the editor draws may spill onto the panes around it.
    clipsToBounds = true
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  func attach(_ document: EditorDocument) {
    guard self.document !== document else { return }
    detach()
    self.document = document
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
    self.document = nil
  }

  override func layout() {
    super.layout()
    guard let document else { return }
    document.engine.scrollView.frame = bounds
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
    let gutter = document.gutter
    if abs(gutter.frame.width - gutter.preferredWidth) > 0.5 { document.engine.layoutGutter() }
    gutter.decorationsChanged()
    document.engine.decorations.squiggles = document.diagnostics.map { diagnostic in
      .init(range: document.nsRange(diagnostic.range), color: document.engine.theme.severity(diagnostic.severity))
    }
  }

  /// Editor keys, ahead of the app's menus (⌘[ indents here, it's Back elsewhere). Only while
  /// the editor has focus — this is not an app-wide monitor.
  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    guard let document, window?.firstResponder === document.engine.textView else {
      return super.performKeyEquivalent(with: event)
    }
    return document.interaction.handleKey(event) || super.performKeyEquivalent(with: event)
  }
}
