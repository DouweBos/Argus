import AppKit
import ArgusUI
import GroveKit
import SwiftUI

/// Sizes every diff row shares; monospaced, so a line's width is its length.
@MainActor
enum DiffMetrics {
  static var font: NSFont { .monospacedSystemFont(ofSize: TextScale.shared(11.5), weight: .regular) }
  static var gutterFont: NSFont { .monospacedSystemFont(ofSize: TextScale.shared(10.5), weight: .regular) }
  static var lineHeight: CGFloat { TextScale.shared(17).rounded() }
  static var headerHeight: CGFloat { TextScale.shared(28).rounded() }
  static var charWidth: CGFloat { ("M" as NSString).size(withAttributes: [.font: font]).width }
  static var gutterWidth: CGFloat { TextScale.shared(40).rounded() }
  /// The gutter strip the comment `+` sits in, at a line's (or a split side's) leading edge.
  static var commentButtonWidth: CGFloat { TextScale.shared(20).rounded() }

  /// Where a unified line's text starts, after its gutters.
  static func textX(gutters: DiffGutters) -> CGFloat {
    gutterWidth * CGFloat(gutters.count) + 20
  }
}

/// Peacock's diff colours, resolved to AppKit for the current appearance.
struct DiffPalette: Equatable {
  let text: NSColor
  let muted: NSColor
  let added: NSColor
  let addedBackground: NSColor
  let removed: NSColor
  let removedBackground: NSColor
  let headerBackground: NSColor
  let empty: NSColor
  let accent: NSColor
  let onAccent: NSColor

  init(_ theme: Theme) {
    text = NSColor(theme.text)
    muted = NSColor(theme.textMuted)
    added = NSColor(theme.success)
    addedBackground = NSColor(theme.successSoft)
    removed = NSColor(theme.error)
    removedBackground = NSColor(theme.errorSoft)
    headerBackground = NSColor(theme.bgTertiary)
    empty = NSColor(theme.bgHover)
    accent = NSColor(theme.accent)
    onAccent = NSColor(theme.onAccent)
  }
}

/// One line, or a side-by-side pair, drawn directly: no subviews per row.
final class DiffLineView: NSView {
  static let identifier = NSUserInterfaceItemIdentifier("DiffLineView")
  private var row: DiffRow?
  private var lines: [GroveKit.DiffLine] = []
  private var palette: DiffPalette?
  private var gutters = DiffGutters.both
  /// Where the comment `+` shows, while the pointer is over the line.
  var hoverSide: DiffHoverSide? {
    didSet { if hoverSide != oldValue { needsDisplay = true } }
  }

  convenience init() {
    self.init(frame: .zero)
    identifier = Self.identifier
  }

  override var isFlipped: Bool { true }

  func configure(row: DiffRow, hunk: HunkData, palette: DiffPalette, gutters: DiffGutters) {
    self.row = row
    lines = hunk.lines
    self.palette = palette
    self.gutters = gutters
    needsDisplay = true
  }

  override func draw(_ dirtyRect: NSRect) {
    guard let row, let palette else { return }
    switch row.kind {
    case .header, .comment: break
    case .line(let i):
      let line = lines[i]
      let numbers: [Int?] =
        switch gutters {
        case .both: [line.oldLineNumber, line.newLineNumber]
        case .old: [line.oldLineNumber]
        case .new: [line.newLineNumber]
        }
      draw(line, in: bounds, palette: palette, gutters: numbers)
    case .pair(let left, let right):
      let half = floor(bounds.width / 2)
      let leftRect = NSRect(x: 0, y: 0, width: half, height: bounds.height)
      let rightRect = NSRect(x: half, y: 0, width: bounds.width - half, height: bounds.height)
      drawSide(left.map { lines[$0] }, in: leftRect, number: \.oldLineNumber, palette: palette)
      drawSide(right.map { lines[$0] }, in: rightRect, number: \.newLineNumber, palette: palette)
      palette.muted.withAlphaComponent(0.3).setFill()
      NSRect(x: half, y: 0, width: 1, height: bounds.height).fill()
    }
    if let hoverSide { drawCommentButton(at: hoverSide == .right ? floor(bounds.width / 2) : 0, palette: palette) }
  }

  /// The gutter's `+` for commenting on the line.
  private func drawCommentButton(at x: CGFloat, palette: DiffPalette) {
    let size = min(bounds.height - 2, DiffMetrics.commentButtonWidth - 4)
    let rect = NSRect(x: x + 2, y: (bounds.height - size) / 2, width: size, height: size)
    palette.accent.setFill()
    NSBezierPath(roundedRect: rect, xRadius: 4, yRadius: 4).fill()
    palette.onAccent.setStroke()
    let plus = NSBezierPath()
    plus.lineWidth = 1.5
    let inset = size * 0.28
    plus.move(to: NSPoint(x: rect.midX, y: rect.minY + inset))
    plus.line(to: NSPoint(x: rect.midX, y: rect.maxY - inset))
    plus.move(to: NSPoint(x: rect.minX + inset, y: rect.midY))
    plus.line(to: NSPoint(x: rect.maxX - inset, y: rect.midY))
    plus.stroke()
  }

  private func drawSide(
    _ line: GroveKit.DiffLine?, in rect: NSRect, number: KeyPath<GroveKit.DiffLine, Int?>, palette: DiffPalette
  ) {
    guard let line else {
      palette.empty.setFill()
      rect.fill()
      return
    }
    NSGraphicsContext.saveGraphicsState()
    NSBezierPath(rect: rect).addClip()
    draw(line, in: rect, palette: palette, gutters: [line[keyPath: number]])
    NSGraphicsContext.restoreGraphicsState()
  }

  private func draw(_ line: GroveKit.DiffLine, in rect: NSRect, palette: DiffPalette, gutters: [Int?]) {
    let (background, color, sign): (NSColor?, NSColor, String) =
      switch line.type {
      case .addition: (palette.addedBackground, palette.text, "+")
      case .deletion: (palette.removedBackground, palette.text, "-")
      case .context: (nil, palette.text, " ")
      }
    if let background {
      background.setFill()
      rect.fill()
    }
    let gutterAttributes: [NSAttributedString.Key: Any] = [.font: DiffMetrics.gutterFont, .foregroundColor: palette.muted]
    var x = rect.minX
    for number in gutters {
      let text = number.map(String.init) ?? ""
      let size = (text as NSString).size(withAttributes: gutterAttributes)
      (text as NSString).draw(
        at: NSPoint(x: x + DiffMetrics.gutterWidth - size.width - 6, y: rect.minY + 2), withAttributes: gutterAttributes)
      x += DiffMetrics.gutterWidth
    }
    let signColor = line.type == .addition ? palette.added : line.type == .deletion ? palette.removed : palette.muted
    (sign as NSString).draw(
      at: NSPoint(x: x + 4, y: rect.minY + 1), withAttributes: [.font: DiffMetrics.font, .foregroundColor: signColor])
    let text = line.content.replacingOccurrences(of: "\t", with: "    ")
    (text as NSString).draw(
      at: NSPoint(x: x + 16, y: rect.minY + 1), withAttributes: [.font: DiffMetrics.font, .foregroundColor: color])
  }
}

/// A hunk's `@@` line and its staging buttons.
final class DiffHunkHeaderView: NSView {
  static let identifier = NSUserInterfaceItemIdentifier("DiffHunkHeaderView")
  private let label = NSTextField(labelWithString: "")
  private let buttons = NSStackView()
  private var perform: ((HunkAction) -> Void)?
  private var palette: DiffPalette?

  convenience init() {
    self.init(frame: .zero)
    identifier = Self.identifier
    label.font = DiffMetrics.gutterFont
    label.lineBreakMode = .byTruncatingTail
    label.translatesAutoresizingMaskIntoConstraints = false
    buttons.orientation = .horizontal
    buttons.spacing = 6
    buttons.translatesAutoresizingMaskIntoConstraints = false
    addSubview(label)
    addSubview(buttons)
    NSLayoutConstraint.activate([
      label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 10),
      label.centerYAnchor.constraint(equalTo: centerYAnchor),
      // Next to the label, not at the far edge: a wide diff scrolls sideways.
      buttons.leadingAnchor.constraint(equalTo: label.trailingAnchor, constant: 12),
      buttons.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -8),
      buttons.centerYAnchor.constraint(equalTo: centerYAnchor),
    ])
  }

  func configure(hunk: HunkData, palette: DiffPalette, buttons: [(String, HunkAction)], perform: @escaping (HunkAction) -> Void) {
    self.palette = palette
    self.perform = perform
    label.stringValue = hunk.header
    label.textColor = palette.muted
    setButtons(buttons)
    needsDisplay = true
  }

  func setButtons(_ items: [(String, HunkAction)]) {
    buttons.arrangedSubviews.forEach { $0.removeFromSuperview() }
    for (title, action) in items {
      let button = ActionButton(title: title, target: nil, action: nil)
      button.bezelStyle = .push
      button.controlSize = .small
      button.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
      button.hunkAction = action
      button.target = self
      button.action = #selector(tapped(_:))
      button.setAccessibilityLabel(title)
      buttons.addArrangedSubview(button)
    }
  }

  @objc private func tapped(_ sender: ActionButton) {
    if let action = sender.hunkAction { perform?(action) }
  }

  override func draw(_ dirtyRect: NSRect) {
    palette?.headerBackground.setFill()
    bounds.fill()
  }

  private final class ActionButton: NSButton {
    var hunkAction: HunkAction?
  }
}
