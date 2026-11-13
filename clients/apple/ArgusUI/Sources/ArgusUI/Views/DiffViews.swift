import ArgusCore
import SwiftUI

/// One file's diff, collapsed until you ask for it.
public struct FileDiffCard: View {
  @Environment(\.theme) private var theme
  let file: DiffFile
  /// Shown as "View file" unless the file was deleted; gets the first changed line.
  let onViewFile: ((Int?) -> Void)?
  /// Viewed marks; nil where the diff doesn't keep them.
  let viewed: ViewedFiles?
  /// False shows the mark without letting it change.
  let canMarkViewed: Bool
  @State private var expanded = false

  public init(
    file: DiffFile, onViewFile: ((Int?) -> Void)? = nil, viewed: ViewedFiles? = nil, canMarkViewed: Bool = true
  ) {
    self.file = file
    self.onViewFile = onViewFile
    self.viewed = viewed
    self.canMarkViewed = canMarkViewed
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
          FileTypeIcon(path: file.displayPath, size: 14)
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
          Badge(label: file.status.label, tone: file.status.tone)
        }
        .contentShape(Rectangle())
        .opacity(viewed?.isViewed(file.displayPath) == true ? 0.6 : 1)
      }
      .buttonStyle(.argusPlain)

      if let viewed {
        ViewedToggle(state: viewed.state(file.displayPath), onChange: canMarkViewed ? { mark(viewed, $0) } : nil)
      }

      if file.status == .renamed {
        MutedText("from \(file.oldPath)", lineLimit: 1)
      }

      if let onViewFile, file.status != .deleted {
        Button {
          onViewFile(file.firstChangedLine)
        } label: {
          Label("View file", systemImage: Icon.file).font(.scaled(size: 12, weight: .medium))
        }
        .buttonStyle(.accentLink)
      }

      if expanded { DiffHunksView(file: file) }
    }
  }
}

extension FileDiffCard {
  /// A viewed file folds away, as on GitHub.
  fileprivate func mark(_ viewed: ViewedFiles, _ on: Bool) {
    if on { expanded = false }
    Task { await viewed.set(file.displayPath, viewed: on) }
  }
}

/// A file's hunks, each under its `@@` header; "nothing to show" for a binary.
public struct DiffHunksView: View {
  @Environment(\.theme) private var theme
  let file: DiffFile
  var collapsesLongHunks: Bool

  /// `collapsesLongHunks` folds each hunk past a dozen lines, for a diff among others.
  public init(file: DiffFile, collapsesLongHunks: Bool = true) {
    self.file = file
    self.collapsesLongHunks = collapsesLongHunks
  }

  public var body: some View {
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
          DiffLinesView(lines: hunk.lines, collapses: collapsesLongHunks)
        }
        .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
      }
    }
  }
}

/// Diff lines with a line-number gutter, collapsed past a dozen rows.
public struct DiffLinesView: View {
  @Environment(\.theme) private var theme
  let lines: [DiffLine]
  var collapses: Bool
  @State private var showAll = false

  private static let collapsedCount = 12

  public init(lines: [DiffLine], collapses: Bool = true) {
    self.lines = lines
    self.collapses = collapses
  }

  public var body: some View {
    let visible = showAll || !collapses ? lines : Array(lines.prefix(Self.collapsedCount))

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
      if collapses, lines.count > Self.collapsedCount {
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

extension DiffFileStatus {
  public var tone: Tone {
    switch self {
    case .added: .success
    case .deleted: .danger
    case .modified, .renamed: .accent
    }
  }
}

extension DiffFile {
  /// Where "View file" opens: the first added line, else the first line shown.
  public var firstChangedLine: Int? {
    hunks.lazy.flatMap(\.lines).first { $0.kind == .add }?.newNumber
      ?? hunks.first?.lines.first?.newNumber
  }
}

/// "Viewed" as a tick, with "Changed" once the file moved on after it.
public struct ViewedToggle: View {
  @Environment(\.theme) private var theme
  let state: ViewedFiles.State?
  let onChange: ((Bool) -> Void)?

  public init(state: ViewedFiles.State?, onChange: ((Bool) -> Void)?) {
    self.state = state
    self.onChange = onChange
  }

  public var body: some View {
    HStack(spacing: 8) {
      Button {
        onChange?(state != .viewed)
      } label: {
        Label(
          "Viewed", systemImage: state == .viewed ? "checkmark.circle.fill" : "circle"
        )
        .font(.scaled(size: 12, weight: .medium))
        .foregroundStyle(state == .viewed ? theme.accent : theme.textSecondary)
      }
      .buttonStyle(.argusPlain)
      .disabled(onChange == nil)
      .accessibilityAddTraits(state == .viewed ? .isSelected : [])
      if state == .changed {
        Badge(label: "Changed since viewed", tone: .warning)
      }
    }
  }
}

/// "12 of 40 viewed" over a thin bar.
public struct ViewedProgressBar: View {
  @Environment(\.theme) private var theme
  let viewed: Int
  let total: Int

  public init(viewed: Int, total: Int) {
    self.viewed = viewed
    self.total = total
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      MutedText("\(viewed) of \(total) viewed")
      ProgressView(value: Double(viewed), total: Double(max(total, 1)))
        .progressViewStyle(.linear)
        .tint(theme.accent)
    }
    .accessibilityElement(children: .combine)
  }
}
