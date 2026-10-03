import AppKit
import ArgusUI
import GroveKit
import SwiftUI

/// The commit list as an `NSTableView`: rows are reused and drawn directly,
/// so a 100k-commit history scrolls like a small one. Selection, arrow keys
/// and paging all go through the `HistoryViewModel`.
struct CommitTableView: NSViewRepresentable {
  let history: HistoryViewModel
  /// Commits on the session branch its base lacks; nil when not on the branch view.
  var ownCommits: Set<String>?
  let menu: (NSMenu, CommitInfo, [CommitInfo]) -> Void
  @Environment(\.theme) private var theme

  func makeCoordinator() -> Coordinator { Coordinator(history: history) }

  func makeNSView(context: Context) -> NSScrollView {
    let table = CommitNSTableView()
    table.style = .plain
    table.intercellSpacing = NSSize(width: 0, height: 0)
    table.rowHeight = CommitListMetrics.rowHeight
    table.allowsMultipleSelection = true
    table.allowsColumnReordering = false
    table.usesAlternatingRowBackgroundColors = false
    table.columnAutoresizingStyle = .firstColumnOnlyAutoresizingStyle
    table.setAccessibilityLabel("Commits")
    for column in CommitColumn.allCases {
      let tableColumn = NSTableColumn(identifier: column.identifier)
      tableColumn.title = column.title
      tableColumn.width = column.width
      tableColumn.minWidth = column.minWidth
      tableColumn.resizingMask = column == .subject ? .autoresizingMask : .userResizingMask
      table.addTableColumn(tableColumn)
    }
    table.dataSource = context.coordinator
    table.delegate = context.coordinator
    table.coordinator = context.coordinator
    let menu = NSMenu()
    menu.delegate = context.coordinator
    table.menu = menu
    let scroll = NSScrollView()
    scroll.documentView = table
    scroll.hasVerticalScroller = true
    scroll.autohidesScrollers = true
    // Keeps the table as wide as the clip view, so the subject absorbs resizes.
    table.autoresizingMask = [.width]
    scroll.drawsBackground = false
    table.backgroundColor = .clear
    context.coordinator.table = table
    return scroll
  }

  func updateNSView(_ scroll: NSScrollView, context: Context) {
    let coordinator = context.coordinator
    coordinator.menuBuilder = menu
    coordinator.ownCommits = ownCommits
    // Reading these here is what makes SwiftUI call us when they change.
    coordinator.update(
      commits: history.filteredCommits, showsGraph: history.layout == .graph && !history.isFiltering,
      graphColumns: history.maxGraphColumns, refsKey: refsKey,
      selection: history.selection.rows, focus: history.selectedCommit?.id, palette: CommitListPalette(theme))
  }

  /// Changes whenever a row's decoration would: a ref moving, HEAD moving, the graph rebuilding.
  private var refsKey: Int {
    var hasher = Hasher()
    for branch in history.branches { hasher.combine(branch.id); hasher.combine(branch.targetSHA) }
    for tag in history.tags { hasher.combine(tag.id); hasher.combine(tag.targetSHA) }
    hasher.combine(history.headSHA)
    hasher.combine(history.graphNodes.count)
    return hasher.finalize()
  }

  enum CommitColumn: String, CaseIterable {
    case subject, author, date, sha
    var identifier: NSUserInterfaceItemIdentifier { .init(rawValue) }
    var title: String {
      switch self {
      case .subject: "Subject"
      case .author: "Author"
      case .date: "Date"
      case .sha: "SHA"
      }
    }
    var width: CGFloat {
      switch self {
      case .subject: 480
      case .author: 140
      case .date: 130
      case .sha: 70
      }
    }
    var minWidth: CGFloat { self == .subject ? 200 : 50 }
  }

  @MainActor
  final class Coordinator: NSObject, NSTableViewDataSource, NSTableViewDelegate, NSMenuDelegate {
    let history: HistoryViewModel
    weak var table: NSTableView?
    var menuBuilder: ((NSMenu, CommitInfo, [CommitInfo]) -> Void)?
    var ownCommits: Set<String>?
    private(set) var commits: [CommitInfo] = []
    private var indexByID: [String: Int] = [:]
    private var showsGraph = true
    private var graphColumns = 1
    private var palette: CommitListPalette?
    private var dataKey: [AnyHashable] = []
    private var appliedSelection: Set<String> = []
    private var appliedFocus: String?

    init(history: HistoryViewModel) { self.history = history }

    func update(
      commits: [CommitInfo], showsGraph: Bool, graphColumns: Int, refsKey: Int, selection: Set<String>,
      focus: String?, palette: CommitListPalette
    ) {
      guard let table else { return }
      let key: [AnyHashable] = [
        commits.count, commits.first?.id, commits.last?.id, showsGraph, graphColumns, refsKey, ownCommits?.count,
      ]
      if key != dataKey || palette != self.palette {
        dataKey = key
        self.commits = commits
        indexByID = Dictionary(commits.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { first, _ in first })
        self.showsGraph = showsGraph
        self.graphColumns = graphColumns
        self.palette = palette
        table.reloadData()
        table.sizeToFit()
        appliedSelection = []
      }
      if selection != appliedSelection {
        appliedSelection = selection
        table.selectRowIndexes(IndexSet(selection.compactMap { indexByID[$0] }), byExtendingSelection: false)
      }
      if focus != appliedFocus {
        appliedFocus = focus
        if let focus, let row = indexByID[focus] { table.scrollRowToVisible(row) }
      }
    }

    func numberOfRows(in tableView: NSTableView) -> Int { commits.count }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
      guard commits.indices.contains(row), let palette, let id = tableColumn?.identifier else { return nil }
      let commit = commits[row]
      if row == commits.count - 1 { history.rowAppeared(commit) }
      switch CommitColumn(rawValue: id.rawValue) {
      case .subject:
        let cell =
          tableView.makeView(withIdentifier: CommitSubjectCell.identifier, owner: nil) as? CommitSubjectCell
          ?? CommitSubjectCell()
        cell.configure(model(for: commit), palette: palette, showsGraph: showsGraph)
        return cell
      case .author:
        return text(tableView, id, commit.authorName, palette.secondary, CommitListMetrics.font)
      case .date:
        return text(tableView, id, Self.dateFormatter.string(from: commit.authorDate), palette.secondary,
          CommitListMetrics.font)
      case .sha:
        return text(tableView, id, commit.shortSHA, palette.muted, CommitListMetrics.monoFont)
      case nil:
        return nil
      }
    }

    private func text(
      _ tableView: NSTableView, _ id: NSUserInterfaceItemIdentifier, _ value: String, _ color: NSColor, _ font: NSFont
    ) -> NSView {
      let cell =
        tableView.makeView(withIdentifier: id, owner: nil) as? CommitTextCell
        ?? CommitTextCell(identifier: id, font: font)
      cell.textField?.stringValue = value
      cell.textField?.textColor = color
      return cell
    }

    private func model(for commit: CommitInfo) -> CommitRowModel {
      let head = history.headSHA
      var refs: [CommitRefBadge] = history.branches(at: commit).map {
        CommitRefBadge(name: $0.name, kind: $0.isHEAD ? .head : $0.isLocal ? .local : .remote)
      }
      refs += history.tags(at: commit).map { CommitRefBadge(name: $0.name, kind: .tag) }
      if commit.id == head, !refs.contains(where: { $0.kind == .head }), history.filterBranch == nil {
        refs.insert(CommitRefBadge(name: "HEAD", kind: .head), at: 0)
      }
      return CommitRowModel(
        commit: commit, node: history.graphNodes[commit.id], graphColumns: graphColumns, refs: refs,
        sync: history.syncState(of: commit), isHead: commit.id == head,
        isOwn: ownCommits.map { $0.contains(commit.id) } ?? true)
    }

    // MARK: Selection

    func click(row: Int, extend: Bool, toggle: Bool) {
      guard commits.indices.contains(row) else { return }
      history.click(commits[row], extend: extend, toggle: toggle)
    }

    func move(by offset: Int, extend: Bool) {
      history.selectAdjacent(offset: offset, extend: extend)
    }

    // The view model owns the selection; the table only mirrors it.
    func tableView(_ tableView: NSTableView, shouldSelectRow row: Int) -> Bool { false }

    // MARK: Menu

    func menuNeedsUpdate(_ menu: NSMenu) {
      menu.removeAllItems()
      guard let table, commits.indices.contains(table.clickedRow), let menuBuilder else { return }
      let commit = commits[table.clickedRow]
      // Right-clicking inside a multi-selection acts on all of it; elsewhere, on just that commit.
      if !history.isSelected(commit) { history.select(commit) }
      let selected = history.selection.count > 1 ? history.selectedCommits : [commit]
      menuBuilder(menu, commit, selected)
    }

    static let dateFormatter: DateFormatter = {
      let formatter = DateFormatter()
      formatter.dateStyle = .medium
      formatter.timeStyle = .short
      formatter.doesRelativeDateFormatting = true
      return formatter
    }()
  }
}

/// Routes clicks and arrow keys to the view model instead of the table's own selection.
final class CommitNSTableView: NSTableView {
  weak var coordinator: CommitTableView.Coordinator?

  override var acceptsFirstResponder: Bool { true }

  override func mouseDown(with event: NSEvent) {
    window?.makeFirstResponder(self)
    let row = self.row(at: convert(event.locationInWindow, from: nil))
    guard row >= 0 else { return }
    let flags = event.modifierFlags
    coordinator?.click(row: row, extend: flags.contains(.shift), toggle: flags.contains(.command))
  }

  override func rightMouseDown(with event: NSEvent) {
    window?.makeFirstResponder(self)
    super.rightMouseDown(with: event)
  }

  override func keyDown(with event: NSEvent) {
    let extend = event.modifierFlags.contains(.shift)
    switch event.specialKey {
    case .upArrow: coordinator?.move(by: -1, extend: extend)
    case .downArrow: coordinator?.move(by: 1, extend: extend)
    case .pageUp: coordinator?.move(by: -pageRows, extend: extend)
    case .pageDown: coordinator?.move(by: pageRows, extend: extend)
    default: super.keyDown(with: event)
    }
  }

  private var pageRows: Int { max(1, Int(visibleRect.height / rowHeight) - 1) }
}
