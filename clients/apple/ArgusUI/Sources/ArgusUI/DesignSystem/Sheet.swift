import SwiftUI

/// Every sheet goes through these (lint enforces it): on the Mac `theme.bg` is the main
/// window's near-black, so inside a sheet it becomes the sheet's own background.
extension View {
  public func argusSheet<Content: View>(
    isPresented: Binding<Bool>, onDismiss: (() -> Void)? = nil,
    @ViewBuilder content: @escaping () -> Content
  ) -> some View {
    sheet(isPresented: isPresented, onDismiss: onDismiss) { content().sheetSurface() }
  }

  public func argusSheet<Item: Identifiable, Content: View>(
    item: Binding<Item?>, onDismiss: (() -> Void)? = nil,
    @ViewBuilder content: @escaping (Item) -> Content
  ) -> some View {
    sheet(item: item, onDismiss: onDismiss) { content($0).sheetSurface() }
  }

  /// For sheet content that re-applies the theme itself, which would undo `argusSheet`'s.
  public func sheetSurface() -> some View { modifier(SheetSurface()) }
}

private struct SheetSurface: ViewModifier {
  @Environment(\.theme) private var theme

  func body(content: Content) -> some View {
    #if os(macOS)
      var sheetTheme = theme
      sheetTheme.bg = Color(nsColor: .windowBackgroundColor)
      return content.environment(\.theme, sheetTheme)
    #else
      return content
    #endif
  }
}
