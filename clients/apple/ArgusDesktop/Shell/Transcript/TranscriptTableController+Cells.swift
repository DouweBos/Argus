import AppKit
import ArgusCore
import SwiftUI

/// The transcript table's cells: a plain text cell for messages that are
/// only text, a recycled hosting view for the rest, and find's highlights.
extension TranscriptTableController {
  func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row index: Int) -> NSView? {
    if let (message, text) = plainText(index) {
      let cell = tableView.makeView(withIdentifier: TranscriptTextCell.identifier, owner: nil) as? TranscriptTextCell
        ?? TranscriptTextCell()
      configure(cell, index, message: message, text: text)
      return cell
    }
    let cell = tableView.makeView(withIdentifier: TranscriptCell.identifier, owner: nil) as? TranscriptCell
      ?? TranscriptCell()
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
      onHeight: { [weak self] height in self?.rowLaidOut(id, revision: revision, height: height) })
    cell.show(root, id: id, revision: revision, environmentKey: environmentKey)
    if case .segment(.single(let message)) = row(index) {
      cell.tip = TranscriptMessageRow.timestamp(message)
      cell.hover = TranscriptModel.textBlocks(message).isEmpty ? nil : (message, model, environment)
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
}
