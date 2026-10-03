import AppKit
import ArgusUI
import GroveKit
import SwiftUI

/// Peacock's colours for the commit list, resolved to AppKit.
struct CommitListPalette: Equatable {
  let text: NSColor
  let secondary: NSColor
  let muted: NSColor
  let accent: NSColor
  let accentSoft: NSColor
  let local: NSColor
  let localSoft: NSColor
  let remoteSoft: NSColor
  let tag: NSColor
  let tagSoft: NSColor
  let lanes: [NSColor]

  init(_ theme: Theme) {
    text = NSColor(theme.text)
    secondary = NSColor(theme.textSecondary)
    muted = NSColor(theme.textMuted)
    accent = NSColor(theme.accent)
    accentSoft = NSColor(theme.accentSoft)
    local = NSColor(theme.success)
    localSoft = NSColor(theme.successSoft)
    remoteSoft = NSColor(theme.bgTertiary)
    tag = NSColor(theme.warning)
    tagSoft = NSColor(theme.warningSoft)
    lanes = GitGraphPalette.lanes.map { NSColor($0) }
  }

  func lane(_ index: Int) -> NSColor { lanes[((index % lanes.count) + lanes.count) % lanes.count] }
}

/// A ref drawn as a badge beside the subject.
struct CommitRefBadge: Equatable {
  enum Kind { case head, local, remote, tag }
  let name: String
  let kind: Kind
}

/// What one row draws, looked up from the view model when the row appears.
struct CommitRowModel {
  let commit: CommitInfo
  let node: GraphNode?
  let graphColumns: Int
  let refs: [CommitRefBadge]
  let sync: CommitSyncState?
  let isHead: Bool
  /// On the session branch's view: a commit its base doesn't have.
  let isOwn: Bool
}

@MainActor
enum CommitListMetrics {
  static let rowHeight: CGFloat = 24
  static let laneWidth: CGFloat = 14
  static let dotRadius: CGFloat = 4
  /// Beyond this many lanes the graph is clipped rather than pushing the subject away.
  static let maxLanes = 24
  static let font = NSFont.systemFont(ofSize: 12)
  static let boldFont = NSFont.systemFont(ofSize: 12, weight: .semibold)
  static let badgeFont = NSFont.systemFont(ofSize: 10, weight: .medium)
  static let monoFont = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)

  static func graphWidth(columns: Int) -> CGFloat {
    CGFloat(min(max(columns, 1), maxLanes)) * laneWidth + 6
  }
}

/// The subject column: graph, ref badges and subject, all drawn in one view —
/// no subviews per row, so 100k rows scroll like ten.
final class CommitSubjectCell: NSView {
  static let identifier = NSUserInterfaceItemIdentifier("CommitSubjectCell")
  private var model: CommitRowModel?
  private var palette: CommitListPalette?
  private var showsGraph = true

  convenience init() {
    self.init(frame: .zero)
    identifier = Self.identifier
  }

  override var isFlipped: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  func configure(_ model: CommitRowModel, palette: CommitListPalette, showsGraph: Bool) {
    self.model = model
    self.palette = palette
    self.showsGraph = showsGraph
    toolTip = model.commit.summary
    needsDisplay = true
  }

  override func draw(_ dirtyRect: NSRect) {
    guard let model, let palette else { return }
    var x: CGFloat = 4
    if showsGraph, let node = model.node {
      let width = CommitListMetrics.graphWidth(columns: model.graphColumns)
      NSGraphicsContext.saveGraphicsState()
      NSRect(x: 0, y: 0, width: width, height: bounds.height).clip()
      drawGraph(node, palette: palette)
      NSGraphicsContext.restoreGraphicsState()
      x = width + 2
    }
    if let sync = model.sync {
      x = drawSymbol(sync == .incoming ? "↓" : "↑", at: x, color: palette.accent)
    }
    for badge in model.refs.prefix(4) {
      x = drawBadge(badge, at: x, palette: palette)
      if x > bounds.width - 40 { break }
    }
    if model.refs.count > 4 {
      x = drawSymbol("+\(model.refs.count - 4)", at: x, color: palette.secondary)
    }
    let attrs: [NSAttributedString.Key: Any] = [
      .font: model.isHead ? CommitListMetrics.boldFont : CommitListMetrics.font,
      .foregroundColor: model.isOwn ? palette.text : palette.secondary,
      .paragraphStyle: Self.truncating,
    ]
    let height = ceil(CommitListMetrics.font.boundingRectForFont.height)
    let rect = NSRect(x: x + 2, y: (bounds.height - height) / 2, width: max(0, bounds.width - x - 6), height: height)
    (model.commit.summary as NSString).draw(with: rect, options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
      attributes: attrs)
  }

  private static let truncating: NSParagraphStyle = {
    let style = NSMutableParagraphStyle()
    style.lineBreakMode = .byTruncatingTail
    return style
  }()

  // MARK: Graph

  private func laneX(_ column: Int) -> CGFloat {
    CGFloat(column) * CommitListMetrics.laneWidth + CommitListMetrics.laneWidth / 2 + 3
  }

  /// Pass-through lines span the row; incoming end at the dot, outgoing start at it.
  private func drawGraph(_ node: GraphNode, palette: CommitListPalette) {
    guard let context = NSGraphicsContext.current?.cgContext else { return }
    let height = bounds.height
    let mid = height / 2
    let dot = CGPoint(x: laneX(node.column), y: mid)
    context.setLineWidth(1.6)
    context.setLineCap(.round)
    for line in node.lines {
      let path = CGMutablePath()
      switch line.kind {
      case .passThrough:
        path.move(to: CGPoint(x: laneX(line.fromColumn), y: 0))
        path.addLine(to: CGPoint(x: laneX(line.toColumn), y: height))
      case .incoming:
        let start = CGPoint(x: laneX(line.fromColumn), y: 0)
        path.move(to: start)
        path.addCurve(to: dot, control1: CGPoint(x: start.x, y: mid * 0.9), control2: CGPoint(x: dot.x, y: mid * 0.3))
      case .outgoing:
        let end = CGPoint(x: laneX(line.toColumn), y: height)
        path.move(to: dot)
        path.addCurve(to: end, control1: CGPoint(x: end.x, y: mid + mid * 0.3), control2: CGPoint(x: end.x, y: mid + mid * 0.1))
      }
      context.setStrokeColor(palette.lane(line.colorIndex).cgColor)
      context.addPath(path)
      context.strokePath()
    }
    let r = CommitListMetrics.dotRadius
    let dotRect = CGRect(x: dot.x - r, y: dot.y - r, width: r * 2, height: r * 2)
    let color = palette.lane(node.colorIndex)
    if node.isMerge {
      context.setFillColor(NSColor.windowBackgroundColor.cgColor)
      context.fillEllipse(in: dotRect)
      context.setStrokeColor(color.cgColor)
      context.setLineWidth(2)
      context.strokeEllipse(in: dotRect.insetBy(dx: 1, dy: 1))
    } else {
      context.setFillColor(color.cgColor)
      context.fillEllipse(in: dotRect)
    }
    if model?.isHead == true {
      context.setStrokeColor(palette.accent.cgColor)
      context.setLineWidth(1.5)
      context.strokeEllipse(in: dotRect.insetBy(dx: -2.5, dy: -2.5))
    }
  }

  // MARK: Badges

  private func drawBadge(_ badge: CommitRefBadge, at x: CGFloat, palette: CommitListPalette) -> CGFloat {
    let (fg, bg): (NSColor, NSColor) =
      switch badge.kind {
      case .head: (palette.accent, palette.accentSoft)
      case .local: (palette.local, palette.localSoft)
      case .remote: (palette.secondary, palette.remoteSoft)
      case .tag: (palette.tag, palette.tagSoft)
      }
    let attrs: [NSAttributedString.Key: Any] = [.font: CommitListMetrics.badgeFont, .foregroundColor: fg]
    let label = (badge.kind == .tag ? "◆ " : "") + badge.name
    let size = (label as NSString).size(withAttributes: attrs)
    let width = min(ceil(size.width) + 10, 160)
    let rect = NSRect(x: x, y: (bounds.height - 16) / 2, width: width, height: 16)
    bg.setFill()
    NSBezierPath(roundedRect: rect, xRadius: 4, yRadius: 4).fill()
    if badge.kind == .head {
      fg.setStroke()
      let border = NSBezierPath(roundedRect: rect.insetBy(dx: 0.5, dy: 0.5), xRadius: 4, yRadius: 4)
      border.lineWidth = 1
      border.stroke()
    }
    var textAttrs = attrs
    textAttrs[.paragraphStyle] = Self.truncating
    (label as NSString).draw(
      with: NSRect(x: rect.minX + 5, y: rect.minY + (16 - size.height) / 2, width: rect.width - 10, height: size.height),
      options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine], attributes: textAttrs)
    return rect.maxX + 4
  }

  private func drawSymbol(_ text: String, at x: CGFloat, color: NSColor) -> CGFloat {
    let attrs: [NSAttributedString.Key: Any] = [.font: CommitListMetrics.badgeFont, .foregroundColor: color]
    let size = (text as NSString).size(withAttributes: attrs)
    (text as NSString).draw(at: NSPoint(x: x, y: (bounds.height - size.height) / 2), withAttributes: attrs)
    return x + ceil(size.width) + 4
  }
}

/// A plain text column (author, date, SHA), one reused text field.
final class CommitTextCell: NSTableCellView {
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  convenience init(identifier: NSUserInterfaceItemIdentifier, font: NSFont) {
    self.init(frame: .zero)
    self.identifier = identifier
    let field = NSTextField(labelWithString: "")
    field.font = font
    field.lineBreakMode = .byTruncatingTail
    field.translatesAutoresizingMaskIntoConstraints = false
    addSubview(field)
    textField = field
    NSLayoutConstraint.activate([
      field.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 4),
      field.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -4),
      field.centerYAnchor.constraint(equalTo: centerYAnchor),
    ])
  }
}
