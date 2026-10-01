import AppKit
import ArgusCore
import SwiftUI

/// Selectable transcript text on TextKit 2. SwiftUI `Text` can't select across
/// lines, hit-test links in long runs, or highlight find matches without
/// re-laying out; an `NSTextView` does all three and only lays out what changed.
struct TranscriptText: NSViewRepresentable {
  /// Compared by identity: the render cache hands back the same instance
  /// until the message changes, so an unchanged row never resets its storage.
  let text: NSAttributedString
  var highlights: [NSRange] = []
  var current: NSRange?
  /// Bumped when find moves onto a match here, to scroll that line into view.
  var revealToken = 0
  /// Take the whole proposed width rather than hugging the longest line.
  var fills = true

  @Environment(\.transcriptLinks) private var links

  func makeNSView(context: Context) -> TranscriptNSTextView {
    TranscriptNSTextView.make()
  }

  func updateNSView(_ view: TranscriptNSTextView, context: Context) {
    view.links = links
    view.setContent(text)
    view.setHighlights(highlights, current: current)
    if revealToken != view.revealedToken {
      view.revealedToken = revealToken
      if let current { view.reveal(current) }
    }
  }

  func sizeThatFits(_ proposal: ProposedViewSize, nsView: TranscriptNSTextView, context: Context) -> CGSize? {
    nsView.size(forWidth: proposal.width, fills: fills)
  }
}

final class TranscriptNSTextView: NSTextView, NSTextViewDelegate {
  weak var links: TranscriptLinkHandler?
  var revealedToken = 0

  private var content: NSAttributedString?
  private var highlighted: ([NSRange], NSRange?) = ([], nil)
  /// Height per laid-out width; a row is measured far more often than it changes.
  private var sizes: [CGFloat: CGSize] = [:]
  private let blocks = BlockLayoutDelegate()

  static func make() -> TranscriptNSTextView {
    let view = TranscriptNSTextView(usingTextLayoutManager: true)
    view.isEditable = false
    view.isSelectable = true
    view.isRichText = true
    view.drawsBackground = false
    view.textContainerInset = .zero
    view.textContainer?.lineFragmentPadding = 0
    view.textContainer?.widthTracksTextView = true
    view.isVerticallyResizable = false
    view.isHorizontallyResizable = false
    view.isAutomaticLinkDetectionEnabled = false
    view.linkTextAttributes = [
      .foregroundColor: TranscriptStyle.accent,
      .cursor: NSCursor.pointingHand,
    ]
    view.textLayoutManager?.delegate = view.blocks
    view.delegate = view
    view.setContentHuggingPriority(.defaultLow, for: .horizontal)
    return view
  }

  func setContent(_ text: NSAttributedString) {
    guard content !== text else { return }
    content = text
    sizes = [:]
    usedWidths = [:]
    highlighted = ([], nil)
    textStorage?.setAttributedString(text)
    invalidateIntrinsicContentSize()
  }

  /// The size for a proposed width; nil asks for the natural (unwrapped) width.
  func size(forWidth proposed: CGFloat?, fills: Bool) -> CGSize {
    let width = proposed.map { $0.isFinite ? max($0, 1) : 100_000 } ?? 100_000
    if let cached = sizes[width] { return fills || width == 100_000 ? cached : hugging(cached) }
    guard let layout = textLayoutManager, let container = textContainer else { return .zero }
    let previous = container.size
    container.size = CGSize(width: width, height: .greatestFiniteMagnitude)
    layout.ensureLayout(for: layout.documentRange)
    let used = layout.usageBoundsForTextContainer
    let size = CGSize(
      width: width == 100_000 ? ceil(used.width) : width,
      height: ceil(used.height))
    if previous.width != width, frame.width > 0 { container.size = previous }
    sizes[width] = size
    usedWidths[width] = ceil(used.width)
    return fills ? size : hugging(size)
  }

  private var usedWidths: [CGFloat: CGFloat] = [:]

  private func hugging(_ size: CGSize) -> CGSize {
    CGSize(width: min(size.width, usedWidths[size.width] ?? size.width), height: size.height)
  }

  // MARK: Find highlights

  func setHighlights(_ ranges: [NSRange], current: NSRange?) {
    guard highlighted.0 != ranges || highlighted.1 != current,
      let layout = textLayoutManager
    else { return }
    highlighted = (ranges, current)
    layout.removeRenderingAttribute(.backgroundColor, for: layout.documentRange)
    layout.removeRenderingAttribute(.foregroundColor, for: layout.documentRange)
    for range in ranges {
      guard let textRange = textRange(range) else { continue }
      let isCurrent = range == current
      layout.addRenderingAttribute(
        .backgroundColor,
        value: isCurrent ? TranscriptStyle.currentMatchBackground : TranscriptStyle.matchBackground,
        for: textRange)
      if isCurrent {
        layout.addRenderingAttribute(
          .foregroundColor, value: TranscriptStyle.currentMatchText, for: textRange)
      }
    }
    needsDisplay = true
  }

  /// Scrolls the enclosing transcript so `range` is on screen — a long message
  /// can hold its match well below the row's top.
  func reveal(_ range: NSRange) {
    guard let layout = textLayoutManager, let textRange = textRange(range) else { return }
    var rect = CGRect.null
    layout.enumerateTextSegments(in: textRange, type: .standard, options: []) { _, frame, _, _ in
      rect = rect.union(frame)
      return true
    }
    guard !rect.isNull else { return }
    DispatchQueue.main.async { [weak self] in
      self?.scrollToVisible(rect.insetBy(dx: 0, dy: -60))
    }
  }

  private func textRange(_ range: NSRange) -> NSTextRange? {
    guard let manager = textLayoutManager?.textContentManager,
      let start = manager.location(manager.documentRange.location, offsetBy: range.location),
      let end = manager.location(start, offsetBy: range.length)
    else { return nil }
    return NSTextRange(location: start, end: end)
  }

  // MARK: Links

  func textView(_ textView: NSTextView, clickedOnLink link: Any, at charIndex: Int) -> Bool {
    guard let url = link as? URL else { return false }
    links?.open(url)
    return true
  }

  override func menu(for event: NSEvent) -> NSMenu? {
    let menu = super.menu(for: event) ?? NSMenu()
    let point = convert(event.locationInWindow, from: nil)
    let index = characterIndexForInsertion(at: point)
    guard let storage = textStorage, index < storage.length,
      let url = storage.attribute(.link, at: index, effectiveRange: nil) as? URL,
      let items = links?.menuItems(for: url), !items.isEmpty
    else { return menu }
    for item in items.reversed() { menu.insertItem(item, at: 0) }
    menu.insertItem(.separator(), at: items.count)
    return menu
  }

  // MARK: Copy

  /// Code fences are laid out on line separators; the clipboard wants newlines.
  override func writeSelection(to pboard: NSPasteboard, types: [NSPasteboard.PasteboardType]) -> Bool {
    let text = selectedRanges.map { (string as NSString).substring(with: $0.rangeValue) }
      .joined(separator: "\n")
      .replacingOccurrences(of: TranscriptMarkdown.lineSeparator, with: "\n")
      .replacingOccurrences(of: "\u{00A0}", with: "")
    guard !text.isEmpty else { return false }
    pboard.clearContents()
    return pboard.setString(text, forType: .string)
  }

  override var writablePasteboardTypes: [NSPasteboard.PasteboardType] { [.string] }

  /// The transcript scrolls; this view never does.
  override func scrollWheel(with event: NSEvent) {
    nextResponder?.scrollWheel(with: event)
  }
}

/// Swaps in a fragment that draws a code box, quote bar or rule behind
/// paragraphs the renderer marked as blocks.
private final class BlockLayoutDelegate: NSObject, NSTextLayoutManagerDelegate {
  func textLayoutManager(
    _ textLayoutManager: NSTextLayoutManager, textLayoutFragmentFor location: NSTextLocation,
    in textElement: NSTextElement
  ) -> NSTextLayoutFragment {
    guard let paragraph = textElement as? NSTextParagraph,
      paragraph.attributedString.length > 0,
      let raw = paragraph.attributedString.attribute(.transcriptBlock, at: 0, effectiveRange: nil) as? Int,
      let block = TranscriptBlock(rawValue: raw)
    else {
      return NSTextLayoutFragment(textElement: textElement, range: textElement.elementRange)
    }
    let fragment = BlockLayoutFragment(textElement: textElement, range: textElement.elementRange)
    fragment.block = block
    return fragment
  }
}

private final class BlockLayoutFragment: NSTextLayoutFragment {
  var block: TranscriptBlock = .code

  private var backdrop: CGRect {
    let lines = textLineFragments.reduce(CGRect.null) { $0.union($1.typographicBounds) }
    guard !lines.isNull else { return .zero }
    let width = textLayoutManager?.textContainer?.size.width ?? layoutFragmentFrame.width
    let paragraphStyle = textLineFragments.first.flatMap {
      $0.attributedString.attribute(.paragraphStyle, at: $0.characterRange.location, effectiveRange: nil)
        as? NSParagraphStyle
    }
    let top = lines.minY + (paragraphStyle?.paragraphSpacingBefore ?? 0) - 5
    let bottom = lines.minY + lines.height - (paragraphStyle?.paragraphSpacing ?? 0) + 5
    return CGRect(x: -layoutFragmentFrame.minX, y: top, width: min(width, 100_000), height: bottom - top)
  }

  override var renderingSurfaceBounds: CGRect {
    super.renderingSurfaceBounds.union(backdrop)
  }

  override func draw(at point: CGPoint, in context: CGContext) {
    let rect = backdrop.offsetBy(dx: point.x, dy: point.y)
    context.saveGState()
    switch block {
    case .code:
      context.setFillColor(TranscriptStyle.codeBackground.cgColor)
      context.addPath(CGPath(roundedRect: rect, cornerWidth: 6, cornerHeight: 6, transform: nil))
      context.fillPath()
    case .quote:
      context.setFillColor(NSColor.separatorColor.cgColor)
      context.fill(CGRect(x: rect.minX, y: rect.minY + 4, width: 3, height: rect.height - 8))
    case .rule:
      context.setFillColor(TranscriptStyle.rule.cgColor)
      context.fill(CGRect(x: rect.minX, y: rect.midY, width: rect.width, height: 1))
    }
    context.restoreGState()
    if block != .rule { super.draw(at: point, in: context) }
  }
}
