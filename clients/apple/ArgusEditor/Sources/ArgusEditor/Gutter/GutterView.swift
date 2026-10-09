import AppKit
@preconcurrency import CodeEditTextView
import SwiftUI

/// Line numbers, fold chevrons, git change bars and diagnostic dots. A floating subview of the editor's scroll
/// view (`EditorEngine.install`): its frame is the visible rows in text view coordinates, so it
/// scrolls with the text, is clipped with it, and stays put when the text scrolls sideways.
final class GutterView: NSView {
  weak var document: EditorDocument?
  private var markPopover: NSPopover?
  /// Worst severity per 0-based line.
  private var severities: [Int: DiagnosticSeverity] = [:]
  private var marksByLine: [GutterRow.Mark] = []
  /// Open folds' chevrons show while the pointer is over the gutter, as in VS Code.
  private var isHovering = false {
    didSet { if isHovering != oldValue { needsDisplay = true } }
  }
  private var trackingArea: NSTrackingArea?

  override var isFlipped: Bool { true }

  override init(frame: NSRect) {
    super.init(frame: frame)
    clipsToBounds = true
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  /// The document y of the gutter's top edge.
  private var top: CGFloat { frame.minY }

  override func resetCursorRects() {
    addCursorRect(bounds, cursor: .arrow)
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea { removeTrackingArea(trackingArea) }
    let area = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
    addTrackingArea(area)
    trackingArea = area
  }

  override func mouseEntered(with event: NSEvent) { isHovering = true }

  override func mouseExited(with event: NSEvent) { isHovering = false }

  var preferredWidth: CGFloat {
    guard let document else { return 40 }
    let digits = max(3, String(document.lineIndex.lineCount).count)
    let font = numberFont(document)
    let digitWidth = ("8" as NSString).size(withAttributes: [.font: font]).width
    return ceil(CGFloat(digits) * digitWidth) + GutterRow.dotColumn + GutterRow.foldColumn + GutterRow.markColumn + 6
  }

  func decorationsChanged() {
    guard let document else { return }
    severities = GutterRow.severities(document.diagnostics)
    marksByLine = GutterRow.marks(document.gitMarks)
    needsDisplay = true
  }

  private func numberFont(_ document: EditorDocument) -> NSFont {
    .monospacedDigitSystemFont(ofSize: max(9, document.configuration.fontSize - 2), weight: .regular)
  }

  override func draw(_ dirtyRect: NSRect) {
    guard let document else { return }
    let engine = document.engine
    let theme = engine.theme
    let dirtyRect = dirtyRect.intersection(bounds)
    theme.background.setFill()
    dirtyRect.fill()
    guard let layout = engine.textView.layoutManager else { return }
    let font = numberFont(document)
    let caretLine = document.caret.line
    let lineHeight = layout.estimateLineHeight()
    let numberRight = bounds.width - GutterRow.markColumn - GutterRow.foldColumn - 2
    let folding = document.folding
    for (line, y) in rows(in: dirtyRect) {
      let rowHeight = min(line.height, lineHeight)
      let isCaret = line.index == caretLine
      let label = String(line.index + 1) as NSString
      let attributes: [NSAttributedString.Key: Any] = [
        .font: font, .foregroundColor: isCaret ? theme.lineNumberActive : theme.lineNumber,
      ]
      let size = label.size(withAttributes: attributes)
      label.draw(at: NSPoint(x: numberRight - size.width, y: y + (rowHeight - size.height) / 2), withAttributes: attributes)
      if folding.region(startingAt: line.index) != nil {
        let folded = folding.isFolded(line: line.index)
        if folded || isHovering { drawChevron(folded: folded, y: y, rowHeight: rowHeight, theme: theme) }
      }
      if let severity = severities[line.index] {
        theme.severity(severity).setFill()
        let d: CGFloat = 6
        NSBezierPath(ovalIn: NSRect(x: 4, y: y + (rowHeight - d) / 2, width: d, height: d)).fill()
      }
    }
    drawMarks(layout, top: top, dirtyRect: dirtyRect, theme: theme)
  }

  private func drawChevron(folded: Bool, y: CGFloat, rowHeight: CGFloat, theme: EditorTheme) {
    let configuration = NSImage.SymbolConfiguration(pointSize: 9, weight: .semibold)
      .applying(.init(hierarchicalColor: folded ? theme.lineNumberActive : theme.lineNumber))
    guard
      let image = NSImage(systemSymbolName: folded ? "chevron.right" : "chevron.down", accessibilityDescription: nil)?
        .withSymbolConfiguration(configuration)
    else { return }
    let size = image.size
    let column = GutterRow.foldColumnRect(width: bounds.width)
    let rect = NSRect(
      x: column.midX - size.width / 2, y: y + (rowHeight - size.height) / 2, width: size.width, height: size.height)
    image.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
  }

  /// The rows intersecting `rect` (gutter coordinates) with their y in the gutter. The layout
  /// manager's iterator, not the line storage's: lines folded away come back merged into one row.
  func rows(in rect: NSRect) -> [(line: TextLineStorage<TextLine>.TextLinePosition, y: CGFloat)] {
    guard let layout = document?.engine.textView.layoutManager else { return [] }
    return layout.linesStartingAt(max(0, top + rect.minY), until: top + rect.maxY).map { ($0, $0.yPos - top) }
  }

  private func drawMarks(_ layout: TextLayoutManager, top: CGFloat, dirtyRect: NSRect, theme: EditorTheme) {
    let x = bounds.width - GutterRow.markColumn
    for mark in marksByLine {
      guard let rect = markRect(mark, layout: layout, top: top, x: x), rect.intersects(dirtyRect) else { continue }
      switch mark.kind {
      case .added: theme.added.setFill()
      case .modified: theme.modified.setFill()
      case .deleted: theme.deleted.setFill()
      }
      if mark.kind == .deleted {
        let path = NSBezierPath()
        path.move(to: NSPoint(x: rect.minX, y: rect.minY))
        path.line(to: NSPoint(x: rect.maxX + 2, y: rect.midY))
        path.line(to: NSPoint(x: rect.minX, y: rect.maxY))
        path.close()
        path.fill()
      } else {
        NSBezierPath(roundedRect: rect, xRadius: 1, yRadius: 1).fill()
      }
    }
  }

  private func markRect(_ mark: GutterRow.Mark, layout: TextLayoutManager, top: CGFloat, x: CGFloat) -> NSRect? {
    if mark.kind == .deleted {
      let boundary: CGFloat
      if let line = layout.textLineForIndex(mark.lines.lowerBound) {
        boundary = line.yPos
      } else if let last = layout.lineStorage.last {
        boundary = last.yPos + last.height
      } else {
        return nil
      }
      return NSRect(x: x, y: boundary - top - 4, width: 4, height: 8)
    }
    guard let first = layout.textLineForIndex(mark.lines.lowerBound) else { return nil }
    let last = layout.textLineForIndex(max(mark.lines.lowerBound, mark.lines.upperBound - 1)) ?? first
    return NSRect(x: x, y: first.yPos - top, width: 3, height: last.yPos + last.height - first.yPos)
  }

  // MARK: Clicks

  override func mouseDown(with event: NSEvent) {
    guard let document, let layout = document.engine.textView.layoutManager else { return }
    let point = convert(event.locationInWindow, from: nil)
    let x = bounds.width - GutterRow.markColumn
    if point.x >= x - 4,
      let hit = marksByLine.first(where: { markRect($0, layout: layout, top: top, x: x)?.insetBy(dx: -4, dy: -1).contains(point) == true }),
      let mark = document.gitMarks.first(where: { $0.id == hit.id })
    {
      showPeek(mark, at: markRect(hit, layout: layout, top: top, x: x) ?? .zero)
      return
    }
    guard let line = layout.textLineForPosition(top + point.y) else { return }
    if GutterRow.foldColumnRect(width: bounds.width).insetBy(dx: -2, dy: 0).contains(NSPoint(x: point.x, y: 1)),
      document.folding.region(startingAt: line.index) != nil
    {
      document.actions?.commandPerformed(document.folding.isFolded(line: line.index) ? .unfold : .fold)
      document.folding.toggle(line: line.index)
      return
    }
    // Clicking a number selects its row: a folded one's range runs through the fold, so it stays shut.
    document.engine.textView.selectionManager.setSelectedRange(line.range)
    document.focus()
  }

  private func showPeek(_ mark: GutterMark, at rect: NSRect) {
    guard let document else { return }
    markPopover?.close()
    let current = mark.lines.map { line in
      let range = document.lineIndex.lineRange(line)
      return document.storage.substring(with: range).trimmingCharacters(in: .newlines)
    }
    let popover = NSPopover()
    popover.behavior = .transient
    popover.contentViewController = NSHostingController(
      rootView: GitPeekView(mark: mark, currentLines: current, canRevert: document.actions != nil) { [weak self, weak document] in
        document?.actions?.revertHunk(mark)
        self?.markPopover?.close()
      }
      .environment(\.theme, document.engine.theme.base))
    popover.show(relativeTo: rect, of: self, preferredEdge: .maxX)
    markPopover = popover
  }
}

/// Pure inputs for the gutter, so they can be tested without drawing.
enum GutterRow {
  static let dotColumn: CGFloat = 12
  static let markColumn: CGFloat = 5
  static let foldColumn: CGFloat = 14

  /// Between the numbers and the change bars, full height (y is ignored).
  static func foldColumnRect(width: CGFloat) -> NSRect {
    NSRect(x: width - markColumn - foldColumn, y: 0, width: foldColumn, height: 2)
  }

  /// The gutter's frame in text view coordinates: the visible rows, at the leading edge.
  static func frame(visible: NSRect, width: CGFloat) -> NSRect {
    NSRect(x: 0, y: visible.minY, width: width, height: visible.height)
  }

  struct Mark: Equatable {
    var id: String
    var kind: GutterMark.Kind
    var lines: Range<Int>
  }

  static func severities(_ diagnostics: [EditorDiagnostic]) -> [Int: DiagnosticSeverity] {
    var result: [Int: DiagnosticSeverity] = [:]
    for diagnostic in diagnostics {
      let line = diagnostic.range.start.line
      if let existing = result[line], existing <= diagnostic.severity { continue }
      result[line] = diagnostic.severity
    }
    return result
  }

  /// Marks sorted by line; deletions drawn last so their wedge sits on top of a neighbouring bar.
  static func marks(_ marks: [GutterMark]) -> [Mark] {
    marks.map { Mark(id: $0.id, kind: $0.kind, lines: $0.lines) }
      .sorted { ($0.kind == .deleted ? 1 : 0, $0.lines.lowerBound) < ($1.kind == .deleted ? 1 : 0, $1.lines.lowerBound) }
  }
}
