import ArgusUI
import GroveKit
import SwiftUI

/// A file's diff with its header: path, counts, inline/side-by-side and the
/// whitespace toggle. Every git view shows diffs through this.
struct DiffPane: View {
  @Environment(\.theme) private var theme
  let diff: DiffResult?
  var path: String?
  var isLoading = false
  var actions: DiffActions?
  var onAction: ((HunkAction, HunkData, [GroveKit.DiffLine]) -> Void)?
  var ignoreWhitespace: Binding<Bool>?
  /// Extra controls on the header's trailing side.
  var accessory: AnyView?
  @AppStorage("gitDiffLayout") private var layout: DiffLayout = .inline

  var body: some View {
    VStack(spacing: 0) {
      header
      Divider()
      content
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  private var header: some View {
    HStack(spacing: 8) {
      if let name = path ?? diff?.filePath {
        Image(systemName: "doc.text").foregroundStyle(.secondary)
        Text(name)
          .font(.system(size: 12, design: .monospaced))
          .lineLimit(1)
          .truncationMode(.head)
          .textSelection(.enabled)
      }
      if let stats = diff?.stats {
        DiffStatsLabel(stats: stats)
      }
      Spacer()
      accessory
      if let ignoreWhitespace {
        Toggle("Ignore Whitespace", isOn: ignoreWhitespace)
          .toggleStyle(.checkbox)
          .controlSize(.small)
      }
      Picker("Layout", selection: $layout) {
        ForEach(DiffLayout.allCases) { layout in
          Image(systemName: layout.symbol).help(layout.title).tag(layout)
        }
      }
      .pickerStyle(.segmented)
      .labelsHidden()
      .fixedSize()
    }
    .padding(.horizontal, 10)
    .frame(height: 34)
  }

  @ViewBuilder
  private var content: some View {
    if let diff {
      if diff.isBinary {
        ContentUnavailableView("Binary file", systemImage: "doc.zipper", description: Text("No text diff to show."))
      } else if diff.hunks.isEmpty {
        ContentUnavailableView("No changes", systemImage: "equal", description: Text(emptyReason(diff)))
      } else {
        DiffTableView(diff: diff, layout: layout, actions: actions, onAction: onAction)
      }
    } else if isLoading {
      ProgressView().controlSize(.small)
    } else {
      ContentUnavailableView("No file selected", systemImage: "doc.text.magnifyingglass")
    }
  }

  private func emptyReason(_ diff: DiffResult) -> String {
    diff.oldPath != nil ? "Renamed without content changes." : "Only mode or whitespace changes."
  }
}

/// `+12 −3`, coloured.
struct DiffStatsLabel: View {
  @Environment(\.theme) private var theme
  let stats: DiffStats

  var body: some View {
    HStack(spacing: 4) {
      Text("+\(stats.additions)").foregroundStyle(theme.success)
      Text("−\(stats.deletions)").foregroundStyle(theme.error)
    }
    .font(.system(size: 11, design: .monospaced))
  }
}

/// A file's status as the one-letter badge git uses.
struct FileStatusBadge: View {
  @Environment(\.theme) private var theme
  let status: FileStatus

  var body: some View {
    Text(letter)
      .font(.system(size: 10, weight: .bold, design: .monospaced))
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
  @State private var selected: String?

  var body: some View {
    HSplitView {
      List(files, id: \.path, selection: $selected) { file in
        HStack(spacing: 6) {
          FileStatusBadge(status: file.status)
          Text((file.path as NSString).lastPathComponent).lineLimit(1)
          Text((file.path as NSString).deletingLastPathComponent)
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .truncationMode(.head)
          Spacer(minLength: 4)
          DiffStatsLabel(stats: file.stats)
        }
        .font(.system(size: 12))
        .contextMenu { fileMenu?(file) }
      }
      .listStyle(.sidebar)
      .overlay {
        if isLoading && files.isEmpty { ProgressView().controlSize(.small) }
      }
      .frame(minWidth: 200, idealWidth: 260, maxWidth: 420)
      DiffPane(diff: current?.diff, path: current?.path, isLoading: isLoading)
        .frame(minWidth: 320)
    }
    .onChange(of: files.map(\.path), initial: true) { _, paths in
      if selected == nil || !paths.contains(selected ?? "") { selected = paths.first }
    }
  }

  private var current: FileDiff? {
    files.first { $0.path == selected }
  }
}
