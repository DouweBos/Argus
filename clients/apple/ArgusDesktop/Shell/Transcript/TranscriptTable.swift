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
final class TranscriptCell: TranscriptHoverCell {
  static let identifier = NSUserInterfaceItemIdentifier("transcript-row")

  let host = TranscriptHostingView(rootView: AnyView(EmptyView()))
  private(set) var rowId = ""
  private(set) var revision = -1
  private(set) var environmentKey = ""
  /// The height its content last laid out at, reported by the row itself.
  var laidOutHeight: CGFloat?

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
    laidOutHeight = nil
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

  /// What row it shows, for perf logs.
  var kind = ""

  override func layout() {
    TranscriptPerfLog.time("layout\(isHiddenOrHasHiddenAncestor ? ".staged" : "").\(kind)") { super.layout() }
  }
}

/// Code blocks, tables and diffs scroll sideways in scroll views of their own,
/// AppKit's or SwiftUI's, which swallow a vertical wheel and its momentum;
/// `takeWheel` hands a vertical gesture over any row to the transcript.
final class TranscriptScrollView: NSScrollView {
  /// A wheel toward older messages, which ends following the tail.
  var onScrollUp: () -> Void = {}

  #if DEBUG
    /// Wheel events that reached the transcript, for the dev driver's fling probe.
    static var wheelsReceived = 0
  #endif

  override func scrollWheel(with event: NSEvent) {
    #if DEBUG
      Self.wheelsReceived += 1
    #endif
    if event.scrollingDeltaY > 0.5 { onScrollUp() }
    super.scrollWheel(with: event)
  }

  /// Decided on a gesture's first moving event and kept through its momentum,
  /// so a fling never changes hands when a card passes under the pointer.
  private var latched: Bool?

  func takeWheel(_ event: NSEvent) -> Bool {
    guard let window, event.window == nil || event.window === window else { return false }
    let fresh = event.phase.contains(.began) || event.phase.contains(.mayBegin)
      || (event.phase.isEmpty && event.momentumPhase.isEmpty)
    if fresh { latched = nil }
    let moving = event.scrollingDeltaX != 0 || event.scrollingDeltaY != 0
    if latched == nil, moving {
      latched = abs(event.scrollingDeltaY) >= abs(event.scrollingDeltaX) && overRow(event, in: window)
    }
    let take = latched ?? false
    if event.momentumPhase.contains(.ended) || event.momentumPhase.contains(.cancelled)
      || (event.momentumPhase.isEmpty && event.phase.isEmpty)
    {
      latched = nil
    }
    if take { scrollWheel(with: event) }
    return take
  }

  /// Inside a row, where something other than the table may take the wheel.
  private func overRow(_ event: NSEvent, in window: NSWindow) -> Bool {
    // A windowless event carries a screen point.
    let point = event.window == nil ? window.convertPoint(fromScreen: event.locationInWindow) : event.locationInWindow
    let local = convert(point, from: nil)
    guard let table = documentView, bounds.contains(local),
      let hit = window.contentView?.superview?.hitTest(point)
    else { return false }
    return hit !== table && hit.isDescendant(of: table)
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
final class TranscriptTextCell: TranscriptHoverCell {
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
    self.tip = tip.isEmpty ? nil : tip
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

/// A row that shows its message's hover bar while the pointer is on it, at
/// the top of the part on screen: a long message's top is often far above.
class TranscriptHoverCell: NSTableCellView {
  /// What the bar acts on, when the row is one message with text.
  var hover: (message: RemoteMessage, model: TranscriptModel, environment: EnvironmentValues)? {
    didSet { if hover == nil { hoverBar.hide() } }
  }
  private(set) lazy var hoverBar = TranscriptHoverBarHost(cell: self)
  /// Shown as the tooltip while the pointer is on the row only: AppKit
  /// re-evaluates every view's tooltip on each scrolled frame.
  var tip: String? {
    didSet { if toolTip != nil { toolTip = tip } }
  }

  override init(frame: NSRect) {
    super.init(frame: frame)
    addTrackingArea(
      NSTrackingArea(
        rect: .zero, options: [.mouseEnteredAndExited, .mouseMoved, .activeInActiveApp, .inVisibleRect],
        owner: self))
  }

  required init?(coder: NSCoder) { fatalError() }

  override var isFlipped: Bool { true }

  override func mouseEntered(with event: NSEvent) { follow(event) }
  override func mouseMoved(with event: NSEvent) { follow(event) }
  override func mouseExited(with event: NSEvent) { leave() }

  /// Leaving the window never sends an exit; a tip left set would show wherever it lands next.
  override func viewWillMove(toWindow newWindow: NSWindow?) {
    super.viewWillMove(toWindow: newWindow)
    if newWindow == nil { leave() }
  }

  /// Tracking areas fire under whatever covers the row (the sidebar, the
  /// palette), so the tip and bar only show while the row is what's under the pointer.
  private func follow(_ event: NSEvent) {
    guard window?.contentView?.superview?.hitTest(event.locationInWindow)?.isDescendant(of: self) == true else {
      return leave()
    }
    if toolTip != tip { toolTip = tip }
    showHoverBar()
  }

  private func leave() {
    toolTip = nil
    hoverBar.hide()
  }

  override func prepareForReuse() {
    super.prepareForReuse()
    toolTip = nil
    hoverBar.hide()
  }

  private func showHoverBar() {
    guard let hover else { return }
    var frame = TranscriptTextCell.textFrame(in: bounds)
    frame.origin.y = max(frame.minY, visibleRect.minY + 4)
    hoverBar.show(hover.message, model: hover.model, environment: hover.environment, in: frame)
  }
}
