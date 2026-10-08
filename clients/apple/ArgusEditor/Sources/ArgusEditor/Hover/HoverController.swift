import AppKit
import SwiftUI

/// After the pointer rests on a character (~400 ms), shows the diagnostics under it and the
/// language server's hover in one card.
@MainActor final class HoverController {
  unowned let document: EditorDocument
  private var dwellTask: Task<Void, Never>?
  private var dismissTask: Task<Void, Never>?
  private var popover: NSPopover?
  /// The text the open card is about; moving within it keeps the card.
  private var shownRange: NSRange?
  static let dwell: Duration = .milliseconds(400)

  init(document: EditorDocument) {
    self.document = document
  }

  func mouseMoved(to offset: Int?, at point: NSPoint) {
    if let shownRange, let offset, NSLocationInRange(offset, shownRange) || offset == NSMaxRange(shownRange) {
      dismissTask?.cancel()
      return
    }
    dwellTask?.cancel()
    if popover != nil { scheduleDismiss() }
    guard let offset else { return }
    dwellTask = Task { [weak self] in
      try? await Task.sleep(for: Self.dwell)
      guard !Task.isCancelled else { return }
      await self?.show(at: offset)
    }
  }

  func mouseExited() {
    dwellTask?.cancel()
    scheduleDismiss()
  }

  func dismiss() {
    dwellTask?.cancel()
    dismissTask?.cancel()
    popover?.close()
    popover = nil
    shownRange = nil
  }

  private func scheduleDismiss() {
    dismissTask?.cancel()
    dismissTask = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(300))
      guard let self, !Task.isCancelled else { return }
      // Leave it up while the pointer is on the card, so its buttons can be clicked.
      if let frame = popover?.contentViewController?.view.window?.frame, frame.contains(NSEvent.mouseLocation) { return }
      dismiss()
    }
  }

  /// Shows the card for `offset` now, as F8 does.
  func present(at offset: Int) {
    dwellTask?.cancel()
    dwellTask = Task { [weak self] in await self?.show(at: offset) }
  }

  /// The diagnostics covering `offset`, most severe first.
  func diagnostics(at offset: Int) -> [EditorDiagnostic] {
    document.diagnostics.filter { diagnostic in
      let range = document.nsRange(diagnostic.range)
      return NSLocationInRange(offset, range) || (range.length == 0 && range.location == offset)
    }.sorted { $0.severity < $1.severity }
  }

  private func show(at offset: Int) async {
    let found = diagnostics(at: offset)
    var hover: EditorHover?
    if let provider = document.languageProvider {
      hover = await provider.hover(at: document.position(of: offset))
      guard !Task.isCancelled else { return }
    }
    guard !found.isEmpty || hover != nil else { return }
    var range = hover?.range.map(document.nsRange) ?? NSRange(location: offset, length: 1)
    for diagnostic in found { range = NSUnionRange(range, document.nsRange(diagnostic.range)) }
    present(HoverCard(diagnostics: found, markdown: hover?.markdown, actions: document.actions), around: range, offset: offset)
  }

  private func present(_ card: HoverCard, around range: NSRange, offset: Int) {
    let textView = document.engine.textView
    guard textView.window != nil, let anchor = textView.layoutManager.rectForOffset(offset) else { return }
    popover?.close()
    let popover = NSPopover()
    popover.behavior = .semitransient
    popover.animates = false
    popover.contentViewController = NSHostingController(
      rootView: card
        .onAskAgent { [weak self] in self?.dismiss() }
        .environment(\.theme, document.engine.theme.base))
    popover.show(relativeTo: anchor, of: textView, preferredEdge: .maxY)
    self.popover = popover
    shownRange = range
  }
}
