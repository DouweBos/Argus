import SwiftUI

/// A wrapping multi-line editor that grows with its text between `lines` and
/// then scrolls. macOS needs it: a vertical-axis `TextField` outside a `Form`
/// keeps the text on one line there.
struct GrowingTextEditor: View {
  @Environment(\.theme) private var theme

  let placeholder: String
  @Binding var text: String
  var lines: ClosedRange<Int>
  var font: Font

  var body: some View {
    // Invisible copies of the text size the editor: the floor is the minimum
    // line count, the ceiling the maximum, and past it the editor scrolls.
    ZStack(alignment: .topLeading) {
      sizer(String(repeating: "\n", count: max(lines.lowerBound - 1, 0)) + " ", limit: nil)
      sizer(text + " ", limit: lines.upperBound)
    }
    .overlay(alignment: .topLeading) {
      if text.isEmpty {
        Text(placeholder)
          .font(font)
          .foregroundStyle(theme.textMuted)
          .padding(.horizontal, Self.inset)
          .allowsHitTesting(false)
      }
    }
    .overlay {
      TextEditor(text: $text)
        .font(font)
        .scrollContentBackground(.hidden)
    }
  }

  /// NSTextView's default line fragment padding, so the copies wrap where the text does.
  private static let inset: CGFloat = 5

  private func sizer(_ string: String, limit: Int?) -> some View {
    Text(string)
      .font(font)
      .lineLimit(limit)
      .padding(.horizontal, Self.inset)
      .frame(maxWidth: .infinity, alignment: .leading)
      .hidden()
  }
}
