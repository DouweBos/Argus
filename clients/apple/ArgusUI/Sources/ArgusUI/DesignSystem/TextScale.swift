import CoreGraphics
import Observation
import SwiftUI

#if canImport(UIKit)
  import UIKit
#endif

/// How much fixed-size text grows: the Mac sets `factor` from its Display
/// size; iOS leaves it at 1 and follows Dynamic Type instead.
@Observable
public final class TextScale: @unchecked Sendable {
  public static let shared = TextScale()
  /// Written on the main thread only.
  public var factor: CGFloat = 1

  public func callAsFunction(_ size: CGFloat) -> CGFloat { size * factor }

  #if os(iOS)
    /// The user's text size, mirrored from the environment by `tracksDynamicType()`.
    public var dynamicTypeSize: DynamicTypeSize = .large {
      didSet { traits = Self.traits(for: dynamicTypeSize) }
    }
    @ObservationIgnored private(set) var traits = TextScale.traits(for: .large)

    /// Past this, fixed layouts (transcript chrome, toolbars) stop fitting.
    private static func traits(for size: DynamicTypeSize) -> UITraitCollection {
      UITraitCollection(preferredContentSizeCategory: UIContentSizeCategory(min(size, .accessibility2)))
    }

    /// `size` grown the way the nearest text style grows at the user's text size.
    func dynamic(_ size: CGFloat) -> CGFloat {
      _ = dynamicTypeSize
      return UIFontMetrics(forTextStyle: .nearest(to: size)).scaledValue(for: size, compatibleWith: traits)
    }
  #endif
}

extension Font {
  /// `.system(size:)` at the current text scale; a body reading it redraws
  /// when the scale (or, on iOS, the Dynamic Type size) changes.
  public static func scaled(size: CGFloat, weight: Font.Weight? = nil, design: Font.Design? = nil) -> Font {
    #if os(iOS)
      .system(size: TextScale.shared.dynamic(size), weight: weight, design: design)
    #else
      .system(size: TextScale.shared(size), weight: weight, design: design)
    #endif
  }
}

#if os(iOS)
  extension UIFont.TextStyle {
    /// The style whose default (Large) size is closest, so 13pt grows like footnote.
    static func nearest(to size: CGFloat) -> UIFont.TextStyle {
      switch size {
      case 31...: .largeTitle
      case 25..<31: .title1
      case 21..<25: .title2
      case 18.5..<21: .title3
      case 16.5..<18.5: .body
      case 15.5..<16.5: .callout
      case 14..<15.5: .subheadline
      case 12.5..<14: .footnote
      case 11.5..<12.5: .caption1
      default: .caption2
      }
    }
  }

  private struct TracksDynamicType: ViewModifier {
    @Environment(\.dynamicTypeSize) private var size

    func body(content: Content) -> some View {
      content
        .onAppear { TextScale.shared.dynamicTypeSize = size }
        .onChange(of: size) { _, next in TextScale.shared.dynamicTypeSize = next }
    }
  }

  extension View {
    /// Feeds the user's text size to `Font.scaled(size:)`. Apply once, at the root.
    public func tracksDynamicType() -> some View { modifier(TracksDynamicType()) }
  }
#endif

extension Font {
  /// A text style at the current text scale. macOS ignores Dynamic Type, so the
  /// Mac sizes it from the style's own point size; iOS keeps the style as is.
  public static func scaled(_ style: Font.TextStyle) -> Font {
    #if os(macOS)
      let factor = TextScale.shared.factor
      guard factor != 1 else { return .system(style) }
      return .system(size: style.macPointSize * factor, weight: style == .headline ? .bold : nil)
    #else
      return .system(style)
    #endif
  }
}

#if os(macOS)
  extension Font.TextStyle {
    /// AppKit's sizes for each style.
    var macPointSize: CGFloat {
      switch self {
      case .largeTitle: 26
      case .title: 22
      case .title2: 17
      case .title3: 15
      case .headline, .body: 13
      case .callout: 12
      case .subheadline: 11
      case .footnote, .caption, .caption2: 10
      @unknown default: 13
      }
    }
  }
#endif
