import ArgusCore
import ArgusKit
import SwiftUI

/// Over the frame's render: outlines the hovered and selected layers, and
/// picks the layer under a click or tap.
struct DesignLayerOverlay: View {
  @Environment(\.theme) private var theme
  let model: DesignViewerModel
  let frameSize: CGSize
  /// The render's fitted size on screen.
  let size: CGSize
  /// The viewer's zoom, to keep outlines a constant width.
  let zoom: CGFloat

  var body: some View {
    let tree = model.layerTree
    ZStack(alignment: .topLeading) {
      Color.clear
      if let hovered = tree.layer(model.hoveredLayerId), hovered.id != model.selectedLayerId,
        let rect = rect(hovered)
      {
        outline(rect, width: 1)
      }
      if let selected = model.selectedLayer, let rect = rect(selected) {
        outline(rect, width: 1.5)
        sizeTag(selected, below: rect)
      }
    }
    .frame(width: size.width, height: size.height, alignment: .topLeading)
    .contentShape(Rectangle())
    .onTapGesture { location in model.select(at: framePoint(location)) }
    .onContinuousHover { phase in
      switch phase {
      case .active(let location): model.hoveredLayerId = tree.hit(framePoint(location))?.id
      case .ended: model.hoveredLayerId = nil
      }
    }
    .clickable()
  }

  /// Screen points per frame point.
  private var factor: CGFloat { frameSize.width > 0 ? size.width / frameSize.width : 0 }

  private func framePoint(_ location: CGPoint) -> CGPoint {
    guard factor > 0 else { return .zero }
    return CGPoint(x: location.x / factor, y: location.y / factor)
  }

  private func rect(_ layer: ArgusProtocol.FigmaLayer) -> CGRect? {
    DesignLayerTree.rect(layer).map {
      CGRect(x: $0.minX * factor, y: $0.minY * factor, width: $0.width * factor, height: $0.height * factor)
    }
  }

  private func outline(_ rect: CGRect, width: CGFloat) -> some View {
    Rectangle()
      .stroke(theme.accent, lineWidth: width / max(zoom, 0.01))
      .frame(width: rect.width, height: rect.height)
      .offset(x: rect.minX, y: rect.minY)
      .allowsHitTesting(false)
  }

  private func sizeTag(_ layer: ArgusProtocol.FigmaLayer, below rect: CGRect) -> some View {
    Text(DesignLayersSection.size(layer) ?? "")
      .font(.scaled(size: 10, weight: .semibold).monospacedDigit())
      .foregroundStyle(theme.onAccent)
      .padding(.horizontal, 4)
      .padding(.vertical, 1)
      .background(theme.accent, in: RoundedRectangle(cornerRadius: 3))
      .fixedSize()
      .scaleEffect(1 / max(zoom, 0.01), anchor: .top)
      .frame(width: rect.width)
      .offset(x: rect.minX, y: rect.maxY + 4 / max(zoom, 0.01))
      .allowsHitTesting(false)
  }
}
