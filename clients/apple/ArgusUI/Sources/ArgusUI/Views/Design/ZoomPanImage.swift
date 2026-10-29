import SwiftUI

/// A PNG fitted to its box that pinches to zoom and, once zoomed, drags to
/// pan, with buttons for the same on a mouse. `overlay` draws over the image
/// in its fitted size and moves with it; it gets the zoom, to keep strokes thin.
public struct ZoomPanImage<Overlay: View>: View {
  @Environment(\.theme) private var theme
  let data: Data?
  let label: String
  let overlay: (CGSize, CGFloat) -> Overlay
  @State private var image: PlatformImage?
  @State private var scale: CGFloat = 1
  @State private var baseScale: CGFloat = 1
  @State private var offset = CGSize.zero
  @State private var baseOffset = CGSize.zero

  private static var range: ClosedRange<CGFloat> { 0.5...8 }

  public init(data: Data?, label: String, @ViewBuilder overlay: @escaping (CGSize, CGFloat) -> Overlay) {
    self.data = data
    self.label = label
    self.overlay = overlay
  }

  public var body: some View {
    GeometryReader { geometry in
      Group {
        if let image {
          Image(platformImage: image)
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .accessibilityLabel(label)
            .overlay {
              let size = Self.fitted(image.size, in: geometry.size)
              overlay(size, scale).frame(width: size.width, height: size.height)
            }
        } else {
          ProgressView().controlSize(.small)
        }
      }
      .frame(width: geometry.size.width, height: geometry.size.height)
      .scaleEffect(scale)
      .offset(offset)
      .contentShape(Rectangle())
      .gesture(magnify)
      .gesture(pan, including: scale > 1 ? .all : .subviews)
    }
    .clipped()
    .background(theme.bgSecondary)
    .overlay(alignment: .bottomTrailing) { controls.padding(8) }
    .task(id: data) {
      image = data.flatMap(PlatformImage.init(data:))
      fit()
    }
  }

  private var controls: some View {
    HStack(spacing: 0) {
      IconBtn(systemName: "minus.magnifyingglass", label: "Zoom out", size: 13) { zoom(by: 1 / 1.5) }
      Button {
        withAnimation(.snappy) { fit() }
      } label: {
        Text("\(Int((scale * 100).rounded()))%")
          .font(.scaled(size: 11).monospacedDigit())
          .foregroundStyle(theme.textSecondary)
          .frame(minWidth: 40)
      }
      .buttonStyle(.argusPlain)
      .help("Fit")
      .accessibilityLabel("Fit")
      IconBtn(systemName: "plus.magnifyingglass", label: "Zoom in", size: 13) { zoom(by: 1.5) }
    }
    .padding(.horizontal, 4)
    .background(theme.surface)
    .clipShape(Capsule())
    .overlay(Capsule().stroke(theme.border, lineWidth: 1))
  }

  private var magnify: some Gesture {
    MagnifyGesture()
      .onChanged { value in scale = Self.clamp(baseScale * value.magnification) }
      .onEnded { _ in
        baseScale = scale
        if scale <= 1 { withAnimation(.snappy) { fit() } }
      }
  }

  private var pan: some Gesture {
    DragGesture()
      .onChanged { value in
        offset = CGSize(
          width: baseOffset.width + value.translation.width, height: baseOffset.height + value.translation.height)
      }
      .onEnded { _ in baseOffset = offset }
  }

  private func zoom(by factor: CGFloat) {
    withAnimation(.snappy) {
      scale = Self.clamp(scale * factor)
      baseScale = scale
      if scale <= 1 { (offset, baseOffset) = (.zero, .zero) }
    }
  }

  private func fit() {
    (scale, baseScale, offset, baseOffset) = (1, 1, .zero, .zero)
  }

  private static func fitted(_ image: CGSize, in box: CGSize) -> CGSize {
    guard image.width > 0, image.height > 0 else { return .zero }
    let factor = min(box.width / image.width, box.height / image.height)
    return CGSize(width: image.width * factor, height: image.height * factor)
  }

  private static func clamp(_ value: CGFloat) -> CGFloat {
    min(max(value, range.lowerBound), range.upperBound)
  }
}

extension ZoomPanImage where Overlay == EmptyView {
  public init(data: Data?, label: String) {
    self.init(data: data, label: label) { _, _ in EmptyView() }
  }
}
