import ArgusUI
import SwiftUI

/// A sidebar row's label. A sidebar list sizes a bare `Label` itself and
/// ignores the window's font, so it's wrapped to follow Display size.
struct SidebarLabel: View {
  let title: String
  let systemImage: String

  init(_ title: String, systemImage: String) {
    self.title = title
    self.systemImage = systemImage
  }

  var body: some View {
    // On the text and icon themselves: a font on the label doesn't reach rows without a badge.
    Label {
      Text(title).font(.sidebarScaled(.body))
    } icon: {
      Image(systemName: systemImage).font(.sidebarScaled(.body))
    }
  }
}

extension Font {
  /// Nil at the default Display size, so a sidebar keeps the system's own sizing.
  static func sidebarScaled(_ style: Font.TextStyle) -> Font? {
    TextScale.shared.factor == 1 ? nil : .scaled(style)
  }
}
