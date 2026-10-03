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
  @State private var refNote: String?
  private var blame: BlameViewModel { workspace.blame }

  var body: some View {
    Group {
      if let path {
        VStack(spacing: 0) {
          toolbar(path)
          Divider()
          if let refNote { SheetBanner(message: refNote, tone: .warning).padding(8) }
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
      ContentUnavailableView("Can't blame this", systemImage: "exclamationmark.triangle", description: Text(error))
    } else if blame.lines.isEmpty {
      if blame.isLoadingBlame { ProgressView().controlSize(.small).frame(maxHeight: .infinity) } else {
        ContentUnavailableView("Empty file", systemImage: "doc")
      }
    } else {
      BlameTableView(
        lines: blame.lines,
        onBlameBefore: { sha in Task { await blame.blameBefore(sha) } },
        onReveal: reveal)
    }
  }

  private func toolbar(_ path: String) -> some View {
    HStack(spacing: 8) {
      Button { navigate(.blame(path: nil, ref: nil)) } label: { Image(systemName: "doc.text.magnifyingglass") }
        .help("Choose another file")
        .accessibilityLabel("Choose File")
      Text(path).font(.system(size: 12, design: .monospaced)).lineLimit(1).truncationMode(.head)
      Text(revisionLabel).font(.system(size: 11)).foregroundStyle(.secondary)
      if blame.isLoadingBlame { ProgressView().controlSize(.mini) }
      Spacer()
      Text("\(blame.commitCount) commit\(blame.commitCount == 1 ? "" : "s")").font(.system(size: 11)).foregroundStyle(.secondary)
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
    let base = revision.hasSuffix("^") ? String(revision.dropLast()) : revision
    return "before \(base.prefix(7))"
  }

  /// GroveKit only blames the working tree or the parent of a commit, so a
  /// ref is reached as the parent of its child on HEAD's first-parent line.
  private func open(_ path: String) async {
    refNote = nil
    if blame.selectedFile != path || !blame.isAtWorkingTree || blame.lines.isEmpty { await blame.open(file: path) }
    guard let ref, !ref.isEmpty else { return }
    let shell = GitShell(workingDirectory: workspace.repository.path, runner: LocalGitRunner())
    func resolve(_ rev: String) async -> String? {
      try? await shell.run(["rev-parse", "--verify", "--quiet", "\(rev)^{commit}"]).stdout
        .trimmingCharacters(in: .whitespacesAndNewlines)
    }
    guard let target = await resolve(ref) else { return refNote = "Couldn't find \(ref); showing the working tree." }
    if target == (await resolve("HEAD")) { return }
    let children = try? await shell.run(["rev-list", "--first-parent", "--ancestry-path", "--reverse", "\(target)..HEAD"])
    if let child = children?.stdout.split(separator: "\n").first.map(String.init),
      await resolve("\(child)^") == target
    {
      await blame.blameBefore(child)
    } else {
      refNote = "\(ref.prefix(12)) isn't on HEAD's line; showing the working tree."
    }
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
        Text("Blame").font(.system(size: 13, weight: .semibold))
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
            Image(systemName: "doc").foregroundStyle(.secondary)
            Text((file as NSString).lastPathComponent)
            Text((file as NSString).deletingLastPathComponent).foregroundStyle(.secondary).lineLimit(1)
            Spacer()
          }
          .font(.system(size: 12))
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
