import ArgusCore
import SwiftUI

/// The circle Linear draws for a status: dashed, empty, half, checked or
/// crossed — Peacock's `IssueStatusIcon`. Unknown types draw as unstarted.
/// Tinted with the state's own Linear colour when there is one.
public struct IssueStatusGlyph: View {
  @Environment(\.theme) private var theme
  let type: String
  let hex: String?
  let size: CGFloat

  public init(type: String, color hex: String? = nil, size: CGFloat = 14) {
    self.type = type
    self.hex = hex
    self.size = size
  }

  public var body: some View {
    Canvas { context, canvas in
      let unit = canvas.width / 14
      let ring = Path(ellipseIn: CGRect(x: 1.5, y: 1.5, width: 11, height: 11).scaled(unit))
      let line = StrokeStyle(lineWidth: 1.5 * unit, lineCap: .round, lineJoin: .round)
      switch type {
      case "backlog":
        context.stroke(ring, with: .color(color), style: StrokeStyle(lineWidth: 1.5 * unit, dash: [2 * unit, 1.6 * unit]))
      case "started":
        context.stroke(ring, with: .color(color), lineWidth: 1.5 * unit)
        var half = Path()
        half.addArc(
          center: CGPoint(x: 7 * unit, y: 7 * unit), radius: 3.5 * unit,
          startAngle: .degrees(-90), endAngle: .degrees(90), clockwise: false)
        half.closeSubpath()
        context.fill(half, with: .color(color))
      case "completed", "canceled":
        context.fill(Path(ellipseIn: CGRect(x: 0.75, y: 0.75, width: 12.5, height: 12.5).scaled(unit)), with: .color(color))
        var mark = Path()
        if type == "completed" {
          mark.addLines([CGPoint(x: 4.4, y: 7.1), CGPoint(x: 6.2, y: 8.9), CGPoint(x: 9.7, y: 5.3)].scaled(unit))
        } else {
          mark.addLines([CGPoint(x: 5, y: 5), CGPoint(x: 9, y: 9)].scaled(unit))
          mark.addLines([CGPoint(x: 9, y: 5), CGPoint(x: 5, y: 9)].scaled(unit))
        }
        context.stroke(mark, with: .color(theme.bg), style: line)
      default:
        context.stroke(ring, with: .color(color), lineWidth: 1.5 * unit)
      }
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }

  private var color: Color {
    if let linear = Color(linearHex: hex) { return linear }
    return switch type {
    case "triage": theme.error
    case "started": theme.warning
    case "completed": theme.success
    default: theme.textMuted
    }
  }
}

/// Signal bars for high to low, a filled alert for urgent, dashes for none —
/// Peacock's `PriorityIcon`.
public struct PriorityGlyph: View {
  @Environment(\.theme) private var theme
  let priority: Int
  let size: CGFloat

  public init(priority: Int, size: CGFloat = 14) {
    self.priority = priority
    self.size = size
  }

  public init(priority: Double, size: CGFloat = 14) {
    self.init(priority: Int(priority), size: size)
  }

  public var body: some View {
    Canvas { context, canvas in
      let unit = canvas.width / 14
      switch priority {
      case 1:
        let box = Path(roundedRect: CGRect(x: 1, y: 1, width: 12, height: 12).scaled(unit), cornerRadius: 3 * unit)
        context.fill(box, with: .color(theme.error))
        var bang = Path()
        bang.addLines([CGPoint(x: 7, y: 3.8), CGPoint(x: 7, y: 7.8)].scaled(unit))
        bang.addLines([CGPoint(x: 7, y: 10.2), CGPoint(x: 7, y: 10.21)].scaled(unit))
        context.stroke(bang, with: .color(theme.bg), style: StrokeStyle(lineWidth: 1.7 * unit, lineCap: .round))
      case 2...4:
        // High lights all three bars, medium two, low one.
        let lit = 5 - priority
        for bar in 0..<3 {
          let height = CGFloat(4 + bar * 3)
          let rect = CGRect(x: 1.5 + CGFloat(bar) * 4, y: 11 - CGFloat(bar) * 3, width: 3, height: height)
          let tone = theme.textSecondary.opacity(bar < lit ? 1 : 0.3)
          context.fill(Path(roundedRect: rect.scaled(unit), cornerRadius: unit), with: .color(tone))
        }
      default:
        for x in [2.0, 6.0, 10.0] {
          let dash = CGRect(x: x, y: 6.25, width: 2.5, height: 1.5).scaled(unit)
          context.fill(Path(roundedRect: dash, cornerRadius: 0.75 * unit), with: .color(theme.textSecondary))
        }
      }
    }
    .frame(width: size, height: size)
    .accessibilityElement()
    .accessibilityLabel(LinearIssueBoard.priorityLabel(priority))
  }
}

extension Color {
  /// A colour Linear sends as `#rrggbb` (a state's or a label's): data, not a theme colour.
  init?(linearHex hex: String?) {
    guard let rgba = hex.flatMap(Inspection.RGBA.init(hex:)) else { return nil }
    self.init(.sRGB, red: rgba.red, green: rgba.green, blue: rgba.blue, opacity: rgba.alpha)
  }
}

extension CGRect {
  fileprivate func scaled(_ unit: CGFloat) -> CGRect {
    CGRect(x: minX * unit, y: minY * unit, width: width * unit, height: height * unit)
  }
}

extension [CGPoint] {
  fileprivate func scaled(_ unit: CGFloat) -> [CGPoint] {
    map { CGPoint(x: $0.x * unit, y: $0.y * unit) }
  }
}
