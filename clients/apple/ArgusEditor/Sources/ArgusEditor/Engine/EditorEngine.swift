import AppKit
@preconcurrency import CodeEditTextView

/// The CodeEditTextView stack for one document. It lives as long as the document (not the
/// SwiftUI view), so undo history, selection and scroll position survive the view going away.
@MainActor final class EditorEngine {
  let scrollView: NSScrollView
  let textView: ArgusTextView
  let decorations = DecorationView()
  private(set) var theme = EditorTheme.default
  private(set) var configuration: EditorConfiguration
  private let invisibles = InvisiblesProvider()
  private var observers: [NSObjectProtocol] = []
  var onViewportChange: (() -> Void)?

  init(text: String, configuration: EditorConfiguration) {
    self.configuration = configuration
    // The text view must sit in a scroll view before it gets its text: without one its visible
    // rect is unbounded and it lays out (and creates a view for) every line.
    scrollView = NSScrollView(frame: NSRect(x: 0, y: 0, width: 800, height: 600))
    textView = ArgusTextView(
      string: "", font: Self.font(for: configuration), textColor: .labelColor, lineHeightMultiplier: 1.25,
      wrapLines: configuration.wrapLines, isEditable: true, isSelectable: true, letterSpacing: 1.0)
    scrollView.hasVerticalScroller = true
    scrollView.hasHorizontalScroller = !configuration.wrapLines
    scrollView.autohidesScrollers = true
    scrollView.drawsBackground = true
    scrollView.contentView.postsBoundsChangedNotifications = true
    scrollView.documentView = textView
    textView.setText(text)
    textView.edgeInsets = HorizontalEdgeInsets(left: 6, right: 12)
    textView.overscrollAmount = 0.3
    textView.typingAttributes[.paragraphStyle] = paragraphStyle(configuration)
    textView.installGestures()
    decorations.textView = textView
    textView.addSubview(decorations, positioned: .below, relativeTo: nil)
    apply(theme)
    observers.append(
      NotificationCenter.default.addObserver(
        forName: NSView.boundsDidChangeNotification, object: scrollView.contentView, queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated { self?.viewportChanged() }
      })
    observers.append(
      NotificationCenter.default.addObserver(
        forName: NSView.frameDidChangeNotification, object: scrollView, queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated { self?.viewportChanged() }
      })
  }

  isolated deinit {
    observers.forEach(NotificationCenter.default.removeObserver)
  }

  var textStorage: NSTextStorage { textView.textStorage }
  var undoManager: CEUndoManager? { textView._undoManager }

  func viewportChanged() {
    decorations.follow(textView.visibleRect)
    onViewportChange?()
  }

  // MARK: Configuration

  func apply(_ configuration: EditorConfiguration) {
    let old = self.configuration
    self.configuration = configuration
    if old.fontName != configuration.fontName || old.fontSize != configuration.fontSize || old.tabWidth != configuration.tabWidth {
      let font = Self.font(for: configuration)
      textView.font = font
      textView.typingAttributes[.paragraphStyle] = paragraphStyle(configuration)
      let all = NSRange(location: 0, length: textStorage.length)
      textStorage.beginEditing()
      textStorage.addAttributes([.font: font, .paragraphStyle: paragraphStyle(configuration)], range: all)
      textStorage.endEditing()
      textView.layoutManager.setNeedsLayout()
    }
    if old.wrapLines != configuration.wrapLines {
      textView.wrapLines = configuration.wrapLines
      scrollView.hasHorizontalScroller = !configuration.wrapLines
      textView.updateFrameIfNeeded()
    }
    if old.showInvisibles != configuration.showInvisibles {
      applyInvisibles()
    }
  }

  static func font(for configuration: EditorConfiguration) -> NSFont {
    if let name = configuration.fontName, let font = NSFont(name: name, size: configuration.fontSize) {
      return font
    }
    return .monospacedSystemFont(ofSize: configuration.fontSize, weight: .regular)
  }

  private func paragraphStyle(_ configuration: EditorConfiguration) -> NSParagraphStyle {
    let style = NSMutableParagraphStyle()
    let space = (" " as NSString).size(withAttributes: [.font: Self.font(for: configuration)]).width
    style.tabStops = []
    style.defaultTabInterval = space * CGFloat(max(1, configuration.tabWidth))
    return style
  }

  private func applyInvisibles() {
    invisibles.color = theme.invisible
    invisibles.font = Self.font(for: configuration)
    textView.layoutManager.invisibleCharacterDelegate = configuration.showInvisibles ? invisibles : nil
    textView.layoutManager.setNeedsLayout()
    textView.needsLayout = true
  }

  // MARK: Theme

  func apply(_ theme: EditorTheme) {
    self.theme = theme
    scrollView.backgroundColor = theme.background
    textView.textColor = theme.text
    textView.selectionManager.selectionBackgroundColor = theme.selection
    textView.selectionManager.selectedLineBackgroundColor = theme.currentLine
    textView.selectionManager.insertionPointColor = theme.insertionPoint
    textView.selectionManager.highlightSelectedLine = true
    decorations.matchColor = theme.warning.withAlphaComponent(0.25)
    decorations.currentMatchColor = theme.warning.withAlphaComponent(0.6)
    applyInvisibles()
    textView.needsDisplay = true
  }

  // MARK: Geometry

  /// The line's frame in text view coordinates, laying it out if it's off screen.
  func rect(forLine line: Int) -> NSRect? {
    guard let position = textView.layoutManager.textLineForIndex(line) else { return nil }
    return NSRect(x: 0, y: position.yPos, width: textView.frame.width, height: position.height)
  }

  var firstVisibleLine: (line: Int, offset: CGFloat)? {
    let top = textView.visibleRect.minY
    guard let position = textView.layoutManager.textLineForPosition(max(0, top)) else { return nil }
    return (position.index, top - position.yPos)
  }

  func scroll(toLine line: Int, offset: CGFloat) {
    guard let rect = rect(forLine: line) else { return }
    let y = max(0, rect.minY + offset)
    scrollView.contentView.scroll(to: NSPoint(x: scrollView.contentView.bounds.minX, y: y))
    scrollView.reflectScrolledClipView(scrollView.contentView)
  }

  /// Puts `range` on screen, a third of the way down when it has to move.
  func center(_ range: NSRange) {
    textView.layoutManager.layoutLines()
    guard let rect = textView.layoutManager.rectForOffset(range.location) else { return }
    let visible = textView.visibleRect
    if visible.insetBy(dx: 0, dy: rect.height).contains(rect) { return }
    let y = max(0, rect.minY - visible.height / 3)
    let x = rect.minX < visible.minX || rect.maxX > visible.maxX ? max(0, rect.minX - visible.width / 2) : visible.minX
    scrollView.contentView.scroll(to: NSPoint(x: x, y: y))
    scrollView.reflectScrolledClipView(scrollView.contentView)
  }
}

/// Dots for spaces, arrows for tabs, a return glyph for line ends.
final class InvisiblesProvider: InvisibleCharactersDelegate {
  var color: NSColor = .tertiaryLabelColor
  var font: NSFont = .monospacedSystemFont(ofSize: 13, weight: .regular)
  let triggerCharacters: Set<UInt16> = [0x20, 0x09, 0x0A]

  func invisibleStyleShouldClearCache() -> Bool { true }

  func invisibleStyle(for character: UInt16, at range: NSRange, lineRange: NSRange) -> InvisibleCharacterStyle? {
    switch character {
    case 0x20: .replace(replacementCharacter: "·", color: color, font: font)
    case 0x09: .replace(replacementCharacter: "→", color: color, font: font)
    case 0x0A: .replace(replacementCharacter: "¬", color: color, font: font)
    default: nil
    }
  }
}
