import AppKit
import SwiftUI

/// One message's text: its prose runs as wrapping text views and each fenced
/// block as a box of its own that scrolls sideways, stacked top to bottom.
/// Plain text cells and hosted rows both draw a message with this, so they
/// lay it out, select and find in it the same way.
final class TranscriptMessageTextView: NSView {
  override var isFlipped: Bool { true }

  weak var links: TranscriptLinkHandler? {
    didSet { for view in textViews { view.links = links } }
  }
  weak var selection: TranscriptSelection? {
    didSet { for view in textViews { view.selection = selection } }
  }

  private(set) var rendered: TranscriptRendered?
  private var unit: String?
  private var proseViews: [TranscriptProseView] = []
  private var codeViews: [TranscriptCodeBlockView] = []
  /// The part views in order, prose or code.
  private var partViews: [NSView] = []
  var lastReveal = 0

  /// Between a prose run and a block, as the desktop spaces its paragraphs.
  static let gap: CGFloat = 8

  /// Every text view, in reading order.
  var textViews: [TranscriptNSTextView] {
    partViews.compactMap { ($0 as? TranscriptProseView)?.text ?? ($0 as? TranscriptCodeBlockView)?.text }
  }

  func setContent(_ rendered: TranscriptRendered, unit: String?) {
    if rendered !== self.rendered {
      self.rendered = rendered
      rebuild(rendered)
    }
    self.unit = unit
    for (view, offset) in zip(textViews, rendered.offsets) {
      view.setUnit(unit, base: offset, messageLength: rendered.length)
    }
    needsLayout = true
  }

  /// Reuses this view's part views, so a restreamed message keeps its text views.
  private func rebuild(_ rendered: TranscriptRendered) {
    var prose = 0
    var code = 0
    var views: [NSView] = []
    for part in rendered.parts {
      switch part {
      case .prose(let text):
        if prose == proseViews.count {
          let view = TranscriptProseView()
          view.text.links = links
          view.text.selection = selection
          proseViews.append(view)
        }
        proseViews[prose].setContent(text)
        views.append(proseViews[prose])
        prose += 1
      case .code(_, let text):
        if code == codeViews.count {
          let view = TranscriptCodeBlockView()
          view.text.links = links
          view.text.selection = selection
          codeViews.append(view)
        }
        codeViews[code].setContent(text)
        views.append(codeViews[code])
        code += 1
      }
    }
    for view in partViews where !views.contains(where: { $0 === view }) { view.removeFromSuperview() }
    for view in views where view.superview !== self { addSubview(view) }
    partViews = views
  }

  override func layout() {
    super.layout()
    guard let rendered else { return }
    var y: CGFloat = 0
    for (index, (part, view)) in zip(rendered.parts, partViews).enumerated() {
      if index > 0 { y += Self.gap }
      let height = Self.height(of: part, width: bounds.width)
      view.frame = NSRect(x: 0, y: y, width: bounds.width, height: height)
      y += height
    }
  }

  // MARK: Measuring

  static func height(of rendered: TranscriptRendered, width: CGFloat) -> CGFloat {
    let parts = rendered.parts.map { height(of: $0, width: width) }
    return parts.reduce(0, +) + gap * CGFloat(max(parts.count - 1, 0))
  }

  static func height(of part: TranscriptRendered.Part, width: CGFloat) -> CGFloat {
    switch part {
    case .prose(let text):
      return ceil(TextMeasurer.size(of: text, width: max(width, 1)).height)
    case .code(_, let text):
      return TranscriptCodeBlockView.height(of: text, width: width)
    }
  }

  /// What SwiftUI asks of a hosted message: the proposed width when filling,
  /// else the widest line it wraps to.
  static func size(of rendered: TranscriptRendered, forWidth proposed: CGFloat?, fills: Bool) -> CGSize {
    guard let proposed, proposed.isFinite else {
      guard !fills else { return CGSize(width: 10_000, height: 0) }
      let widths = rendered.parts.map { part -> CGFloat in
        switch part {
        case .prose(let text): TextMeasurer.size(of: text, width: nil).width
        case .code(_, let text): TranscriptCodeBlockView.naturalWidth(of: text)
        }
      }
      return CGSize(width: widths.max() ?? 0, height: 0)
    }
    guard proposed >= 24 else { return CGSize(width: max(proposed, 0), height: 0) }
    let width = (proposed * 2).rounded(.down) / 2
    let used: CGFloat
    if fills {
      used = width
    } else {
      used = rendered.parts.map { part -> CGFloat in
        switch part {
        case .prose(let text): TextMeasurer.size(of: text, width: width).width
        case .code(_, let text): min(TranscriptCodeBlockView.naturalWidth(of: text), width)
        }
      }.max() ?? 0
    }
    return CGSize(width: used, height: height(of: rendered, width: width))
  }

  // MARK: Find

  func setHighlights(_ ranges: [NSRange], current: NSRange?) {
    for view in textViews { view.setHighlights(ranges, current: current) }
  }

  func reveal(_ range: NSRange) {
    for view in textViews where view.reveal(range) { return }
  }
}

/// A prose run's text view in a scroll view of its own that never scrolls. A
/// TextKit 2 view re-lays out its viewport whenever its enclosing scroll view
/// moves; inside the transcript's, that was every text on screen, every frame.
final class TranscriptProseView: NSScrollView {
  let text = TranscriptNSTextView.make()

  init() {
    super.init(frame: .zero)
    drawsBackground = false
    hasVerticalScroller = false
    hasHorizontalScroller = false
    verticalScrollElasticity = .none
    horizontalScrollElasticity = .none
    text.autoresizingMask = [.width]
    documentView = text
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError() }

  func setContent(_ content: NSAttributedString) {
    text.setContent(content)
  }

  /// Nothing to scroll here: the wheel belongs to the transcript.
  override func scrollWheel(with event: NSEvent) {
    nextResponder?.scrollWheel(with: event)
  }

  override func layout() {
    super.layout()
    if text.frame.size != bounds.size { text.frame = NSRect(origin: .zero, size: bounds.size) }
  }
}

/// A fenced block: a tinted, bordered box whose text never wraps and scrolls
/// sideways instead. A vertical wheel over it still scrolls the transcript
/// (`TranscriptScrollView.takeWheel`).
final class TranscriptCodeBlockView: NSView {
  static let insets = NSSize(width: 16, height: 12)

  let text = TranscriptNSTextView.make()
  private let scroll = NSScrollView()
  /// Measured rather than `text.textStorage`: the measurer caches by identity,
  /// and the storage is one object for every string a streamed block grows through.
  private var content = NSAttributedString()

  override var isFlipped: Bool { true }

  init() {
    super.init(frame: .zero)
    wantsLayer = true
    layer?.cornerRadius = 6
    layer?.borderWidth = 1
    text.textContainer?.widthTracksTextView = false
    text.textContainer?.size = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
    text.isHorizontallyResizable = true
    // A text view never grows past its max size, which starts at its first frame.
    text.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
    text.autoresizingMask = []
    text.textContainerInset = Self.insets
    scroll.drawsBackground = false
    scroll.hasVerticalScroller = false
    scroll.hasHorizontalScroller = true
    scroll.autohidesScrollers = true
    scroll.verticalScrollElasticity = .none
    scroll.documentView = text
    addSubview(scroll)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError() }

  func setContent(_ content: NSAttributedString) {
    self.content = content
    text.setContent(content)
    needsLayout = true
  }

  override func layout() {
    super.layout()
    scroll.frame = bounds
    let natural = TextMeasurer.size(of: content, width: nil)
    text.frame = NSRect(
      x: 0, y: 0, width: max(ceil(natural.width) + Self.insets.width * 2, bounds.width),
      height: ceil(natural.height) + Self.insets.height * 2)
  }

  override func updateLayer() {
    layer?.backgroundColor = TranscriptStyle.codeBlockBackground.cgColor
    layer?.borderColor = TranscriptStyle.codeBlockBorder.cgColor
  }

  override var wantsUpdateLayer: Bool { true }

  static func naturalWidth(of text: NSAttributedString) -> CGFloat {
    ceil(TextMeasurer.size(of: text, width: nil).width) + insets.width * 2
  }

  /// Its text's lines, the padding, and a legacy scroller's height when the
  /// lines are too long for the width.
  static func height(of text: NSAttributedString, width: CGFloat) -> CGFloat {
    let natural = TextMeasurer.size(of: text, width: nil)
    var height = ceil(natural.height) + insets.height * 2
    if NSScroller.preferredScrollerStyle == .legacy, naturalWidth(of: text) > width {
      height += NSScroller.scrollerWidth(for: .regular, scrollerStyle: .legacy)
    }
    return height
  }
}

/// A hosted row's message text.
struct TranscriptMessageText: NSViewRepresentable {
  /// Compared by identity: the render cache hands back the same instance
  /// until the message changes, so an unchanged row never resets its storage.
  let rendered: TranscriptRendered
  let unit: String?
  var highlights: [NSRange] = []
  var current: NSRange?
  /// Bumped when find moves onto a match here, to scroll that line into view.
  var revealToken = 0
  /// Take the whole proposed width rather than hugging the longest line.
  var fills = true
  var onRevealed: (Int) -> Void = { _ in }

  @Environment(\.transcriptLinks) private var links
  @Environment(\.transcriptSelection) private var selection

  func makeNSView(context: Context) -> TranscriptMessageTextView {
    TranscriptMessageTextView()
  }

  func updateNSView(_ view: TranscriptMessageTextView, context: Context) {
    if view.links !== links { view.links = links }
    if view.selection !== selection { view.selection = selection }
    view.setContent(rendered, unit: unit)
    view.setHighlights(highlights, current: current)
    if revealToken != 0, revealToken != view.lastReveal, let current {
      view.lastReveal = revealToken
      view.reveal(current)
      let token = revealToken
      DispatchQueue.main.async { onRevealed(token) }
    }
  }

  func sizeThatFits(_ proposal: ProposedViewSize, nsView: TranscriptMessageTextView, context: Context) -> CGSize? {
    TranscriptMessageTextView.size(of: rendered, forWidth: proposal.width, fills: fills)
  }
}
