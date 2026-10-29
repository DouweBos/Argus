import ArgusCore
import ArgusKit
import SwiftUI

/// The selected layer: where it sits, its size, and what an implementer
/// needs from it — text, font and fill.
struct DesignLayerInspector: View {
  @Environment(\.theme) private var theme
  let model: DesignViewerModel
  let layer: ArgusProtocol.FigmaLayer

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 6) {
        Image(systemName: DesignLayersSection.symbol(layer.type))
          .font(.scaled(size: 11))
          .foregroundStyle(theme.accent)
        Text(layer.name)
          .font(.scaled(size: 13, weight: .semibold))
          .foregroundStyle(theme.text)
          .lineLimit(2)
          .textSelection(.enabled)
        Spacer(minLength: 0)
        IconBtn(systemName: Icon.close, label: "Clear selection", size: 11) { model.select(nil, from: .tree) }
      }
      if let parent = model.layerTree.ancestors(of: layer.id).first.flatMap(model.layerTree.layer) {
        Button {
          model.select(parent.id, from: .tree)
        } label: {
          Label("In \(parent.name)", systemImage: "arrow.turn.left.up")
            .font(.scaled(size: 11))
            .foregroundStyle(theme.textSecondary)
            .lineLimit(1)
        }
        .buttonStyle(.argusPlain)
        .help("Select the parent layer")
      }
      Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 4) {
        field("Type", Self.typeName(layer.type))
        if let x = layer.x, let y = layer.y { field("Position", "\(Int(x.rounded())), \(Int(y.rounded()))") }
        if let size = DesignLayersSection.size(layer) { field("Size", size) }
        if let fill = layer.fill {
          GridRow {
            label("Fill")
            HStack(spacing: 4) {
              if let color = DesignLayersSection.color(fill) {
                RoundedRectangle(cornerRadius: 2)
                  .fill(color)
                  .frame(width: 10, height: 10)
                  .overlay(RoundedRectangle(cornerRadius: 2).stroke(theme.border, lineWidth: 1))
              }
              value(fill)
            }
          }
        }
        if let font = layer.font { field("Font", font) }
      }
      if let text = layer.text, !text.isEmpty {
        Text(text)
          .font(.scaled(size: 12))
          .foregroundStyle(theme.textSecondary)
          .lineLimit(6)
          .textSelection(.enabled)
          .padding(8)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(theme.bgSecondary, in: RoundedRectangle(cornerRadius: theme.radiusSmall))
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func field(_ name: String, _ text: String) -> some View {
    GridRow {
      label(name)
      value(text)
    }
  }

  private func label(_ text: String) -> some View {
    Text(text).font(.scaled(size: 11)).foregroundStyle(theme.textMuted)
  }

  private func value(_ text: String) -> some View {
    Text(text)
      .font(.scaled(size: 11, design: .monospaced))
      .foregroundStyle(theme.text)
      .textSelection(.enabled)
  }

  /// `BOOLEAN_OPERATION` → `Boolean operation`.
  static func typeName(_ type: String) -> String {
    let words = type.lowercased().replacingOccurrences(of: "_", with: " ")
    return words.prefix(1).uppercased() + words.dropFirst()
  }
}
