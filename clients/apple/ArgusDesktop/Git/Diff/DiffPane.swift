import ArgusUI
import GroveKit
import SwiftUI

/// A file's diff with its header: path, counts, unified/split and the
/// whitespace toggle. Every git view shows diffs through this.
struct DiffPane: View {
  @Environment(\.theme) private var theme
  let diff: DiffResult?
  var path: String?
  var isLoading = false
  var actions: DiffActions?
  var onAction: ((HunkAction, HunkData, [GroveKit.DiffLine]) -> Void)?
  /// "Open in Editor at Line" on the rows: the new side's 1-based line.
  var openLine: ((Int) -> Void)?
  /// Draft review comments on this file; nil where the diff can't take them.
  var review: DiffReviewContext?
  var ignoreWhitespace: Binding<Bool>?
  /// Extra controls on the header's trailing side.
  var accessory: AnyView?
  @State private var headerWidth: CGFloat = .infinity
  private var setting: DiffLayoutSetting { .shared }
  private var layout: DiffLayout { setting.layout }

  var body: some View {
    VStack(spacing: 0) {
      header
      Rectangle().fill(theme.border).frame(height: 1)
      content
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  private var header: some View {
    // Large text makes the controls wider than a narrow pane; they give way
    // rather than push the panes beside it out of the window. A width check,
    // not ViewThatFits: measuring both rows made opening the git panel slow.
    headerRow(compact: headerWidth < compactBelow)
      .padding(.horizontal, 10)
      .frame(minWidth: 0, maxWidth: .infinity, minHeight: 34, maxHeight: 34, alignment: .leading)
      .clipped()
      .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { headerWidth = $0 }
  }

  /// Where the stats and the whitespace label give way, at the current text size.
  private var compactBelow: CGFloat { TextScale.shared(460) }

  private func headerRow(compact: Bool) -> some View {
    HStack(spacing: 8) {
      if let name = path ?? diff?.filePath {
        FileTypeIcon(path: name)
        Text(name)
          .font(.scaled(size: 12, design: .monospaced))
          .lineLimit(1)
          .truncationMode(.head)
          .textSelection(.enabled)
          .layoutPriority(-1)
      }
      if let stats = diff?.stats, !compact {
        DiffStatsLabel(stats: stats).fixedSize()
      }
      Spacer(minLength: 0)
      accessory
      if let ignoreWhitespace {
        Toggle(isOn: ignoreWhitespace) {
          if !compact { Text("Ignore Whitespace") }
        }
        .toggleStyle(.quietCheckbox)
        .help("Ignore Whitespace")
        .accessibilityLabel("Ignore Whitespace")
        .fixedSize()
      }
      HStack(spacing: 2) {
        ForEach(DiffLayout.allCases) { option in
          Button {
            if option != layout { setting.set(option, via: .diff) }
          } label: {
            Label(option.title, systemImage: option.symbol)
          }
          .buttonStyle(FlatIconButtonStyle(selected: option == layout, size: 24))
          .help(option.title)
          .accessibilityAddTraits(option == layout ? .isSelected : [])
        }
      }
      .fixedSize()
    }
  }

  @ViewBuilder
  private var content: some View {
    if let diff {
      if diff.isBinary {
        QuietEmptyState(icon: "doc.zipper", title: "Binary file", message: "No text diff to show.")
      } else if diff.hunks.isEmpty {
        QuietEmptyState(icon: "equal", title: "No changes", message: emptyReason(diff))
      } else {
        DiffTableView(
          diff: diff, layout: DiffRowBuilder.isOneSided(diff) ? .inline : layout, actions: actions, onAction: onAction,
          openLine: openLine, review: review)
      }
    } else if isLoading {
      ProgressView().controlSize(.small)
    } else {
      QuietEmptyState(icon: "doc.text.magnifyingglass", title: "No file selected")
    }
  }

  private func emptyReason(_ diff: DiffResult) -> String {
    diff.oldPath != nil ? "Renamed without content changes." : "Only mode or whitespace changes."
  }
}

/// `+12 −3`, coloured; nothing for `+0 −0`.
struct DiffStatsLabel: View {
  let stats: DiffStats

  var body: some View {
    ChangeCounts(additions: stats.additions, deletions: stats.deletions)
  }
}

/// A file's status as the one-letter badge git uses.
struct FileStatusBadge: View {
  @Environment(\.theme) private var theme
  let status: FileStatus

  var body: some View {
    Text(letter)
      .font(.scaled(size: 10, weight: .bold, design: .monospaced))
      .foregroundStyle(tone.color(theme))
      .frame(width: 16, height: 16)
      .background(tone.soft(theme), in: .rect(cornerRadius: 4))
      .help(label)
  }

  private var letter: String {
    switch status {
    case .untracked: "U"
    case .conflicted: "!"
    case .unmodified: " "
    default: status.rawValue
    }
  }

  private var tone: Tone {
    switch status {
    case .added, .untracked, .copied: .success
    case .deleted: .danger
    case .conflicted: .warning
    case .renamed, .typeChange: .accent
    default: .muted
    }
  }

  private var label: String {
    switch status {
    case .modified: "Modified"
    case .added: "Added"
    case .deleted: "Deleted"
    case .renamed: "Renamed"
    case .copied: "Copied"
    case .untracked: "Untracked"
    case .ignored: "Ignored"
    case .conflicted: "Conflicted"
    case .typeChange: "Type changed"
    case .unmodified: "Unmodified"
    }
  }
}

/// A commit's, stash's or comparison's files beside the selected file's diff.
struct FileDiffsView: View {
  let files: [FileDiff]
  var isLoading = false
  /// Context-menu extras per file (history, blame, restore, …).
  var fileMenu: ((FileDiff) -> AnyView)?
  /// Review comments on the shown file, by its path; nil where the diffs can't take them.
  var review: ((String) -> DiffReviewContext)?
  /// Viewed marks; nil where the diff doesn't keep them.
  var viewed: ViewedFiles?
  @State private var selected: String?

  var body: some View {
    ResizableHSplit(key: "git.files", leadingMin: 180, leadingIdeal: 260, leadingMax: 420, trailingMin: 280) {
      VStack(spacing: 0) {
        if let viewed, !files.isEmpty {
          ViewedProgress(viewed: viewed.viewedCount(files.map(\.path)), total: files.count)
          Divider()
        }
        FileDiffList(files: files, selected: $selected, isLoading: isLoading, fileMenu: fileMenu, viewed: viewed)
      }
    } trailing: {
      DiffPane(
        diff: current?.diff, path: current?.path, isLoading: isLoading, review: current.flatMap { review?($0.path) },
        accessory: viewedAccessory)
    }
  }

  private var viewedAccessory: AnyView? {
    guard let viewed, let path = current?.path else { return nil }
    return AnyView(ViewedCheckbox(viewed: viewed, path: path) { advance(from: path) })
  }

  /// The next file after `path` still to review, wrapping round.
  private func advance(from path: String) {
    guard let viewed, let index = files.firstIndex(where: { $0.path == path }) else { return }
    let rest = files[(index + 1)...] + files[..<index]
    if let next = rest.first(where: { !viewed.isViewed($0.path) }) { selected = next.path }
  }

  private var current: FileDiff? {
    files.first { $0.path == selected }
  }
}

/// Changed files with their counts and status; keeps a selection, the first file by default.
struct FileDiffList: View {
  let files: [FileDiff]
  @Binding var selected: String?
  var isLoading = false
  var fileMenu: ((FileDiff) -> AnyView)?
  var viewed: ViewedFiles?
  @FocusState private var listFocused: Bool

  var body: some View {
    List(files, id: \.path) { file in
      HStack(spacing: 6) {
        FileTypeIcon(path: file.path)
        Text((file.path as NSString).lastPathComponent).lineLimit(1)
        Text((file.path as NSString).deletingLastPathComponent)
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .truncationMode(.head)
        Spacer(minLength: 4)
        if let viewed { ViewedMark(state: viewed.state(file.path)) }
        DiffStatsLabel(stats: file.stats)
        FileStatusBadge(status: file.status)
      }
      .font(.scaled(size: 12))
      .opacity(viewed?.isViewed(file.path) == true ? 0.6 : 1)
      .contentShape(.rect)
      .onTapGesture {
        selected = file.path
        listFocused = true
      }
      .clickable()
      .modifier(NavigatorRowHighlight(selected: selected == file.path))
      .contextMenu { fileMenu?(file) }
    }
    .navigatorList()
    .focused($listFocused)
    .onKeyPress(keys: [.upArrow, .downArrow]) { press in
      move(by: press.key == .upArrow ? -1 : 1)
      return .handled
    }
    .overlay {
      if isLoading && files.isEmpty { ProgressView().controlSize(.small) }
    }
    .onChange(of: files.map(\.path), initial: true) { _, paths in
      if selected == nil || !paths.contains(selected ?? "") { selected = paths.first }
    }
  }

  private func move(by offset: Int) {
    guard let index = files.firstIndex(where: { $0.path == selected }) else { return selected = files.first?.path }
    selected = files[min(max(index + offset, 0), files.count - 1)].path
  }
}
