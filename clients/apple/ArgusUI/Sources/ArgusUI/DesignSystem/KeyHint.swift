import SwiftUI

/// A keyboard shortcut like "⇧⌘P", one glyph per key with room between them;
/// set as one run of text the modifier symbols crowd each other.
public struct KeyHint: View {
  @Environment(\.theme) private var theme
  let keys: [String]
  let size: CGFloat
  let boxed: Bool

  public init(_ keys: String, size: CGFloat = 11, boxed: Bool = true) {
    self.init(parts: keys.map(String.init), size: size, boxed: boxed)
  }

  /// One string per key, so "F12" or "Space" stays together.
  public init(parts: [String], size: CGFloat = 11, boxed: Bool = true) {
    self.keys = parts
    self.size = size
    self.boxed = boxed
  }

  public var body: some View {
    HStack(spacing: size * 0.25) {
      ForEach(Array(keys.enumerated()), id: \.offset) { _, key in
        Text(key)
      }
    }
    .font(.scaled(size: size, design: .monospaced))
    .padding(.horizontal, boxed ? 6 : 0)
    .padding(.vertical, boxed ? 2 : 0)
    .background(boxed ? theme.bgTertiary : .clear)
    .clipShape(RoundedRectangle(cornerRadius: 4))
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(keys.joined())
  }
}

#Preview {
  VStack(alignment: .leading, spacing: 8) {
    KeyHint("⌘O")
    KeyHint("⇧⌘P")
    KeyHint("⌘,", boxed: false)
  }
  .padding()
}
