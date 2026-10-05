import ArgusCore
import SwiftUI

/// One file's diff, collapsed until you ask for it.
public struct FileDiffCard: View {
  @Environment(\.theme) private var theme
  let file: DiffFile
  @State private var expanded = false

  private var tone: Tone {
    switch file.status {
    case .added: .success
    case .deleted: .danger
    case .modified, .renamed: .accent
    }
  }

  public init(file: DiffFile) {
    self.file = file
  }

  public var body: some View {
    Card {
      Button {
        expanded.toggle()
      } label: {
        HStack(spacing: 8) {
          Image(systemName: expanded ? Icon.chevronDown : Icon.chevronRight)
            .font(.scaled(size: 11, weight: .semibold))
            .foregroundStyle(theme.textMuted)
          MonoText(
            text: file.displayPath, size: 12, color: theme.text, lineLimit: 1,
            truncateHead: true)
          Spacer(minLength: 6)
          if file.additions > 0 {
            Text("+\(file.additions)")
              .font(.scaled(size: 11, design: .monospaced))
              .foregroundStyle(theme.success)
          }
          if file.deletions > 0 {
            Text("-\(file.deletions)")
              .font(.scaled(size: 11, design: .monospaced))
              .foregroundStyle(theme.error)
          }
          Badge(label: file.status.label, tone: tone)
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)

      if file.status == .renamed {
        MutedText("from \(file.oldPath)", lineLimit: 1)
      }

      if expanded {
        if file.isBinary {
          MutedText("Binary file — nothing to show.")
        } else {
          ForEach(file.hunks) { hunk in
            VStack(alignment: .leading, spacing: 0) {
              Text(hunk.header)
                .font(.scaled(size: 11, design: .monospaced))
                .foregroundStyle(theme.textMuted)
                .padding(.vertical, 4)
                .padding(.horizontal, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.bgTertiary)
              DiffLinesView(lines: hunk.lines)
            }
            .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
          }
        }
      }
    }
  }
}

/// Diff lines with a line-number gutter, collapsed past a dozen rows.
public struct DiffLinesView: View {
  @Environment(\.theme) private var theme
  let lines: [DiffLine]
  @State private var showAll = false

  private static let collapsedCount = 12

  public init(lines: [DiffLine]) {
    self.lines = lines
  }

  public var body: some View {
    let visible = showAll ? lines : Array(lines.prefix(Self.collapsedCount))

    VStack(alignment: .leading, spacing: 0) {
      ScrollView(.horizontal, showsIndicators: false) {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(visible) { line in
            HStack(spacing: 6) {
              Text(gutter(line))
                .font(.scaled(size: 11, design: .monospaced))
                .foregroundStyle(theme.textMuted)
                .frame(width: 34, alignment: .trailing)
              Text("\(prefix(line))\(line.text)")
                .font(.scaled(size: 11.5, design: .monospaced))
                .foregroundStyle(color(line))
                .fixedSize(horizontal: true, vertical: false)
            }
            .padding(.vertical, 1)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(background(line))
          }
        }
      }
      if lines.count > Self.collapsedCount {
        Button(showAll ? "Collapse" : "See all \(lines.count) lines") { showAll.toggle() }
          .font(.scaled(size: 12))
          .foregroundStyle(theme.accent)
          .padding(.vertical, 6)
          .padding(.horizontal, 6)
      }
    }
  }

  private func gutter(_ line: DiffLine) -> String {
    switch line.kind {
    case .add: line.newNumber.map(String.init) ?? ""
    case .remove: line.oldNumber.map(String.init) ?? ""
    case .context: line.newNumber.map(String.init) ?? ""
    case .noNewline: ""
    }
  }

  private func prefix(_ line: DiffLine) -> String {
    switch line.kind {
    case .add: "+"
    case .remove: "-"
    case .context: " "
    case .noNewline: "\\"
    }
  }

  private func color(_ line: DiffLine) -> Color {
    switch line.kind {
    case .add: theme.success
    case .remove: theme.error
    case .context: theme.textSecondary
    case .noNewline: theme.textMuted
    }
  }

  private func background(_ line: DiffLine) -> Color {
    switch line.kind {
    case .add: theme.successSoft
    case .remove: theme.errorSoft
    default: .clear
    }
  }
}
