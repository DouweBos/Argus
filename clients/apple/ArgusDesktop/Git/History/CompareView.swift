import ArgusUI
import GroveKit
import SwiftUI

/// Two refs side by side: what each has that the other lacks, whether merging
/// would conflict, and every file `right` changed since they diverged.
struct CompareView: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  let workspace: GitWorkspace
  let left: String
  let right: String
  @State private var compare = CompareModel()

  var body: some View {
    VStack(spacing: 0) {
      header
      Divider()
      if left.isEmpty || right.isEmpty {
        QuietEmptyState(icon: "arrow.left.arrow.right", title: "Pick two refs", message: "Compare branches, tags or commits.")
      } else if let error = compare.errorMessage {
        GitErrorBanner(message: error) {}
        Spacer()
      } else {
        summary
        Divider()
        ResizableVSplit(key: "git.compare.files", topMin: 120, bottomMin: 240, bottomIdeal: 400, showsBottom: true) {
          HStack(spacing: 0) {
            CompareCommitList(title: "Only in \(left)", commits: compare.comparison?.onlyInBase, reveal: reveal)
              .frame(maxWidth: .infinity)
            Divider()
            CompareCommitList(title: "Only in \(right)", commits: compare.comparison?.onlyInCompare, reveal: reveal)
              .frame(maxWidth: .infinity)
          }
        } bottom: {
          FileDiffsView(files: compare.files, isLoading: compare.isLoadingFiles) { file in
            AnyView(fileMenu(file.path))
          }
        }
      }
    }
    .task(id: "\(left)...\(right)#\(workspace.generation)") {
      guard !left.isEmpty, !right.isEmpty else { return }
      await compare.load(workspace: workspace, left: left, right: right)
    }
  }

  private var header: some View {
    HStack(spacing: 8) {
      Text("Compare").font(.scaled(size: 13, weight: .semibold))
      refPicker("Base", selection: left) { go(left: $0, right: right) }
      Button { go(left: right, right: left) } label: { Image(systemName: "arrow.left.arrow.right") }
        .help("Swap sides")
        .accessibilityLabel("Swap sides")
        .disabled(left.isEmpty || right.isEmpty)
      refPicker("Compare", selection: right) { go(left: left, right: $0) }
      Spacer()
      if compare.isLoading || compare.isLoadingFiles { ProgressView().controlSize(.mini) }
    }
    .padding(.horizontal, 10)
    .frame(height: 36)
  }

  private var summary: some View {
    HStack(spacing: 14) {
      if let comparison = compare.comparison {
        stat("\(comparison.onlyInBase.count)", "only in \(left)")
        stat("\(comparison.onlyInCompare.count)", "only in \(right)")
        if comparison.equivalentCount > 0 { stat("\(comparison.equivalentCount)", "equivalent") }
        stat("\(comparison.files.count)", comparison.files.count == 1 ? "file" : "files")
      }
      if let base = compare.mergeBase {
        Text("merge base \(String(base.prefix(7)))").font(.scaled(size: 11, design: .monospaced))
          .foregroundStyle(.secondary)
      }
      Spacer()
      switch compare.wouldConflict {
      case true?:
        Label("Would conflict", systemImage: "exclamationmark.triangle.fill")
          .foregroundStyle(theme.warning)
          .help("Merging \(right) into \(left) would conflict")
      case false?:
        Label("Merges cleanly", systemImage: "checkmark.circle.fill").foregroundStyle(theme.success)
      case nil:
        EmptyView()
      }
    }
    .font(.scaled(size: 12))
    .padding(.horizontal, 10)
    .frame(height: 30)
  }

  private func stat(_ value: String, _ label: String) -> some View {
    HStack(spacing: 3) {
      Text(value).fontWeight(.semibold)
      Text(label).foregroundStyle(.secondary)
    }
  }

  private func refPicker(_ title: String, selection: String, set: @escaping @MainActor @Sendable (String) -> Void) -> some View {
    let refs = workspace.refs
    let locals = refs.localBranches.map(\.name)
    let remotes = refs.remoteBranches.filter { !$0.id.hasSuffix("/HEAD") }.map(\.name)
    let tags = refs.tags.map(\.name)
    return Picker(title, selection: Binding(get: { selection }, set: { set($0) })) {
      if !selection.isEmpty && !(locals + remotes + tags).contains(selection) {
        Text(selection.count == 40 ? String(selection.prefix(7)) : selection).tag(selection)
      }
      if selection.isEmpty { Text("Choose…").tag("") }
      Section("Branches") { ForEach(locals, id: \.self) { Text($0).tag($0) } }
      if !remotes.isEmpty { Section("Remote") { ForEach(remotes, id: \.self) { Text($0).tag($0) } } }
      if !tags.isEmpty { Section("Tags") { ForEach(tags, id: \.self) { Text($0).tag($0) } } }
    }
    .labelsHidden()
    .frame(maxWidth: 220)
    .accessibilityLabel(title)
  }

  @ViewBuilder
  private func fileMenu(_ path: String) -> some View {
    Button("Blame at \(right)") { navigate(.blame(path: path, ref: right)) }
    Button("Copy Path") { Clipboard.copy(path) }
  }

  private func go(left: String, right: String) {
    navigate(.compare(left: left, right: right))
  }

  private func reveal(_ sha: String) {
    navigate(.history)
    Task { await workspace.history.reveal(sha) }
  }

  private func navigate(_ route: GitRoute) {
    model.navigate(.sessionGit(id: workspace.sessionId, view: route))
  }
}

/// One side's commits; double-click shows the commit in History.
private struct CompareCommitList: View {
  let title: String
  let commits: [CommitInfo]?
  let reveal: (String) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(title).font(.scaled(size: 11, weight: .semibold)).foregroundStyle(.secondary).lineLimit(1)
        .padding(.horizontal, 10).padding(.vertical, 6)
      List(commits ?? []) { commit in
        HStack(spacing: 8) {
          Text(commit.shortSHA).font(.scaled(size: 11, design: .monospaced)).foregroundStyle(.secondary)
          Text(commit.summary).lineLimit(1)
          Spacer(minLength: 4)
          Text(commit.authorName).foregroundStyle(.secondary).lineLimit(1)
        }
        .font(.scaled(size: 12))
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { reveal(commit.id) }
        .contextMenu {
          Button("Show in History") { reveal(commit.id) }
          Button("Copy SHA") { Clipboard.copy(commit.id) }
        }
      }
      .navigatorList()
      .overlay {
        if commits == nil {
          ProgressView().controlSize(.small)
        } else if commits?.isEmpty == true {
          Text("Nothing").foregroundStyle(.secondary)
        }
      }
    }
    .frame(minWidth: 240)
  }
}
