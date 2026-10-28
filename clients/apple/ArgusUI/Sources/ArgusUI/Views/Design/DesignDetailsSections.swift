import ArgusCore
import ArgusKit
import SwiftUI

/// The frame's layers in drawing order, indented by depth, with what an
/// implementer needs from each: size, text, font and fill.
struct DesignLayersSection: View {
  @Environment(\.theme) private var theme
  let layers: [ArgusProtocol.FigmaLayer]

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      SectionHeader(title: "Layers", count: layers.count)
      if layers.isEmpty {
        MutedText("Figma sent no layers for this frame.")
      }
      LazyVStack(alignment: .leading, spacing: 2) {
        ForEach(layers, id: \.id) { row($0) }
      }
    }
  }

  private func row(_ layer: ArgusProtocol.FigmaLayer) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      Image(systemName: Self.symbol(layer.type))
        .font(.scaled(size: 10))
        .foregroundStyle(theme.textMuted)
        .frame(width: 14)
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 6) {
          Text(layer.name)
            .font(.scaled(size: 12, weight: .medium))
            .foregroundStyle(theme.text)
            .lineLimit(1)
          if let size = Self.size(layer) {
            Text(size).font(.scaled(size: 11, design: .monospaced)).foregroundStyle(theme.textMuted)
          }
          if let fill = layer.fill, let color = Self.color(fill) {
            HStack(spacing: 3) {
              RoundedRectangle(cornerRadius: 2)
                .fill(color)
                .frame(width: 10, height: 10)
                .overlay(RoundedRectangle(cornerRadius: 2).stroke(theme.border, lineWidth: 1))
              Text(fill).font(.scaled(size: 11, design: .monospaced)).foregroundStyle(theme.textMuted)
            }
          }
        }
        if let text = layer.text, !text.isEmpty {
          Text(text).font(.scaled(size: 12)).foregroundStyle(theme.textSecondary).lineLimit(3)
        }
        if let font = layer.font {
          Text(font).font(.scaled(size: 11, design: .monospaced)).foregroundStyle(theme.textMuted)
        }
      }
    }
    .padding(.leading, CGFloat(min(Int(layer.depth), 8)) * 12)
    .padding(.vertical, 3)
    .textSelection(.enabled)
    .accessibilityElement(children: .combine)
  }

  static func size(_ layer: ArgusProtocol.FigmaLayer) -> String? {
    guard let width = layer.width, let height = layer.height else { return nil }
    return "\(Int(width.rounded()))×\(Int(height.rounded()))"
  }

  /// `#rrggbb` → the swatch's colour; the value is the design's, not a theme colour.
  static func color(_ hex: String) -> Color? {
    let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
    return Color(hex: value)
  }

  static func symbol(_ type: String) -> String {
    switch type {
    case "TEXT": "textformat"
    case "FRAME", "SECTION": "number"
    case "GROUP": "square.on.square"
    case "COMPONENT", "COMPONENT_SET", "INSTANCE": "diamond"
    case "ELLIPSE": "circle"
    case "VECTOR", "LINE", "STAR", "POLYGON", "BOOLEAN_OPERATION": "scribble"
    default: "square"
    }
  }
}

/// What the designers said on the frame.
struct DesignCommentsSection: View {
  @Environment(\.theme) private var theme
  let comments: [ArgusProtocol.FigmaFrameDetailsCommentsItem]

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      SectionHeader(title: "Comments", count: comments.count)
      ForEach(Array(comments.enumerated()), id: \.offset) { _, comment in
        VStack(alignment: .leading, spacing: 4) {
          Text(comment.author).font(.scaled(size: 12, weight: .semibold)).foregroundStyle(theme.text)
          Text(comment.body).font(.scaled(size: 13)).foregroundStyle(theme.textSecondary).textSelection(.enabled)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.bgSecondary)
        .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
      }
    }
  }
}

/// The file's pages and their top-level frames, to move between them.
struct DesignPagesSection: View {
  @Environment(\.theme) private var theme
  let pages: [ArgusProtocol.FigmaFrameDetailsPagesItem]
  let isCurrent: (String) -> Bool
  let onOpen: (String) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      SectionHeader(title: "Pages", count: pages.count)
      ForEach(Array(pages.enumerated()), id: \.offset) { _, page in
        VStack(alignment: .leading, spacing: 2) {
          Text(page.name).font(.scaled(size: 12, weight: .semibold)).foregroundStyle(theme.textSecondary)
          if page.frames.isEmpty { MutedText("No frames") }
          ForEach(page.frames, id: \.url) { frame in
            let current = isCurrent(frame.url)
            Button {
              onOpen(frame.url)
            } label: {
              HStack(spacing: 6) {
                Image(systemName: "number").font(.scaled(size: 10)).foregroundStyle(theme.textMuted)
                Text(frame.name).font(.scaled(size: 13)).lineLimit(1)
                Spacer(minLength: 0)
              }
              .foregroundStyle(current ? theme.accent : theme.text)
              .padding(.vertical, 5)
              .padding(.horizontal, 6)
              .background(current ? theme.accentSoft : .clear)
              .clipShape(RoundedRectangle(cornerRadius: 6))
              .contentShape(Rectangle())
            }
            .buttonStyle(.argusPlain)
            .disabled(current)
            .accessibilityAddTraits(current ? .isSelected : [])
          }
        }
      }
    }
  }
}
