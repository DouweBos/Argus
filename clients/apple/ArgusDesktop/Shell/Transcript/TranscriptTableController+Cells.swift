import AppKit
import ArgusCore
import QuartzCore
import SwiftUI

/// The transcript table's cells: a plain text cell for messages that are
/// only text, a recycled hosting view for the rest, and find's highlights.
extension TranscriptTableController {
  func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row index: Int) -> NSView? {
    TranscriptPerfLog.time("viewFor.\(kind(index))") { cell(index) }
  }

  private func cell(_ index: Int) -> NSView {
    if let (message, text) = plainText(index) {
      let cell = table.makeView(withIdentifier: TranscriptTextCell.identifier, owner: nil) as? TranscriptTextCell
        ?? TranscriptTextCell()
      configure(cell, index, message: message, text: text)
      return cell
    }
    let cell = takePrepared(index)
      ?? table.makeView(withIdentifier: TranscriptCell.identifier, owner: nil) as? TranscriptCell ?? TranscriptCell()
    let id = id(index)
    if cell.rowId != id || cell.revision != revision(id) || cell.environmentKey != environmentKey {
      configure(cell, index)
    }
    return cell
  }

  func tableView(_ tableView: NSTableView, shouldSelectRow row: Int) -> Bool { false }

  func configure(_ cell: TranscriptCell, _ index: Int) {
    let id = id(index)
    let revision = revision(id)
    let root = TranscriptRow.root(
      row(index), id: id, agentKey: agentKey, model: model, selection: selection, environment: environment,
      onLayout: { [weak self, weak cell] size in
        // A recycled cell may hear the row it showed before.
        guard let cell, cell.rowId == id, cell.revision == revision else { return }
        cell.laidOutSize = size
        if !cell.measuring { self?.rowLaidOut(id, revision: revision, size: size) }
      })
    cell.show(root, id: id, revision: revision, environmentKey: environmentKey)
    cell.reserve = reserve
    cell.host.kind = kind(index)
    if case .segment(.single(let message)) = row(index) {
      cell.tip = TranscriptMessageRow.timestamp(message)
      cell.hover = message.displayBlocks.isEmpty ? nil : (message, model, environment)
    } else {
      cell.tip = nil
      cell.hover = nil
    }
  }

  func configure(_ cell: TranscriptTextCell, _ index: Int, message: RemoteMessage, text: TranscriptRendered) {
    let id = id(index)
    if cell.rowId != id || cell.revision != revision(id) || cell.environmentKey != environmentKey {
      cell.show(
        text, unit: message.id, id: id, revision: revision(id), environmentKey: environmentKey,
        tip: TranscriptMessageRow.timestamp(message))
    }
    cell.reserve = reserve
    if cell.text.links !== environment.transcriptLinks { cell.text.links = environment.transcriptLinks }
    if cell.text.selection !== selection { cell.text.selection = selection }
    cell.hover = (message, model, environment)
    applyFind(cell)
  }

  /// Find's highlights and reveal, which a hosted row reads from the model itself.
  private func applyFind(_ cell: TranscriptTextCell) {
    let unit = TranscriptModel.textUnit(cell.rowId)
    let current = model.currentHit.flatMap { $0.unitId == unit ? $0.range : nil }
    cell.text.setHighlights(model.hitsByUnit[unit] ?? [], current: current)
    let token = current == nil ? 0 : model.pendingReveal
    if token != 0, token != cell.text.lastReveal, let current {
      cell.text.lastReveal = token
      cell.text.reveal(current)
      model.revealedToken = token
    }
  }

  /// Text cells redraw find state when it changes; hosted rows observe it.
  func observeFind() {
    withObservationTracking {
      _ = model.hitsByUnit
      _ = model.currentHit
      _ = model.pendingReveal
    } onChange: { [weak self] in
      DispatchQueue.main.async {
        guard let self else { return }
        self.observeFind()
        let visible = self.table.rows(in: self.scrollView.contentView.bounds)
        for index in visible.location..<(visible.location + visible.length) {
          if let cell = self.table.view(atColumn: 0, row: index, makeIfNecessary: false) as? TranscriptTextCell {
            self.applyFind(cell)
          }
        }
      }
    }
  }

  func configureVisibleCell(_ index: Int) {
    guard index < table.numberOfRows else { return }
    switch table.view(atColumn: 0, row: index, makeIfNecessary: false) {
    case let cell as TranscriptTextCell:
      // A message that gained a tool call or badge needs the other kind of cell.
      if let (message, text) = plainText(index) {
        configure(cell, index, message: message, text: text)
      } else {
        instantly { table.reloadData(forRowIndexes: [index], columnIndexes: [0]) }
      }
    case let cell as TranscriptCell:
      if plainText(index) != nil {
        instantly { table.reloadData(forRowIndexes: [index], columnIndexes: [0]) }
      } else {
        configure(cell, index)
      }
    default:
      break
    }
  }

  /// AppKit animates row heights, inserts and removes by default, which slides
  /// rows into place mid-scroll; every table change here lands in one frame.
  func instantly(_ body: () -> Void) {
    NSAnimationContext.beginGrouping()
    NSAnimationContext.current.duration = 0
    NSAnimationContext.current.allowsImplicitAnimation = false
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    body()
    CATransaction.commit()
    NSAnimationContext.endGrouping()
  }

  /// What a row is, for perf logs.
  func kind(_ index: Int) -> String {
    switch row(index) {
    case .top: "top"
    case .footer: "footer"
    case .segment(.single(let message)): message.toolCalls.isEmpty ? "message" : "message+\(message.toolCalls.first?.name ?? "")"
    case .segment: "run"
    case .work: "work"
    }
  }
}
