import AppKit
import ArgusUI
import GroveKit
import SwiftUI

/// A diff as an `NSTableView`: rows are reused and only the visible ones
/// draw, so a 100k-line diff scrolls like a small one. Hunk headers carry the
/// staging actions; selected lines narrow them to "lines".
struct DiffTableView: NSViewRepresentable {
  let diff: DiffResult
  var layout: DiffLayout = .inline
  var actions: DiffActions?
  var onAction: ((HunkAction, HunkData, [GroveKit.DiffLine]) -> Void)?
  /// Opens the file in the code view at a 1-based line of the new side.
  var openLine: ((Int) -> Void)?
  @Environment(\.theme) private var theme

  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeNSView(context: Context) -> NSScrollView {
    let table = DiffNSTableView()
    table.headerView = nil
    table.style = .plain
    table.intercellSpacing = .zero
    table.allowsMultipleSelection = true
    table.backgroundColor = .clear
    table.gridStyleMask = []
    table.usesAutomaticRowHeights = false
    table.columnAutoresizingStyle = .firstColumnOnlyAutoresizingStyle
    let column = NSTableColumn(identifier: .init("diff"))
    table.addTableColumn(column)
    table.dataSource = context.coordinator
    table.delegate = context.coordinator
    table.menu = context.coordinator.menu
    table.coordinator = context.coordinator
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
    coordinator.onAction = onAction
    coordinator.openLine = openLine
    coordinator.update(diff: diff, layout: layout, actions: actions, palette: DiffPalette(theme))
    if coordinator.textScale.changed() { coordinator.table?.reloadData() }
  }

  @MainActor
  final class Coordinator: NSObject, NSTableViewDataSource, NSTableViewDelegate, NSMenuDelegate {
    weak var table: NSTableView?
    var textScale = TextScaleTracker()
    var onAction: ((HunkAction, HunkData, [GroveKit.DiffLine]) -> Void)?
    var openLine: ((Int) -> Void)?
    private(set) var diff: DiffResult?
    private(set) var rows: [DiffRow] = []
    private var layout: DiffLayout = .inline
    private var gutters = DiffGutters.both
    private var actions: DiffActions?
    private var palette: DiffPalette?
    private var signature: [String] = []
    lazy var menu: NSMenu = {
      let menu = NSMenu()
      menu.delegate = self
      return menu
    }()

    func update(diff: DiffResult, layout: DiffLayout, actions: DiffActions?, palette: DiffPalette) {
      // Hunk ids change whenever their content does; the same diff keeps
      // its rows, scroll position and selection.
      let next = [diff.filePath, layout.rawValue, "\(actions.map { "\($0)" } ?? "-")"] + diff.hunks.map(\.id)
      let paletteChanged = palette != self.palette
      self.palette = palette
      guard next != signature || paletteChanged else { return }
      let sameFile = signature.first == next.first && signature.dropFirst().first == next.dropFirst().first
      signature = next
      self.diff = diff
      self.layout = layout
      self.actions = actions
      gutters = DiffRowBuilder.gutters(for: diff)
      rows = DiffRowBuilder.rows(for: diff, layout: layout)
      guard let table else { return }
      if let column = table.tableColumns.first {
        let chars = layout == .inline ? DiffRowBuilder.widestLine(in: diff) : 0
        column.minWidth = layout == .inline ? DiffMetrics.textX(gutters: gutters) + CGFloat(chars) * DiffMetrics.charWidth + 24 : 200
        column.width = max(column.minWidth, table.enclosingScrollView?.contentSize.width ?? 0)
      }
      let selection = sameFile ? table.selectedRowIndexes : IndexSet()
      table.reloadData()
      table.selectRowIndexes(selection.filteredIndexSet { $0 < rows.count }, byExtendingSelection: false)
    }

    // MARK: Data

    func numberOfRows(in tableView: NSTableView) -> Int { rows.count }

    func tableView(_ tableView: NSTableView, heightOfRow row: Int) -> CGFloat {
      rows[row].kind == .header ? DiffMetrics.headerHeight : DiffMetrics.lineHeight
    }

    func tableView(_ tableView: NSTableView, isGroupRow row: Int) -> Bool { false }

    func tableView(_ tableView: NSTableView, shouldSelectRow row: Int) -> Bool {
      rows[row].kind != .header
    }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
      guard let diff, let palette else { return nil }
      let item = rows[row]
      let hunk = diff.hunks[item.hunk]
      if item.kind == .header {
        let view =
          tableView.makeView(withIdentifier: DiffHunkHeaderView.identifier, owner: nil) as? DiffHunkHeaderView
          ?? DiffHunkHeaderView()
        view.configure(
          hunk: hunk, palette: palette, buttons: headerButtons(hunk: item.hunk),
          perform: { [weak self] action in self?.perform(action, hunkIndex: item.hunk) })
        return view
      }
      let view =
        tableView.makeView(withIdentifier: DiffLineView.identifier, owner: nil) as? DiffLineView ?? DiffLineView()
      view.configure(row: item, hunk: hunk, palette: palette, gutters: gutters)
      return view
    }

    func tableView(_ tableView: NSTableView, rowViewForRow row: Int) -> NSTableRowView? {
      DiffRowView()
    }

    func tableViewSelectionDidChange(_ notification: Notification) {
      // Headers re-label "Hunk" ↔ "Lines" with the selection.
      guard let table else { return }
      table.enumerateAvailableRowViews { rowView, row in
        guard rows.indices.contains(row), rows[row].kind == .header,
          let header = rowView.view(atColumn: 0) as? DiffHunkHeaderView
        else { return }
        header.setButtons(headerButtons(hunk: rows[row].hunk))
      }
    }

    // MARK: Actions

    /// The selected change lines in a hunk; empty means "the whole hunk".
    func selectedLines(inHunk index: Int) -> [GroveKit.DiffLine] {
      guard let diff, let table else { return [] }
      let lines = diff.hunks[index].lines
      var picked: [Int] = []
      for row in table.selectedRowIndexes where rows[row].hunk == index {
        switch rows[row].kind {
        case .line(let i): picked.append(i)
        case .pair(let left, let right): picked += [left, right].compactMap { $0 }
        case .header: break
        }
      }
      return Set(picked).sorted().map { lines[$0] }.filter { $0.type != .context }
    }

    private func headerButtons(hunk index: Int) -> [(String, HunkAction)] {
      guard let actions else { return [] }
      let lines = !selectedLines(inHunk: index).isEmpty
      switch actions {
      case .unstaged:
        return lines
          ? [("Discard Lines", .discardLines), ("Stage Lines", .stageLines)]
          : [("Discard Hunk", .discardHunk), ("Stage Hunk", .stageHunk)]
      case .staged:
        return lines ? [("Unstage Lines", .unstageLines)] : [("Unstage Hunk", .unstageHunk)]
      }
    }

    private func perform(_ action: HunkAction, hunkIndex: Int) {
      guard let diff else { return }
      let lines = selectedLines(inHunk: hunkIndex)
      onAction?(action, diff.hunks[hunkIndex], lines)
      table?.deselectAll(nil)
    }

    // MARK: Menu

    func menuNeedsUpdate(_ menu: NSMenu) {
      menu.removeAllItems()
      guard let table else { return }
      let clicked = table.clickedRow
      if clicked >= 0, !table.selectedRowIndexes.contains(clicked) {
        table.selectRowIndexes([clicked], byExtendingSelection: false)
      }
      let copy = NSMenuItem(title: "Copy", action: #selector(DiffNSTableView.copy(_:)), keyEquivalent: "")
      copy.target = table
      menu.addItem(copy)
      guard clicked >= 0, clicked < rows.count else { return }
      if openLine != nil, let line = newLine(at: clicked) {
        let open = NSMenuItem(title: "Open in Editor at Line", action: #selector(openAtLine(_:)), keyEquivalent: "")
        open.target = self
        open.tag = line
        menu.insertItem(open, at: 0)
        menu.insertItem(.separator(), at: 1)
      }
      let hunk = rows[clicked].hunk
      let buttons = headerButtons(hunk: hunk)
      if !buttons.isEmpty { menu.addItem(.separator()) }
      for (title, action) in buttons.reversed() {
        let item = NSMenuItem(title: title, action: #selector(menuAction(_:)), keyEquivalent: "")
        item.target = self
        item.representedObject = MenuPayload(action: action, hunk: hunk)
        menu.addItem(item)
      }
    }

    private final class MenuPayload: NSObject {
      let action: HunkAction
      let hunk: Int
      init(action: HunkAction, hunk: Int) {
        self.action = action
        self.hunk = hunk
      }
    }

    /// The new-side line a row shows; a removed line maps to where it was.
    func newLine(at row: Int) -> Int? {
      guard let diff, rows.indices.contains(row) else { return nil }
      let hunk = diff.hunks[rows[row].hunk]
      let index: Int?
      switch rows[row].kind {
      case .header: index = hunk.lines.firstIndex { $0.newLineNumber != nil }
      case .line(let i): index = i
      case .pair(let left, let right): index = right ?? left
      }
      guard let index else { return nil }
      if let number = hunk.lines[index].newLineNumber { return number }
      return hunk.lines[..<index].last { $0.newLineNumber != nil }?.newLineNumber.map { $0 + 1 }
        ?? hunk.lines.first { $0.newLineNumber != nil }?.newLineNumber
    }

    @objc private func openAtLine(_ sender: NSMenuItem) {
      openLine?(sender.tag)
    }

    /// ⌥-click opens the line in the code view.
    func optionClicked(row: Int) -> Bool {
      guard let openLine, let line = newLine(at: row) else { return false }
      openLine(line)
      return true
    }

    @objc private func menuAction(_ sender: NSMenuItem) {
      guard let payload = sender.representedObject as? MenuPayload else { return }
      perform(payload.action, hunkIndex: payload.hunk)
    }

    /// The selected lines as text, for ⌘C.
    func copySelection() -> String {
      guard let diff, let table else { return "" }
      return table.selectedRowIndexes.compactMap { row -> String? in
        let item = rows[row]
        let lines = diff.hunks[item.hunk].lines
        switch item.kind {
        case .header: return nil
        case .line(let i): return lines[i].content
        case .pair(let left, let right): return (right ?? left).map { lines[$0].content }
        }
      }.joined(separator: "\n")
    }
  }
}

/// ⌘C copies the selected lines' text.
final class DiffNSTableView: NSTableView {
  weak var coordinator: DiffTableView.Coordinator?

  override func mouseDown(with event: NSEvent) {
    if event.modifierFlags.contains(.option) {
      let row = self.row(at: convert(event.locationInWindow, from: nil))
      if row >= 0, coordinator?.optionClicked(row: row) == true { return }
    }
    super.mouseDown(with: event)
  }

  @objc func copy(_ sender: Any?) {
    guard let text = coordinator?.copySelection(), !text.isEmpty else { return }
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
  }
}

private final class DiffRowView: NSTableRowView {
  override func drawSelection(in dirtyRect: NSRect) {
    NSColor.selectedContentBackgroundColor.withAlphaComponent(isEmphasized ? 0.35 : 0.2).setFill()
    bounds.fill()
  }
}
