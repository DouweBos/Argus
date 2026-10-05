import CoreGraphics
import Observation
import SwiftUI

/// How much fixed-size text grows: the Mac sets it from its Display size;
/// iOS has Dynamic Type and leaves it at 1.
@Observable
public final class TextScale: @unchecked Sendable {
  public static let shared = TextScale()
  /// Written on the main thread only.
  public var factor: CGFloat = 1

  public func callAsFunction(_ size: CGFloat) -> CGFloat { size * factor }
}

extension Font {
  /// `.system(size:)` at the current text scale; a body reading it redraws when the scale changes.
  public static func scaled(size: CGFloat, weight: Font.Weight? = nil, design: Font.Design? = nil) -> Font {
    .system(size: TextScale.shared(size), weight: weight, design: design)
  }
}

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
