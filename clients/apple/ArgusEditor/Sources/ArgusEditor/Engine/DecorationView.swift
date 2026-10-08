import AppKit
@preconcurrency import CodeEditTextView

/// Draws under the text: flashed lines, the reveal highlight, find matches and diagnostic squiggles.
/// Sized to the visible rect (never the whole document) and moved on scroll.
final class DecorationView: NSView {
  struct LineWash {
    var lines: Range<Int>
    var color: NSColor
    var start: CFTimeInterval
    var duration: CFTimeInterval
  }

  struct Squiggle {
    var range: NSRange
    var color: NSColor
  }

  weak var textView: TextView?
  var findMatches: [NSRange] = [] { didSet { needsDisplay = true } }
  var currentMatch: NSRange? { didSet { needsDisplay = true } }
  var squiggles: [Squiggle] = [] { didSet { needsDisplay = true } }
  var matchColor: NSColor = .findHighlightColor.withAlphaComponent(0.35)
  var currentMatchColor: NSColor = .findHighlightColor
  private(set) var washes: [LineWash] = []
  private var animationTimer: Timer?

  override var isFlipped: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  func addWash(_ wash: LineWash) {
    washes.append(wash)
    needsDisplay = true
    guard animationTimer == nil else { return }
    let timer = Timer(timeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.tick() }
    }
    RunLoop.main.add(timer, forMode: .common)
    animationTimer = timer
  }

  private func tick() {
    let now = CACurrentMediaTime()
    washes.removeAll { now - $0.start > $0.duration }
    needsDisplay = true
    if washes.isEmpty {
      animationTimer?.invalidate()
      animationTimer = nil
    }
  }

  func follow(_ visibleRect: NSRect) {
    let target = visibleRect.insetBy(dx: 0, dy: -64)
    if frame != target { frame = target }
  }

  override func draw(_ dirtyRect: NSRect) {
    guard let textView, let layout = textView.layoutManager else { return }
    let visible = convert(dirtyRect, to: textView)
    drawWashes(layout, visible: visible, width: textView.frame.width)
    drawMatches(layout, visible: visible)
    drawSquiggles(layout, visible: visible)
  }

  private func drawWashes(_ layout: TextLayoutManager, visible: NSRect, width: CGFloat) {
    let now = CACurrentMediaTime()
    for wash in washes {
      let progress = min(1, max(0, (now - wash.start) / wash.duration))
      // Hold, then ease out over the back half.
      let alpha = progress < 0.4 ? 1 : 1 - (progress - 0.4) / 0.6
      guard let first = layout.textLineForIndex(wash.lines.lowerBound) else { continue }
      let last = layout.textLineForIndex(max(wash.lines.lowerBound, wash.lines.upperBound - 1)) ?? first
      let rect = NSRect(x: 0, y: first.yPos, width: width, height: last.yPos + last.height - first.yPos)
      guard rect.intersects(visible) else { continue }
      wash.color.withAlphaComponent(wash.color.alphaComponent * alpha).setFill()
      convertFromText(rect).fill(using: .sourceOver)
    }
  }

  private func drawMatches(_ layout: TextLayoutManager, visible: NSRect) {
    guard !findMatches.isEmpty, let visibleRange = textView?.visibleTextRange else { return }
    for match in matchesIntersecting(visibleRange) {
      let color = match == currentMatch ? currentMatchColor : matchColor
      color.setFill()
      for rect in layout.rectsFor(range: match) where rect.intersects(visible) {
        NSBezierPath(roundedRect: convertFromText(rect).insetBy(dx: -1, dy: 0), xRadius: 2, yRadius: 2).fill()
      }
    }
  }

  private func drawSquiggles(_ layout: TextLayoutManager, visible: NSRect) {
    guard !squiggles.isEmpty else { return }
    for squiggle in squiggles {
      squiggle.color.setStroke()
      let range = squiggle.range.length == 0 ? NSRange(location: squiggle.range.location, length: 1) : squiggle.range
      for rect in layout.rectsFor(range: range) where rect.intersects(visible) {
        let local = convertFromText(rect)
        let path = NSBezierPath()
        let y = local.maxY - 1.5
        let step: CGFloat = 2.5
        var x = local.minX
        path.move(to: NSPoint(x: x, y: y))
        var up = true
        while x < local.maxX {
          x += step
          path.line(to: NSPoint(x: min(x, local.maxX), y: up ? y - 2 : y))
          up.toggle()
        }
        path.lineWidth = 1
        path.stroke()
      }
    }
  }

  /// Matches are sorted; only the visible slice is drawn.
  private func matchesIntersecting(_ range: NSRange) -> ArraySlice<NSRange> {
    var low = 0
    var high = findMatches.count
    while low < high {
      let mid = (low + high) / 2
      if NSMaxRange(findMatches[mid]) < range.location { low = mid + 1 } else { high = mid }
    }
    var end = low
    while end < findMatches.count, findMatches[end].location <= NSMaxRange(range) { end += 1 }
    return findMatches[low..<end]
  }

  private func convertFromText(_ rect: NSRect) -> NSRect {
    rect.offsetBy(dx: -frame.minX, dy: -frame.minY)
  }
}
