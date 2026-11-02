import SwiftUI

extension View {
  /// The pointing hand over something clickable on macOS, unless it's disabled; a no-op on iOS.
  /// Every ArgusUI button style applies it already — reach for it on `onTapGesture` views and `Menu`s.
  public func clickable(_ active: Bool = true) -> some View {
    modifier(ClickablePointer(active: active))
  }
}

private struct ClickablePointer: ViewModifier {
  @Environment(\.isEnabled) private var isEnabled
  let active: Bool

  func body(content: Content) -> some View {
    #if os(macOS)
      content.pointerStyle(active && isEnabled ? .link : nil)
    #else
      content
    #endif
  }
}

/// The system `.plain` style plus the pointing hand: use it instead of `.plain`.
public struct ArgusPlainButtonStyle: PrimitiveButtonStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    Button(configuration).buttonStyle(.plain).clickable()
  }
}

/// The system `.borderless` style plus the pointing hand: use it instead of `.borderless`.
public struct ArgusBorderlessButtonStyle: PrimitiveButtonStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    Button(configuration).buttonStyle(.borderless).clickable()
  }
}

#if os(macOS)
  /// The system's automatic style, untinted: macOS draws a tinted bordered button's label in the tint,
  /// which the muted theme's grey turns into a disabled look. Window roots set it as the default, so a
  /// default-action button needs an explicit `.borderedProminent` to keep the theme's tint.
  public struct ArgusAutomaticButtonStyle: PrimitiveButtonStyle {
    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
      Button(configuration).buttonStyle(.automatic).tint(nil)
    }
  }

  extension PrimitiveButtonStyle where Self == ArgusAutomaticButtonStyle {
    public static var argusAutomatic: ArgusAutomaticButtonStyle { ArgusAutomaticButtonStyle() }
  }

  extension PrimitiveButtonStyle where Self == ArgusPlainButtonStyle {
    public static var argusPlain: ArgusPlainButtonStyle { ArgusPlainButtonStyle() }
  }

  extension PrimitiveButtonStyle where Self == ArgusBorderlessButtonStyle {
    public static var argusBorderless: ArgusBorderlessButtonStyle { ArgusBorderlessButtonStyle() }
  }
#else
  // No pointer on iOS: keep the system styles so list rows behave exactly as before.
  extension PrimitiveButtonStyle where Self == PlainButtonStyle {
    public static var argusPlain: PlainButtonStyle { .plain }
  }

  extension PrimitiveButtonStyle where Self == BorderlessButtonStyle {
    public static var argusBorderless: BorderlessButtonStyle { .borderless }
  }
#endif
