import ArgusCore
import SwiftUI

/// One file's diff, collapsed until you ask for it.
public struct FileDiffCard: View {
  @Environment(\.theme) private var theme
  let file: DiffFile
  /// Shown as "View file" unless the file was deleted; gets the first changed line.
  let onViewFile: ((Int?) -> Void)?
  @State private var expanded = false

  private var tone: Tone {
    switch file.status {
    case .added: .success
    case .deleted: .danger
    case .modified, .renamed: .accent
    }
  }

  public init(file: DiffFile, onViewFile: ((Int?) -> Void)? = nil) {
    self.file = file
    self.onViewFile = onViewFile
  }

  private var firstChangedLine: Int? {
    file.hunks.lazy.flatMap(\.lines).first { $0.kind == .add }?.newNumber
      ?? file.hunks.first?.lines.first?.newNumber
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

      if let onViewFile, file.status != .deleted {
        Button {
          onViewFile(firstChangedLine)
        } label: {
          Label("View file", systemImage: Icon.file).font(.scaled(size: 12, weight: .medium))
        }
        .buttonStyle(.accentLink)
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
      // One text for every line, its bands drawn behind it: a view per line
      // made each diff card the costliest row in a scrolling transcript.
      ScrollView(.horizontal, showsIndicators: false) {
        Text(text(visible))
          .lineSpacing(2)
          .fixedSize(horizontal: true, vertical: false)
          .textRenderer(DiffBands(bands: visible.map(background)))
          .padding(.vertical, 1)
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

  private func text(_ visible: [DiffLine]) -> AttributedString {
    var out = AttributedString()
    for (index, line) in visible.enumerated() {
      let number = gutter(line)
      var gutter = AttributedString(String(repeating: " ", count: max(0, 5 - number.count)) + number + " ")
      gutter.font = .scaled(size: 11, design: .monospaced)
      gutter.foregroundColor = theme.textMuted
      var code = AttributedString("\(prefix(line))\(line.text)" + (index < visible.count - 1 ? "\n" : ""))
      code.font = .scaled(size: 11.5, design: .monospaced)
      code.foregroundColor = color(line)
      out += gutter
      out += code
    }
    return out
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

/// Paints each diff line's band, as wide as the widest line, under its text.
private struct DiffBands: TextRenderer {
  let bands: [Color]

  func draw(layout: Text.Layout, in context: inout GraphicsContext) {
    let width = layout.reduce(0) { max($0, $1.typographicBounds.rect.maxX) }
    for (index, line) in layout.enumerated() {
      if index < bands.count, bands[index] != .clear {
        let rect = line.typographicBounds.rect
        context.fill(Path(CGRect(x: 0, y: rect.minY - 1, width: width, height: rect.height + 2)), with: .color(bands[index]))
      }
      context.draw(line)
    }
  }
}
