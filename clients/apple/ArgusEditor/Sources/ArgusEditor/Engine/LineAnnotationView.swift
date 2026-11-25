import AppKit
@preconcurrency import CodeEditTextView

/// The caret line's end-of-line annotation, over the text so it takes its own clicks.
final class LineAnnotationView: NSView {
  /// Between the line's last character and the annotation.
  static let gap: CGFloat = 32

  private var annotation: EditorLineAnnotation?
  private var attributed = NSAttributedString()

  override var isFlipped: Bool { true }

  override func hitTest(_ point: NSPoint) -> NSView? {
    annotation?.action == nil ? nil : super.hitTest(point)
  }

  /// Places `annotation` after the line's last character, `lineEnd` in text view coordinates, or hides it.
  func show(_ annotation: EditorLineAnnotation?, after lineEnd: NSRect?, maxX: CGFloat, font: NSFont, color: NSColor) {
    guard let annotation, let lineEnd else { return hide() }
    self.annotation = annotation
    let style = NSMutableParagraphStyle()
    style.lineBreakMode = .byTruncatingTail
    attributed = NSAttributedString(
      string: annotation.text, attributes: [.font: font, .foregroundColor: color, .paragraphStyle: style])
    let x = lineEnd.minX + Self.gap
    let width = min(ceil(attributed.size().width), maxX - x)
    // No room left on the line: an annotation clipped to a few characters says nothing.
    guard width > 48 else { return hide() }
    let target = NSRect(x: x, y: lineEnd.minY, width: width, height: lineEnd.height)
    if frame != target {
      frame = target
      window?.invalidateCursorRects(for: self)
    }
    toolTip = annotation.help
    isHidden = false
    needsDisplay = true
  }

  private func hide() {
    guard !isHidden || annotation != nil else { return }
    annotation = nil
    toolTip = nil
    isHidden = true
  }

  override func draw(_ dirtyRect: NSRect) {
    let height = attributed.size().height
    let rect = NSRect(x: 0, y: (bounds.height - height) / 2, width: bounds.width, height: height)
    attributed.draw(with: rect, options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
  }

  override func resetCursorRects() {
    if annotation?.action != nil { addCursorRect(bounds, cursor: .pointingHand) }
  }

  override func mouseDown(with event: NSEvent) {
    annotation?.action?()
  }
}
