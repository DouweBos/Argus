import AppKit
import ArgusCore
import ArgusUI
import GroveKit
import SwiftUI

/// Which part of a row the pointer is over: a unified line, or one side of a split pair.
enum DiffHoverSide: Equatable {
  case whole
  case left
  case right

  var commentSide: DiffReviewComment.Side? {
    switch self {
    case .whole: nil
    case .left: .old
    case .right: .new
    }
  }
}

/// Review comments in the diff table: the gutter's `+`, the composer popover and the comment rows.
extension DiffTableView.Coordinator {
  func comment(_ id: UUID) -> DiffReviewComment? {
    review?.comments.first { $0.id == id }
  }

  func commentView(_ id: UUID, in tableView: NSTableView) -> NSView? {
    guard let comment = comment(id), let theme else { return nil }
    let view =
      tableView.makeView(withIdentifier: DiffCommentRowView.identifier, owner: nil) as? DiffCommentRowView
      ?? DiffCommentRowView()
    let inset =
      layout == .inline
      ? DiffMetrics.textX(gutters: gutters)
      : (comment.side == .new ? half : 0) + DiffMetrics.gutterWidth + 20
    let card = DiffCommentCard(
      comment: comment, width: cardWidth(for: comment), edit: { [weak self] in self?.edit(id) }, delete: { [weak self] in self?.review?.delete(id) })
    view.configure(card, theme: theme, inset: inset)
    return view
  }

  /// Inline cards keep a reading width; a split side's card fits inside its half.
  func cardWidth(for comment: DiffReviewComment) -> CGFloat {
    guard layout == .split else { return DiffCommentMetrics.maxCardWidth }
    return max(200, min(DiffCommentMetrics.maxCardWidth, half - DiffMetrics.gutterWidth - 32))
  }

  /// A split side's cards rewrap with the pane.
  func tableViewColumnDidResize(_ notification: Notification) {
    guard layout == .split, let table else { return }
    let comments = IndexSet(rows.indices.filter { if case .comment = rows[$0].kind { true } else { false } })
    guard !comments.isEmpty else { return }
    table.noteHeightOfRows(withIndexesChanged: comments)
    table.reloadData(forRowIndexes: comments, columnIndexes: [0])
  }

  private var half: CGFloat { floor((table?.tableColumns.first?.width ?? 0) / 2) }

  /// The side of a line row the pointer is over, if it can take a comment.
  private func side(row: Int, x: CGFloat) -> DiffHoverSide? {
    guard review != nil, rows.indices.contains(row) else { return nil }
    switch rows[row].kind {
    case .line: return .whole
    case .pair(let left, let right):
      if x >= half { return right == nil ? nil : .right }
      return left == nil ? nil : .left
    case .header, .comment: return nil
    }
  }

  /// Whether `x` is on the `+` strip of that side.
  private func onButton(_ side: DiffHoverSide, x: CGFloat) -> Bool {
    let start = side == .right ? half : 0
    return x >= start && x < start + DiffMetrics.commentButtonWidth
  }

  func mouseMoved(row: Int, x: CGFloat) {
    guard review != nil, let table else { return }
    let side = side(row: row, x: x)
    let next = side.map { (row: row, side: $0) }
    if next?.row != hover?.row || next?.side != hover?.side {
      if let old = hover?.row, old < table.numberOfRows {
        (table.view(atColumn: 0, row: old, makeIfNecessary: false) as? DiffLineView)?.hoverSide = nil
      }
      hover = next
      if let next {
        (table.view(atColumn: 0, row: next.row, makeIfNecessary: false) as? DiffLineView)?.hoverSide = next.side
      }
    }
    (side.map { onButton($0, x: x) } == true ? NSCursor.pointingHand : NSCursor.arrow).set()
  }

  /// A click on the `+` opens the composer; anything else is the table's.
  func gutterClicked(row: Int, x: CGFloat) -> Bool {
    guard let side = side(row: row, x: x), onButton(side, x: x) else { return false }
    startComment(row: row, side: side)
    return true
  }

  func commentMenuItem(row: Int) -> NSMenuItem? {
    guard review != nil, rows.indices.contains(row), side(row: row, x: 0) != nil || side(row: row, x: half) != nil
    else { return nil }
    let item = NSMenuItem(title: "Add Comment…", action: #selector(addCommentFromMenu(_:)), keyEquivalent: "")
    item.target = self
    item.tag = row
    return item
  }

  @objc private func addCommentFromMenu(_ sender: NSMenuItem) {
    let side = hover?.row == sender.tag ? hover?.side ?? .whole : .whole
    startComment(row: sender.tag, side: side)
  }

  /// The line indices a row covers on a side.
  private func lineIndices(_ row: Int, _ side: DiffHoverSide) -> [Int] {
    switch rows[row].kind {
    case .line(let i): [i]
    case .pair(let left, let right):
      switch side {
      case .left: [left].compactMap { $0 }
      case .right: [right].compactMap { $0 }
      case .whole: [left, right].compactMap { $0 }
      }
    case .header, .comment: []
    }
  }

  /// Comments on the row, or on the whole selection when the row is part of it.
  func startComment(row: Int, side: DiffHoverSide) {
    guard let diff, let review, let table, rows.indices.contains(row) else { return }
    let hunk = rows[row].hunk
    var indices = lineIndices(row, side)
    let selection = table.selectedRowIndexes
    if selection.contains(row), selection.count > 1 {
      indices = selection.filter { rows[$0].hunk == hunk }.flatMap { lineIndices($0, side) }
    }
    guard
      let draft = DiffReviewAnchors.draft(
        path: diff.filePath, hunk: diff.hunks[hunk], indices: indices, side: side.commentSide, scope: review.scope)
    else { return }
    showComposer(title: "Comment on \(draft.location)", submitTitle: "Add Comment", text: "", row: row, side: side) {
      var comment = draft
      comment.body = $0
      review.add(comment)
    }
  }

  private func edit(_ id: UUID) {
    guard let review, let comment = comment(id), let row = rows.firstIndex(where: { $0.kind == .comment(id) }) else {
      return
    }
    showComposer(
      title: "Edit comment on \(comment.location)", submitTitle: "Save", text: comment.body, row: row,
      side: comment.side == .new && layout == .split ? .right : .whole
    ) { review.update(id, $0) }
  }

  private func showComposer(
    title: String, submitTitle: String, text: String, row: Int, side: DiffHoverSide, submit: @escaping (String) -> Void
  ) {
    guard let table, let theme else { return }
    popover?.close()
    let popover = NSPopover()
    popover.behavior = .transient
    let close: () -> Void = { [weak popover] in popover?.performClose(nil) }
    let composer = DiffCommentComposer(
      title: title, submitTitle: submitTitle, text: text,
      submit: {
        submit($0)
        close()
      }, cancel: close)
    popover.contentViewController = NSHostingController(rootView: composer.environment(\.theme, theme))
    let rect = table.rect(ofRow: row)
    let x = side == .right ? half : 0
    popover.show(
      relativeTo: NSRect(x: x, y: rect.minY, width: DiffMetrics.commentButtonWidth, height: rect.height), of: table,
      preferredEdge: .maxY)
    self.popover = popover
  }
}
