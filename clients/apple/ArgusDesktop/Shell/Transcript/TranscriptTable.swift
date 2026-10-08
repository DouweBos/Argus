import AppKit
import ArgusUI
import SwiftUI

/// The transcript list: a view-based `NSTableView` of recycled rows. A lazy
/// stack re-placed every row per scroll step and could loop until the window froze.
struct TranscriptTable: NSViewRepresentable {
  let controller: TranscriptTableController
  let agentKey: String
  let messages: [RemoteMessage]
  let top: TranscriptRow.TopState
  let footer: TranscriptRow.FooterState

  func makeNSView(context: Context) -> NSScrollView {
    controller.scrollView
  }

  func updateNSView(_ view: NSScrollView, context: Context) {
    controller.update(
      agentKey: agentKey, messages: messages, top: top, footer: footer, environment: context.environment)
  }

  /// Whatever it's offered. Otherwise each resize step asks Auto Layout to
  /// measure the scroll view and its table.
  func sizeThatFits(_ proposal: ProposedViewSize, nsView: NSScrollView, context: Context) -> CGSize? {
    proposal.replacingUnspecifiedDimensions(by: CGSize(width: 400, height: 400))
  }
}

/// A recycled row: a hosting view whose root is swapped for each row shown.
final class TranscriptCell: NSTableCellView {
  static let identifier = NSUserInterfaceItemIdentifier("transcript-row")

  let host = TranscriptHostingView(rootView: AnyView(EmptyView()))
  private(set) var rowId = ""
  private(set) var revision = -1
  private(set) var environmentKey = ""

  init() {
    super.init(frame: .zero)
    identifier = Self.identifier
    // Sized by the table, never by its content's ideal size.
    host.sizingOptions = []
    host.autoresizingMask = [.width, .height]
    host.translatesAutoresizingMaskIntoConstraints = true
    addSubview(host)
  }

  required init?(coder: NSCoder) { fatalError() }

  func show(_ root: AnyView, id: String, revision: Int, environmentKey: String) {
    host.rootView = root
    rowId = id
    self.revision = revision
    self.environmentKey = environmentKey
  }

  override func layout() {
    super.layout()
    host.frame = bounds
  }
}

/// Takes the click that brings a background window forward, so a tool card
/// opens on the first click rather than the second.
final class TranscriptHostingView: NSHostingView<AnyView> {
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

/// Code blocks, tables and diffs scroll sideways in scroll views of their own,
/// which swallow a vertical wheel; `takeWheel` hands that to the transcript.
final class TranscriptScrollView: NSScrollView {
  /// Hit-testing hosted rows is not free and a wheel sends ~120 events a second.
  private var lastCheck: (point: NSPoint, time: TimeInterval, take: Bool)?

  func takeWheel(_ event: NSEvent) -> Bool {
    guard let window, event.window == nil || event.window === window,
      abs(event.scrollingDeltaY) >= abs(event.scrollingDeltaX)
    else { return false }
    let point = event.locationInWindow
    let now = ProcessInfo.processInfo.systemUptime
    let take: Bool
    if let last = lastCheck, last.point == point, now - last.time < 0.1 {
      take = last.take
    } else {
      take = overSidewaysScroller(point, in: window)
      lastCheck = (point, now, take)
    }
    if take { scrollWheel(with: event) }
    return take
  }

  private func overSidewaysScroller(_ point: NSPoint, in window: NSWindow) -> Bool {
    guard let table = documentView, convert(point, from: nil).y >= 0, bounds.contains(convert(point, from: nil)),
      let hit = window.contentView?.superview?.hitTest(point), hit.isDescendant(of: table),
      let inner = hit.enclosingScrollView, inner !== self, let document = inner.documentView
    else { return false }
    return document.frame.height <= inner.contentView.bounds.height + 1
  }
}

/// Clicks land on the rows' own controls and text; the table never selects.
final class TranscriptTableView: NSTableView {
  weak var textSelection: TranscriptSelection?

  /// A click between messages drops the text selection, as in a document.
  override func mouseDown(with event: NSEvent) {
    textSelection?.clear()
    super.mouseDown(with: event)
  }

  #if DEBUG
    /// `ARGUS_TRANSCRIPT_SYNC_SCROLL`: every wheel event handled on the main
    /// thread, so a driven build can send trackpad phases in-process.
    override class var isCompatibleWithResponsiveScrolling: Bool {
      ProcessInfo.processInfo.environment["ARGUS_TRANSCRIPT_SYNC_SCROLL"] == nil
    }
  #endif
  override var acceptsFirstResponder: Bool { false }
  override func validateProposedFirstResponder(_ responder: NSResponder, for event: NSEvent?) -> Bool { true }

  /// No overdraw: AppKit's default prepares dozens of rows at once, and a
  /// hosted row is a SwiftUI layout. Rows ahead are measured by the controller.
  override func prepareContent(in rect: NSRect) {
    super.prepareContent(in: rect.intersection(visibleRect))
  }
}

/// A text-only message as plain AppKit: the same message view the hosted rows
/// use, laid out by the table, so the tallest rows cost no SwiftUI layout.
final class TranscriptTextCell: NSTableCellView {
  static let identifier = NSUserInterfaceItemIdentifier("transcript-text")

  let text = TranscriptMessageTextView()
  private(set) var rowId = ""
  private(set) var revision = -1
  private(set) var environmentKey = ""

  init() {
    super.init(frame: .zero)
    identifier = Self.identifier
    addSubview(text)
  }

  required init?(coder: NSCoder) { fatalError() }

  override var isFlipped: Bool { true }

  func show(
    _ content: TranscriptRendered, unit: String, id: String, revision: Int, environmentKey: String, tip: String
  ) {
    rowId = id
    self.revision = revision
    self.environmentKey = environmentKey
    toolTip = tip.isEmpty ? nil : tip
    text.setContent(content, unit: unit)
    needsLayout = true
  }

  override func layout() {
    super.layout()
    text.frame = Self.textFrame(in: bounds)
  }

  /// The hosted rows' column: at most 920 wide, centred, 20 in from each side,
  /// with the 14 between rows below.
  static func textFrame(in bounds: NSRect) -> NSRect {
    let column = min(bounds.width, 920)
    let width = textWidth(for: bounds.width)
    return NSRect(x: (bounds.width - column) / 2 + 20, y: 0, width: width, height: max(bounds.height - 14, 0))
  }

  static func textWidth(for width: CGFloat) -> CGFloat {
    max(((min(width, 920) - 40) * 2).rounded(.down) / 2, 1)
  }

  static func height(of content: TranscriptRendered, width: CGFloat) -> CGFloat {
    ceil(TranscriptMessageTextView.height(of: content, width: textWidth(for: width))) + 14
  }
}
