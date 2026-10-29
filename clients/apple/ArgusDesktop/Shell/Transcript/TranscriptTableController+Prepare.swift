import AppKit
import QuartzCore
import SwiftUI

/// Hosted rows are built once, off screen at the table's width, ahead of the
/// reader. Laying a cell out reports its exact height, and the table is handed
/// that same cell when the row scrolls in: no row is built twice, or on screen.
extension TranscriptTableController {
  /// A hosted row's height at `width`, from the cell on screen when there is
  /// one, else from a cell laid out off screen for the row to use later.
  func layOutHosted(_ index: Int, width: CGFloat) -> CGFloat? {
    #if DEBUG
      if Self.experiment.contains("noprepare") { return nil }
    #endif
    let id = id(index)
    let revision = revision(id)
    if index < table.numberOfRows, let shown = table.view(atColumn: 0, row: index, makeIfNecessary: false) as? TranscriptCell,
      shown.rowId == id, shown.revision == revision, shown.environmentKey == environmentKey
    {
      return layOut(shown, width: width, height: shown.frame.height)
    }
    let cell = prepared.cells[id] ?? spareCell()
    if cell.rowId != id || cell.revision != revision || cell.environmentKey != environmentKey {
      configure(cell, index)
    }
    prepared.keep(cell, for: id)
    if cell.superview !== staging { staging.addSubview(cell) }
    let height = layOut(cell, width: width, height: heights.reported[id] ?? 100)
    for evicted in prepared.trim(keeping: 80) { evicted.removeFromSuperview() }
    return height
  }

  private func layOut(_ cell: TranscriptCell, width: CGFloat, height: CGFloat) -> CGFloat? {
    measuring += 1
    defer { measuring -= 1 }
    cell.frame.size = NSSize(width: width, height: max(height, 1))
    cell.layoutSubtreeIfNeeded()
    return cell.laidOutHeight
  }

  #if DEBUG
    /// A new cell for the row, laid out off screen and thrown away: one row's cost.
    func buildFresh(_ index: Int) -> CGFloat? {
      let cell = TranscriptCell()
      configure(cell, index)
      staging.addSubview(cell)
      defer { cell.removeFromSuperview() }
      return layOut(cell, width: width, height: 100)
    }
  #endif

  /// A cell the table isn't showing.
  private func spareCell() -> TranscriptCell {
    table.makeView(withIdentifier: TranscriptCell.identifier, owner: nil) as? TranscriptCell ?? TranscriptCell()
  }

  /// The prepared cell for a row about to show, out of the staging area.
  func takePrepared(_ index: Int) -> TranscriptCell? {
    let id = id(index)
    guard let cell = prepared.cells[id], cell.revision == revision(id), cell.environmentKey == environmentKey
    else { return nil }
    prepared.remove(id)
    cell.removeFromSuperview()
    return cell
  }

  func forgetPrepared() {
    for cell in prepared.removeAll() { cell.removeFromSuperview() }
  }

  // MARK: Prefetch

  /// Rows near the viewport are measured and built just after each frame
  /// starts, a few milliseconds' worth at a time and at most one hosted row,
  /// furthest ahead in the direction the reader is scrolling.
  func schedulePrefetch() {
    if prefetchLink == nil {
      // The link holds its target; the controller mustn't outlive its pane for it.
      let link = scrollView.displayLink(target: PrefetchTarget(self), selector: #selector(PrefetchTarget.tick))
      link.add(to: .main, forMode: .common)
      prefetchLink = link
    }
    prefetchLink?.isPaused = false
  }

  func prefetchTick() {
    // Not mid-resize: each step would measure the same rows at a width about to change.
    guard CACurrentMediaTime() - widthChangedAt >= 0.3 else { return }
    let start = CACurrentMediaTime()
    // Two ticks can land in one run-loop pass; one row build per frame at most.
    guard start - lastHostedBuild >= 0.012 else { return }
    var moved = IndexSet()
    TranscriptPerfLog.time("prefetch") {
      while CACurrentMediaTime() - start < 0.004, let index = nextToPrepare() {
        let hosted = plainText(index) == nil
        if hosted { lastHostedBuild = start }
        moved.formUnion(measure([index], always: hosted && heights.exact(id(index), revision: revision(id(index)), width: width) != nil))
        if hosted { break }
      }
      if !moved.isEmpty { keepingPlace { note(moved) } }
    }
    if moved.isEmpty, nextToPrepare() == nil { prefetchLink?.isPaused = true }
  }

  /// The nearest row ahead with no height at this width, or a hosted row about
  /// to scroll in with no cell built for it.
  private func nextToPrepare() -> Int? {
    guard table.numberOfRows > 0 else { return nil }
    let visible = scrollView.contentView.bounds
    let width = width
    func rows(_ from: CGFloat, _ to: CGFloat) -> [Int] {
      let range = table.rows(in: NSRect(x: 0, y: from, width: visible.width, height: max(to - from, 0)))
      return Array(range.location..<(range.location + range.length))
    }
    let upward = scrollingUp
    let reach: CGFloat = Self.experiment.contains("reach2") ? 2 : 6
    let ahead = upward ? rows(visible.minY - visible.height * reach, visible.minY).reversed() : rows(visible.maxY, visible.maxY + visible.height * reach)
    let behind = upward ? rows(visible.maxY, visible.maxY + visible.height) : rows(visible.minY - visible.height, visible.minY).reversed()
    let near = Set(upward ? rows(visible.minY - visible.height * 3, visible.minY) : rows(visible.maxY, visible.maxY + visible.height * 3))
    for index in Array(ahead) + Array(behind) where index >= 0 && index < rowCount {
      let id = id(index)
      if heights.exact(id, revision: revision(id), width: width) == nil { return index }
      if !Self.experiment.contains("noprepare"), near.contains(index), plainText(index) == nil, prepared.cells[id]?.revision != revision(id) { return index }
    }
    return nil
  }
}

@MainActor
private final class PrefetchTarget: NSObject {
  weak var controller: TranscriptTableController?

  init(_ controller: TranscriptTableController) {
    self.controller = controller
  }

  @objc func tick(_ link: CADisplayLink) {
    guard let controller else { return link.invalidate() }
    controller.prefetchTick()
  }
}

extension TranscriptTableController {
  /// Debug A/B switches for the scroll bench, `ARGUS_TRANSCRIPT_EXPERIMENT`.
  static let experiment: Set<String> = {
    #if DEBUG
      Set((ProcessInfo.processInfo.environment["ARGUS_TRANSCRIPT_EXPERIMENT"] ?? "").split(separator: ",").map(String.init))
    #else
      []
    #endif
  }()
}

/// Built cells waiting for their rows, oldest first.
@MainActor
struct PreparedCells {
  private(set) var cells: [String: TranscriptCell] = [:]
  private var order: [String] = []

  mutating func keep(_ cell: TranscriptCell, for id: String) {
    if cells[id] !== cell, let previous = cells[id] { previous.removeFromSuperview() }
    cells[id] = cell
    order.removeAll { $0 == id }
    order.append(id)
  }

  mutating func remove(_ id: String) {
    cells[id] = nil
    order.removeAll { $0 == id }
  }

  mutating func trim(keeping limit: Int) -> [TranscriptCell] {
    var evicted: [TranscriptCell] = []
    while order.count > limit {
      let id = order.removeFirst()
      if let cell = cells.removeValue(forKey: id) { evicted.append(cell) }
    }
    return evicted
  }

  mutating func removeAll() -> [TranscriptCell] {
    defer {
      cells = [:]
      order = []
    }
    return Array(cells.values)
  }
}
