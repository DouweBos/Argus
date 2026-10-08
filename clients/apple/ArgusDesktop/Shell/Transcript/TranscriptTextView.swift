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
  var onRevealed: (Int) -> Void = { _ in }

  @Environment(\.transcriptLinks) private var links

  func makeNSView(context: Context) -> TranscriptNSTextView {
    TranscriptNSTextView.make()
  }

  func updateNSView(_ view: TranscriptNSTextView, context: Context) {
    view.links = links
    view.setContent(text)
    view.setHighlights(highlights, current: current)
    if revealToken != 0, revealToken != view.lastReveal, let current {
      view.lastReveal = revealToken
      view.reveal(current)
      let token = revealToken
      DispatchQueue.main.async { onRevealed(token) }
    }
  }

  func sizeThatFits(_ proposal: ProposedViewSize, nsView: TranscriptNSTextView, context: Context) -> CGSize? {
    nsView.size(forWidth: proposal.width, fills: fills)
  }
}

final class TranscriptNSTextView: NSTextView, NSTextViewDelegate {
  weak var links: TranscriptLinkHandler?
  var lastReveal = 0

  /// The message this text belongs to, for selections that run across
  /// messages; nil for tool output, which selects on its own.
  private(set) var unit: String?
  /// Where this text starts in its message's rendered string, and that string's length.
  private(set) var base = 0
  private(set) var messageLength = 0
  weak var selection: TranscriptSelection? {
    didSet { selection?.register(self) }
  }

  private var content: NSAttributedString?
  private var highlighted: ([NSRange], NSRange?) = ([], nil)
  private let blocks = BlockLayoutDelegate()
  var cursorArea: NSTrackingArea?

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
      .underlineStyle: NSUnderlineStyle.single.rawValue,
      .underlineColor: TranscriptStyle.linkUnderline,
      .cursor: NSCursor.pointingHand,
    ]
    // Only a background: highlighted code keeps its colours when selected.
    view.selectedTextAttributes = [.backgroundColor: NSColor.selectedTextBackgroundColor]
    view.textLayoutManager?.delegate = view.blocks
    view.delegate = view
    view.setContentHuggingPriority(.defaultLow, for: .horizontal)
    return view
  }

  func setContent(_ text: NSAttributedString) {
    guard content !== text else { return }
    content = text
    highlighted = ([], nil)
    textStorage?.setAttributedString(text)
    layoutWholeDocument()
    showSelection()
  }

  /// Which message this text is part of, and where in it.
  func setUnit(_ unit: String?, base: Int, messageLength: Int) {
    guard unit != self.unit || base != self.base || messageLength != self.messageLength else { return }
    self.unit = unit
    self.base = base
    self.messageLength = messageLength
    showSelection()
  }

  /// Each row is its own view sized to all of its text, so lay all of it out.
  /// TextKit 2 otherwise lays out from the viewport with estimated heights for
  /// the part scrolled off above, and a long message draws its lines too high.
  override func setFrameSize(_ newSize: NSSize) {
    let widthChanged = newSize.width != frame.width
    super.setFrameSize(newSize)
    if widthChanged { layoutWholeDocument() }
  }

  private func layoutWholeDocument() {
    guard let layout = textLayoutManager else { return }
    layout.ensureLayout(for: layout.documentRange)
  }

  /// The size for a proposed width; nil asks for the natural (unwrapped) width.
  /// Measured off to the side: resizing this view's own container mid-layout
  /// invalidates the hosting view and can keep SwiftUI laying out forever.
  /// Stacks also probe with zero and unbounded widths; laying out at those (a 1pt
  /// container puts every glyph on its own line) tells a filling view nothing.
  func size(forWidth proposed: CGFloat?, fills: Bool) -> CGSize {
    guard let content else { return .zero }
    return Self.size(of: content, forWidth: proposed, fills: fills)
  }

  static func size(of content: NSAttributedString, forWidth proposed: CGFloat?, fills: Bool) -> CGSize {
    guard let proposed, proposed.isFinite else {
      return fills ? CGSize(width: 10_000, height: 0) : TextMeasurer.size(of: content, width: nil)
    }
    guard proposed >= 24 else { return CGSize(width: max(proposed, 0), height: 0) }
    let width = (proposed * 2).rounded(.down) / 2
    let used = TextMeasurer.size(of: content, width: width)
    return CGSize(width: fills ? width : min(used.width, width), height: used.height)
  }

  // MARK: Selection

  /// This view's share of the transcript's selection.
  func showSelection() {
    guard let unit, let selection, let storage = textStorage else { return }
    let length = storage.length
    var local = NSRange(location: min(selectedRange().location, length), length: 0)
    if let range = selection.range(in: unit, length: messageLength) {
      let mine = NSRange(location: base, length: length)
      let overlap = NSIntersectionRange(range, mine)
      if overlap.length > 0 || (range.length == 0 && NSLocationInRange(range.location, mine)) {
        local = NSRange(location: overlap.location - base, length: overlap.length)
      }
    } else {
      local.length = 0
    }
    if selectedRange() != local { setSelectedRange(local) }
  }

  var startPosition: TranscriptSelection.Position? {
    unit.map { TranscriptSelection.Position(unit: $0, index: base) }
  }

  var endPosition: TranscriptSelection.Position? {
    unit.map { TranscriptSelection.Position(unit: $0, index: base + (textStorage?.length ?? 0)) }
  }

  func position(atWindowPoint point: NSPoint) -> TranscriptSelection.Position? {
    guard let unit else { return nil }
    return TranscriptSelection.Position(unit: unit, index: base + localIndex(atWindowPoint: point))
  }

  func localIndex(atWindowPoint point: NSPoint) -> Int {
    let local = convert(point, from: nil)
    let length = textStorage?.length ?? 0
    if local.y < bounds.minY { return 0 }
    if local.y > bounds.maxY { return length }
    return min(max(characterIndexForInsertion(at: local), 0), length)
  }

  override func selectAll(_ sender: Any?) {
    guard let unit, let selection else { return super.selectAll(sender) }
    selection.select(unit: unit, length: messageLength)
  }

  override func copy(_ sender: Any?) {
    let text: String?
    var span = MacTelemetryEvent.CopySpan.selection
    if let selection, unit != nil, !selection.isEmpty {
      text = selection.selectedText
      if selection.spansMessages { span = .acrossMessages }
    } else {
      text = selectedRanges.map { (string as NSString).substring(with: $0.rangeValue) }.joined(separator: "\n")
    }
    guard let text, !text.isEmpty else { return NSSound.beep() }
    TranscriptSystem.copy(Self.clipboardText(text))
    MacTelemetry.capture(.transcriptCopied(span: span))
  }

  /// Tables are laid out on line separators; the clipboard wants newlines.
  static func clipboardText(_ text: String) -> String {
    text.replacingOccurrences(of: TranscriptMarkdown.lineSeparator, with: "\n")
      .replacingOccurrences(of: "\u{00A0}", with: "")
  }

  override func validateMenuItem(_ item: NSMenuItem) -> Bool {
    if item.action == #selector(copy(_:)), let selection, unit != nil { return !selection.isEmpty }
    return super.validateMenuItem(item)
  }

  // MARK: Find highlights

  /// Ranges are in the message's string; only those in this text are drawn.
  func setHighlights(_ ranges: [NSRange], current: NSRange?) {
    let length = textStorage?.length ?? 0
    let mine = NSRange(location: base, length: length)
    func local(_ range: NSRange) -> NSRange? {
      let overlap = NSIntersectionRange(range, mine)
      return overlap.length > 0 ? NSRange(location: overlap.location - base, length: overlap.length) : nil
    }
    let shifted = ranges.compactMap(local)
    let current = current.flatMap(local)
    guard highlighted.0 != shifted || highlighted.1 != current else { return }
    highlighted = (shifted, current)
    needsDisplay = true
  }

  /// Matches are painted under the text from its segment rects. TextKit 2's
  /// rendering attributes would need a validator pass on every fragment, and
  /// changing them doesn't reliably redraw fragments already on screen.
  override func draw(_ dirtyRect: NSRect) {
    if !highlighted.0.isEmpty, let layout = textLayoutManager {
      for range in highlighted.0 {
        guard let textRange = textRange(range) else { continue }
        let color = range == highlighted.1 ? TranscriptStyle.currentMatchBackground : TranscriptStyle.matchBackground
        color.setFill()
        let origin = textContainerOrigin
        layout.enumerateTextSegments(in: textRange, type: .highlight, options: []) { _, frame, _, _ in
          let rect = frame.offsetBy(dx: origin.x, dy: origin.y).insetBy(dx: -1, dy: 0)
          if rect.intersects(dirtyRect) {
            NSBezierPath(roundedRect: rect, xRadius: 3, yRadius: 3).fill()
          }
          return true
        }
      }
    }
    super.draw(dirtyRect)
  }

  /// Scrolls the enclosing transcript so `range` (in the message's string) is
  /// on screen; false when the range isn't in this text.
  @discardableResult
  func reveal(_ range: NSRange) -> Bool {
    let length = textStorage?.length ?? 0
    guard range.location >= base, range.location < base + max(length, 1) else { return false }
    let local = NSRange(location: range.location - base, length: min(range.length, length - (range.location - base)))
    guard let layout = textLayoutManager, let textRange = textRange(local) else { return false }
    var rect = CGRect.null
    layout.enumerateTextSegments(in: textRange, type: .standard, options: []) { _, frame, _, _ in
      rect = rect.union(frame)
      return true
    }
    guard !rect.isNull else { return false }
    rect = rect.offsetBy(dx: textContainerOrigin.x, dy: textContainerOrigin.y)
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      // A code block scrolls sideways itself; the transcript scrolls for the rest.
      self.scrollToVisible(rect.insetBy(dx: 0, dy: -60))
      if let table = self.transcriptTable, self.enclosingScrollView?.documentView !== table {
        table.scrollToVisible(self.convert(rect.insetBy(dx: 0, dy: -60), to: table))
      }
    }
    return true
  }

  func textRange(_ range: NSRange) -> NSTextRange? {
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
    // Copy and friends act on the first responder.
    if window?.firstResponder !== self { window?.makeFirstResponder(self) }
    let menu = super.menu(for: event) ?? NSMenu()
    guard let url = link(atWindowPoint: event.locationInWindow), let items = links?.menuItems(for: url), !items.isEmpty
    else { return menu }
    for item in items.reversed() { menu.insertItem(item, at: 0) }
    menu.insertItem(.separator(), at: items.count)
    return menu
  }

  override var writablePasteboardTypes: [NSPasteboard.PasteboardType] { [.string] }

  /// The transcript scrolls; this view never does.
  override func scrollWheel(with event: NSEvent) {
    nextResponder?.scrollWheel(with: event)
  }
}

/// Lays text out on a private TextKit 2 stack. Sizes are cached per string
/// (by identity — the render cache hands out one instance per message) and
/// width, so a row the lazy stack recreates is never laid out twice.
@MainActor
enum TextMeasurer {
  private static let storage = NSTextContentStorage()
  private static let layout: NSTextLayoutManager = {
    let layout = NSTextLayoutManager()
    let container = NSTextContainer(size: .zero)
    container.lineFragmentPadding = 0
    layout.textContainer = container
    storage.addTextLayoutManager(layout)
    return layout
  }()
  private static let cache = NSMapTable<NSAttributedString, NSMutableDictionary>(
    keyOptions: [.weakMemory, .objectPointerPersonality], valueOptions: .strongMemory)

  /// Nil width: one unwrapped line per paragraph, for hugging.
  static func size(of text: NSAttributedString, width: CGFloat?) -> CGSize {
    let key = NSNumber(value: Double(width ?? -1))
    let sizes = cache.object(forKey: text) ?? NSMutableDictionary()
    if let cached = sizes[key] as? NSValue { return cached.sizeValue }
    let layout = layout
    layout.textContainer?.size = CGSize(width: width ?? 100_000, height: 0)
    storage.textStorage?.setAttributedString(text)
    layout.ensureLayout(for: layout.documentRange)
    let used = layout.usageBoundsForTextContainer
    let size = CGSize(width: ceil(used.width), height: ceil(used.height))
    sizes[key] = NSValue(size: size)
    cache.setObject(sizes, forKey: text)
    return size
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
    let top = lines.minY + (paragraphStyle?.paragraphSpacingBefore ?? 0) - 7
    let bottom = lines.minY + lines.height - (paragraphStyle?.paragraphSpacing ?? 0) + 7
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
