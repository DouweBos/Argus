import AppKit
import ArgusUI
import GroveKit
import SwiftUI

/// A blamed file as an `NSTableView`: a gutter naming each block's commit,
/// the line number and the text, all drawn per row with no subviews.
struct BlameTableView: NSViewRepresentable {
  let lines: [BlameLine]
  let onBlameBefore: (String) -> Void
  let onReveal: (String) -> Void
  @Environment(\.theme) private var theme

  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeNSView(context: Context) -> NSScrollView {
    let table = BlameNSTableView()
    table.headerView = nil
    table.style = .plain
    table.intercellSpacing = .zero
    table.rowHeight = BlameLineView.height
    table.backgroundColor = .clear
    table.selectionHighlightStyle = .none
    table.columnAutoresizingStyle = .firstColumnOnlyAutoresizingStyle
    table.addTableColumn(NSTableColumn(identifier: .init("line")))
    table.dataSource = context.coordinator
    table.delegate = context.coordinator
    table.coordinator = context.coordinator
    table.setAccessibilityLabel("Blame")
    let menu = NSMenu()
    menu.delegate = context.coordinator
    table.menu = menu
    let scroll = NSScrollView()
    scroll.documentView = table
    scroll.hasVerticalScroller = true
    scroll.hasHorizontalScroller = true
    scroll.autohidesScrollers = true
    scroll.drawsBackground = false
    context.coordinator.table = table
    return scroll
  }

  func updateNSView(_ scroll: NSScrollView, context: Context) {
    let coordinator = context.coordinator
    coordinator.onBlameBefore = onBlameBefore
    coordinator.onReveal = onReveal
    coordinator.update(lines: lines, palette: BlamePalette(theme))
    if coordinator.textScale.changed(), let table = coordinator.table {
      table.rowHeight = BlameLineView.height
      table.reloadData()
    }
  }

  @MainActor
  final class Coordinator: NSObject, NSTableViewDataSource, NSTableViewDelegate, NSMenuDelegate {
    weak var table: NSTableView?
    var textScale = TextScaleTracker()
    var onBlameBefore: ((String) -> Void)?
    var onReveal: ((String) -> Void)?
    private var lines: [BlameLine] = []
    private var palette: BlamePalette?
    private var dateRange: (Date, Date) = (.distantPast, .distantFuture)

    func update(lines: [BlameLine], palette: BlamePalette) {
      guard lines != self.lines || palette != self.palette, let table else { return }
      self.lines = lines
      self.palette = palette
      let dates = lines.compactMap { $0.entry?.authorDate }
      dateRange = (dates.min() ?? .distantPast, dates.max() ?? .distantFuture)
      let longest = lines.map(\.text.count).max() ?? 0
      table.tableColumns.first?.width = max(
        BlameLineView.textX + CGFloat(longest) * DiffMetrics.charWidth + 20, table.enclosingScrollView?.bounds.width ?? 0)
      table.reloadData()
    }

    func numberOfRows(in tableView: NSTableView) -> Int { lines.count }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
      guard lines.indices.contains(row), let palette else { return nil }
      let view =
        tableView.makeView(withIdentifier: BlameLineView.identifier, owner: nil) as? BlameLineView ?? BlameLineView()
      view.configure(lines[row], age: age(of: lines[row]), palette: palette)
      return view
    }

    /// 1 for the newest commit in the file, 0 for the oldest.
    private func age(of line: BlameLine) -> CGFloat {
      guard let date = line.entry?.authorDate else { return 0 }
      let span = dateRange.1.timeIntervalSince(dateRange.0)
      return span > 0 ? CGFloat(date.timeIntervalSince(dateRange.0) / span) : 1
    }

    /// A click in the gutter re-blames from before that line's commit.
    func clicked(row: Int, x: CGFloat) {
      guard x < BlameLineView.gutterWidth, lines.indices.contains(row), let sha = lines[row].entry?.commitSHA
      else { return }
      onBlameBefore?(sha)
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
      menu.removeAllItems()
      menu.autoenablesItems = false
      guard let table, lines.indices.contains(table.clickedRow), let entry = lines[table.clickedRow].entry else {
        return
      }
      let sha = entry.commitSHA
      menu.addItem(ActionMenuItem("Blame Before \(sha.prefix(7))") { [weak self] in self?.onBlameBefore?(sha) })
      menu.addItem(ActionMenuItem("Show Commit in History") { [weak self] in self?.onReveal?(sha) })
      menu.addItem(.separator())
      menu.addItem(ActionMenuItem("Copy SHA") { Clipboard.copy(sha) })
      let text = lines[table.clickedRow].text
      menu.addItem(ActionMenuItem("Copy Line") { Clipboard.copy(text) })
    }
  }
}

/// Sends gutter clicks to the coordinator; the text keeps normal tracking.
final class BlameNSTableView: NSTableView {
  weak var coordinator: BlameTableView.Coordinator?

  override func mouseDown(with event: NSEvent) {
    let point = convert(event.locationInWindow, from: nil)
    let row = self.row(at: point)
    guard point.x < BlameLineView.gutterWidth, row >= 0 else { return super.mouseDown(with: event) }
    coordinator?.clicked(row: row, x: point.x)
  }
}

struct BlamePalette: Equatable {
  let text: NSColor
  let secondary: NSColor
  let muted: NSColor
  let accent: NSColor
  let separator: NSColor
  let gutter: NSColor

  init(_ theme: Theme) {
    text = NSColor(theme.text)
    secondary = NSColor(theme.textSecondary)
    muted = NSColor(theme.textMuted)
    accent = NSColor(theme.accent)
    separator = NSColor(theme.border)
    gutter = NSColor(theme.bgSecondary)
  }
}

/// One line: on a block's first line the gutter names the commit; an
/// accent bar, stronger for newer commits, shows age.
final class BlameLineView: NSView {
  static let identifier = NSUserInterfaceItemIdentifier("BlameLineView")
  static var height: CGFloat { TextScale.shared(18).rounded() }
  static let gutterWidth: CGFloat = 400
  private static var gutterTextFont: NSFont { .systemFont(ofSize: TextScale.shared(11)) }
  static let numberWidth: CGFloat = 44
  static var textX: CGFloat { gutterWidth + numberWidth + 10 }
  private static let dateFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateStyle = .short
    return formatter
  }()
  private var line: BlameLine?
  private var age: CGFloat = 0
  private var palette: BlamePalette?

  convenience init() {
    self.init(frame: .zero)
    identifier = Self.identifier
  }

  override var isFlipped: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  func configure(_ line: BlameLine, age: CGFloat, palette: BlamePalette) {
    self.line = line
    self.age = age
    self.palette = palette
    toolTip = line.entry.map { "\($0.commitSHA.prefix(7)) · \($0.authorName)\n\($0.summary)" }
    needsDisplay = true
  }

  override func draw(_ dirtyRect: NSRect) {
    guard let line, let palette else { return }
    palette.gutter.setFill()
    NSRect(x: 0, y: 0, width: Self.gutterWidth, height: bounds.height).fill()
    palette.accent.withAlphaComponent(0.15 + 0.85 * age).setFill()
    NSRect(x: 0, y: 0, width: 3, height: bounds.height).fill()
    if line.startsBlock {
      palette.separator.setFill()
      NSRect(x: 0, y: 0, width: bounds.width, height: 1).fill()
      if let entry = line.entry {
        let date = Self.dateFormatter.string(from: entry.authorDate)
        draw(String(entry.commitSHA.prefix(7)), x: 8, width: 56, font: DiffMetrics.gutterFont, color: palette.muted)
        draw(date, x: 66, width: 66, font: DiffMetrics.gutterFont, color: palette.secondary)
        draw(entry.authorName, x: 134, width: 90, font: Self.gutterTextFont, color: palette.secondary)
        draw(entry.summary, x: 228, width: Self.gutterWidth - 234, font: Self.gutterTextFont, color: palette.text)
      }
    }
    let number = "\(line.number)" as NSString
    let numberAttrs: [NSAttributedString.Key: Any] = [.font: DiffMetrics.gutterFont, .foregroundColor: palette.muted]
    let size = number.size(withAttributes: numberAttrs)
    number.draw(
      at: NSPoint(x: Self.gutterWidth + Self.numberWidth - size.width - 4, y: (bounds.height - size.height) / 2),
      withAttributes: numberAttrs)
    let attrs: [NSAttributedString.Key: Any] = [.font: DiffMetrics.font, .foregroundColor: palette.text]
    let text = line.text.replacingOccurrences(of: "\t", with: "    ") as NSString
    text.draw(at: NSPoint(x: Self.textX, y: (bounds.height - DiffMetrics.lineHeight) / 2 + 1), withAttributes: attrs)
  }

  private func draw(_ string: String, x: CGFloat, width: CGFloat, font: NSFont, color: NSColor) {
    let style = NSMutableParagraphStyle()
    style.lineBreakMode = .byTruncatingTail
    let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: style]
    (string as NSString).draw(
      with: NSRect(x: x, y: 2, width: width, height: bounds.height - 2), options: [.usesLineFragmentOrigin],
      attributes: attrs)
  }
}
