import ArgusUI
import SwiftUI

/// The hunk behind a gutter mark: the committed lines against what's in the buffer now.
struct GitPeekView: View {
  var mark: GutterMark
  var currentLines: [String]
  var canRevert: Bool
  var onRevert: () -> Void
  @Environment(\.theme) private var theme

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        Text(title)
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(theme.text)
        Spacer()
        if canRevert {
          Button("Revert Hunk", action: onRevert)
            .controlSize(.small)
        }
      }
      .padding(10)
      Divider()
      ScrollView([.vertical, .horizontal]) {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(mark.baseLines.enumerated()), id: \.offset) { _, line in
            row("-", line, tint: theme.errorSoft)
          }
          ForEach(Array(currentLines.enumerated()), id: \.offset) { _, line in
            row("+", line, tint: theme.successSoft)
          }
        }
        .padding(.vertical, 4)
      }
      .frame(maxHeight: 280)
    }
    .frame(minWidth: 360, maxWidth: 640)
    .fixedSize(horizontal: false, vertical: true)
  }

  private var title: String {
    switch mark.kind {
    case .added: mark.lines.count == 1 ? "1 line added" : "\(mark.lines.count) lines added"
    case .modified: mark.lines.count == 1 ? "1 line changed" : "\(mark.lines.count) lines changed"
    case .deleted: mark.baseLines.count == 1 ? "1 line deleted" : "\(mark.baseLines.count) lines deleted"
    }
  }

  private func row(_ sign: String, _ text: String, tint: Color) -> some View {
    HStack(spacing: 6) {
      Text(sign).foregroundStyle(theme.textMuted)
      Text(text.isEmpty ? " " : text).foregroundStyle(theme.text)
    }
    .font(.system(size: 11, design: .monospaced))
    .padding(.horizontal, 10)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(tint)
  }
}
