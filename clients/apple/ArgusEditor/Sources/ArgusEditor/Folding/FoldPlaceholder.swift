import AppKit
@preconcurrency import CodeEditTextView

/// The `…` a folded range shows as. The text stays in the buffer; the engine lays this out in its
/// place. Double-click or Return on it unfolds (the engine discards it, `FoldingController` hears).
final class FoldPlaceholder: TextAttachment {
  var isSelected = false
  private let font: NSFont
  private let color: NSColor
  private let fill: NSColor
  private let selectedFill: NSColor
  private static let label: String = "…"

  init(font: NSFont, color: NSColor, fill: NSColor, selectedFill: NSColor) {
    self.font = font
    self.color = color
    self.fill = fill
    self.selectedFill = selectedFill
  }

  var width: CGFloat {
    ceil((Self.label as NSString).size(withAttributes: [.font: font]).width) + 10
  }

  func draw(in context: CGContext, rect: NSRect) {
    NSGraphicsContext.saveGraphicsState()
    defer { NSGraphicsContext.restoreGraphicsState() }
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: true)
    let size = (Self.label as NSString).size(withAttributes: [.font: font])
    let box = NSRect(x: rect.minX + 1, y: rect.midY - size.height / 2 - 1, width: rect.width - 2, height: size.height + 2)
    (isSelected ? selectedFill : fill).setFill()
    NSBezierPath(roundedRect: box, xRadius: 3, yRadius: 3).fill()
    (Self.label as NSString).draw(
      at: NSPoint(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2),
      withAttributes: [.font: font, .foregroundColor: color])
  }
}
