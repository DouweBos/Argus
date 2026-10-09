import SwiftUI

/// A file or folder's type icon, VS Code style. Decorative: the name beside it says what it is.
/// The colors are the icon set's own artwork, like an app icon, not theme tokens.
public struct FileTypeIcon: View {
  @ScaledMetric(relativeTo: .body) private var dynamicType: CGFloat = 1
  let name: String
  let size: CGFloat

  public init(path: String, isDirectory: Bool = false, isExpanded: Bool = false, size: CGFloat = 16) {
    self.init(iconName: FileIcon.name(forPath: path, isDirectory: isDirectory, isExpanded: isExpanded), size: size)
  }

  init(iconName: String, size: CGFloat = 16) {
    self.name = iconName
    self.size = size
  }

  public var body: some View {
    let side = TextScale.shared(size) * dynamicType
    Image(name, bundle: FileIcon.bundle)
      .resizable()
      .interpolation(.high)
      .aspectRatio(contentMode: .fit)
      .frame(width: side, height: side)
      .accessibilityHidden(true)
  }
}

/// Every bundled icon, for checking the artwork on both backgrounds.
struct FileTypeIconGrid: View {
  var size: CGFloat = 16

  var body: some View {
    HStack(alignment: .top, spacing: 0) {
      column.background(Theme.light.bg).environment(\.colorScheme, .light)
      column.background(Theme.dark.bg).environment(\.colorScheme, .dark)
    }
  }

  private var column: some View {
    LazyVGrid(columns: Array(repeating: GridItem(.fixed(size * 2), spacing: 6), count: 12), spacing: 6) {
      ForEach(FileIcon.allNames, id: \.self) { name in
        FileTypeIcon(iconName: name, size: size).help(name)
      }
    }
    .padding(12)
  }
}

#Preview("File type icons") {
  ScrollView { FileTypeIconGrid() }
}

#Preview("File type icons, 12 pt") {
  ScrollView { FileTypeIconGrid(size: 12) }
}
