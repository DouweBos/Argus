import ArgusUI
import GroveKit
import SwiftUI

/// Who last changed each line of a file. With no path, a filterable picker
/// of the tracked files; picking one moves the route to it.
struct BlameView: View {
  @Environment(DesktopModel.self) private var model
  let workspace: GitWorkspace
  let path: String?
  let ref: String?
  private var blame: BlameViewModel { workspace.blame }

  var body: some View {
    Group {
      if let path {
        VStack(spacing: 0) {
          toolbar(path)
          Divider()
          content.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .task(id: "\(path)@\(ref ?? "")") { await open(path) }
      } else {
        BlameFilePicker(blame: blame) { navigate(.blame(path: $0, ref: nil)) }
      }
    }
  }

  @ViewBuilder
  private var content: some View {
    if let error = blame.errorMessage {
      EmptyState(icon: "exclamationmark.triangle", title: "Can't blame this", body: error)
    } else if blame.lines.isEmpty {
      if blame.isLoadingBlame { ProgressView().controlSize(.small).frame(maxHeight: .infinity) } else {
        EmptyState(icon: "doc", title: "Empty file")
      }
    } else {
      BlameTableView(
        lines: blame.lines,
        onBlameBefore: { sha in Task { await blame.blameBefore(sha) } },
        onReveal: reveal,
        onOpenLine: openLineHandler)
    }
  }

  private func toolbar(_ path: String) -> some View {
    HStack(spacing: 8) {
      Button { navigate(.blame(path: nil, ref: nil)) } label: { Image(systemName: "doc.text.magnifyingglass") }
        .help("Choose another file")
        .accessibilityLabel("Choose File")
      Text(path).font(.scaled(size: 12, design: .monospaced)).lineLimit(1).truncationMode(.head)
      Text(revisionLabel).font(.scaled(size: 11)).foregroundStyle(.secondary)
      if blame.isLoadingBlame { ProgressView().controlSize(.mini) }
      Spacer()
      Text("\(blame.commitCount) commit\(blame.commitCount == 1 ? "" : "s")").font(.scaled(size: 11)).foregroundStyle(.secondary)
      ControlGroup {
        Button { Task { await blame.goToPreviousRevision() } } label: { Image(systemName: "chevron.left") }
          .help("Before the newest commit shown")
          .accessibilityLabel("Older")
          .disabled(blame.lines.isEmpty)
        Button { Task { await blame.goForward() } } label: { Image(systemName: "chevron.right") }
          .help("Back to the newer revision")
          .accessibilityLabel("Newer")
          .disabled(!blame.canGoForward)
      }
      .fixedSize()
      Button("Working Tree") { Task { await blame.goToWorkingTree() } }
        .disabled(blame.isAtWorkingTree)
    }
    .controlSize(.small)
    .padding(.horizontal, 10)
    .frame(height: 36)
  }

  private var revisionLabel: String {
    guard let revision = blame.revision else { return "working tree" }
    guard revision.hasSuffix("^") else { return "at \(revision.prefix(12))" }
    return "before \(revision.dropLast().prefix(7))"
  }

  private func open(_ path: String) async {
    let revision = ref.flatMap { $0.isEmpty ? nil : $0 }
    if blame.selectedFile == path, blame.revision == revision, !blame.lines.isEmpty { return }
    await blame.open(file: path, revision: revision)
  }

  /// Only the working tree's lines are the file's lines now.
  private var openLineHandler: ((Int) -> Void)? {
    guard blame.isAtWorkingTree, let path else { return nil }
    let model = model
    let sessionId = workspace.sessionId
    return { line in model.openCode(session: sessionId, path: path, line: line, source: .blame) }
  }

  private func reveal(_ sha: String) {
    navigate(.history)
    Task { await workspace.history.reveal(sha) }
  }

  private func navigate(_ route: GitRoute) {
    model.navigate(.sessionGit(id: workspace.sessionId, view: route))
  }
}

/// The tracked files, filtered as you type.
private struct BlameFilePicker: View {
  let blame: BlameViewModel
  let pick: (String) -> Void

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Text("Blame").font(.scaled(size: 13, weight: .semibold))
        Spacer()
        TextField("Filter files", text: Binding(get: { blame.filterText }, set: { blame.setFilter($0) }))
          .textFieldStyle(.roundedBorder)
          .controlSize(.small)
          .frame(maxWidth: 260)
      }
      .padding(.horizontal, 10)
      .frame(height: 36)
      Divider()
      List(blame.filteredFiles, id: \.self) { file in
        Button { pick(file) } label: {
          HStack(spacing: 6) {
            FileTypeIcon(path: file)
            Text((file as NSString).lastPathComponent)
            Text((file as NSString).deletingLastPathComponent).foregroundStyle(.secondary).lineLimit(1)
            Spacer()
          }
          .font(.scaled(size: 12))
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
      }
      .overlay {
        if blame.isLoadingFiles && blame.trackedFiles.isEmpty { ProgressView().controlSize(.small) }
      }
    }
    .task { await blame.loadFilesIfNeeded() }
  }
}
