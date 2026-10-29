import ArgusCore
import ArgusKit
import SwiftUI

/// The frame's layers as a tree, in drawing order: pick one to outline it on
/// the render and inspect it; fold a layer to hide its children.
struct DesignLayersSection: View {
  @Environment(\.theme) private var theme
  let model: DesignViewerModel

  var body: some View {
    let tree = model.layerTree
    VStack(alignment: .leading, spacing: 6) {
      SectionHeader(title: "Layers", count: tree.layers.count)
      if tree.layers.isEmpty {
        MutedText("Figma sent no layers for this frame.")
      }
      LazyVStack(alignment: .leading, spacing: 0) {
        ForEach(tree.visible(collapsed: model.collapsed), id: \.id) { row($0, parent: tree.hasChildren($0.id)) }
      }
    }
  }

  private func row(_ layer: ArgusProtocol.FigmaLayer, parent: Bool) -> some View {
    let selected = model.selectedLayerId == layer.id
    let hovered = model.hoveredLayerId == layer.id
    return HStack(spacing: 4) {
      Button {
        model.toggleCollapsed(layer.id)
      } label: {
        Image(systemName: model.collapsed.contains(layer.id) ? Icon.chevronRight : Icon.chevronDown)
          .font(.scaled(size: 8, weight: .semibold))
          .foregroundStyle(theme.textMuted)
          .frame(width: 12, height: 18)
          .contentShape(Rectangle())
      }
      .buttonStyle(.argusPlain)
      .opacity(parent ? 1 : 0)
      .disabled(!parent)
      .accessibilityLabel(model.collapsed.contains(layer.id) ? "Expand" : "Collapse")
      .accessibilityHidden(!parent)
      Button {
        model.select(selected ? nil : layer.id, from: .tree)
      } label: {
        HStack(spacing: 6) {
          Image(systemName: Self.symbol(layer.type))
            .font(.scaled(size: 10))
            .foregroundStyle(selected ? theme.accent : theme.textMuted)
            .frame(width: 14)
          Text(layer.name)
            .font(.scaled(size: 12, weight: selected ? .semibold : .medium))
            .foregroundStyle(theme.text)
            .lineLimit(1)
          if let size = Self.size(layer) {
            Text(size).font(.scaled(size: 11, design: .monospaced)).foregroundStyle(theme.textMuted).lineLimit(1)
          }
          Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
      }
      .buttonStyle(.argusPlain)
      .accessibilityAddTraits(selected ? .isSelected : [])
    }
    .padding(.leading, CGFloat(min(Int(layer.depth), 10)) * 12)
    .padding(.trailing, 6)
    .background(
      selected ? theme.accentSoft : hovered ? theme.bgSecondary : .clear,
      in: RoundedRectangle(cornerRadius: 6)
    )
    .onHover { inside in
      if inside { model.hoveredLayerId = layer.id } else if model.hoveredLayerId == layer.id { model.hoveredLayerId = nil }
    }
    .id(layer.id)
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
