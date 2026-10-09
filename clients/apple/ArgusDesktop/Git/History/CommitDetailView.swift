import ArgusUI
import GroveKit
import SwiftUI

/// The selected commit: header, then its changeset or file tree. A
/// multi-selection shows what it adds up to instead.
struct CommitDetailView: View {
  let actions: HistoryActions
  private var history: HistoryViewModel { actions.history }

  var body: some View {
    if history.selection.count > 1 {
      CommitSelectionSummary(actions: actions, commits: history.selectedCommits)
    } else if let commit = history.selectedCommit {
      VStack(spacing: 0) {
        CommitDetailHeader(actions: actions, commit: commit)
        Divider()
        HStack {
          Picker(
            "Detail", selection: Binding(get: { history.detailTab }, set: { history.selectDetailTab($0) })
          ) {
            ForEach(HistoryViewModel.DetailTab.allCases) { Text($0.rawValue).tag($0) }
          }
          .pickerStyle(.segmented)
          .labelsHidden()
          .fixedSize()
          Spacer()
          Text(fileCount).font(.scaled(size: 11)).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 10)
        .frame(height: 32)
        Divider()
        switch history.detailTab {
        case .changeset:
          FileDiffsView(files: history.commitDiffs, isLoading: history.isLoadingDiff) { file in
            AnyView(fileMenu(file.path, commit: commit))
          }
        case .tree:
          CommitTreeList(history: history) { fileMenu($0, commit: commit) }
        }
      }
    } else {
      ContentUnavailableView("No commit selected", systemImage: "point.3.connected.trianglepath.dotted")
    }
  }

  private var fileCount: String {
    let count = history.commitDiffs.count
    return history.isLoadingDiff ? "" : "\(count) file\(count == 1 ? "" : "s") changed"
  }

  @ViewBuilder
  private func fileMenu(_ path: String, commit: CommitInfo) -> some View {
    Button("File History…") { history.request(.fileHistory(path)) }
    Button("Blame at \(commit.shortSHA)") { actions.navigate(.blame(path: path, ref: commit.id)) }
    Divider()
    Button("Copy Path") { Clipboard.copy(path) }
  }
}

/// Summary, body, people, SHA, parents, refs and signature.
private struct CommitDetailHeader: View {
  @Environment(\.theme) private var theme
  let actions: HistoryActions
  let commit: CommitInfo
  private var history: HistoryViewModel { actions.history }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 8) {
        Text(commit.summary).font(.scaled(size: 14, weight: .semibold)).textSelection(.enabled)
        if let body = commit.body, !body.isEmpty {
          Text(body).font(.scaled(size: 12)).foregroundStyle(.secondary).textSelection(.enabled)
        }
        Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 4) {
          row("Author", "\(commit.authorName) <\(commit.authorEmail)> · \(CommitDates.full.string(from: commit.authorDate))")
          if commit.committerName != commit.authorName || commit.committerDate != commit.authorDate {
            row(
              "Committer",
              "\(commit.committerName) <\(commit.committerEmail)> · \(CommitDates.full.string(from: commit.committerDate))")
          }
          GridRow {
            label("SHA")
            HStack(spacing: 6) {
              Text(commit.id).font(.scaled(size: 11, design: .monospaced)).textSelection(.enabled)
              Button { Clipboard.copy(commit.id) } label: { Image(systemName: "doc.on.doc") }
                .buttonStyle(.borderless)
                .help("Copy SHA")
            }
          }
          if !commit.parentIDs.isEmpty {
            GridRow {
              label(commit.parentIDs.count > 1 ? "Parents" : "Parent")
              HStack(spacing: 6) {
                ForEach(commit.parentIDs, id: \.self) { parent in
                  Button(String(parent.prefix(7))) { Task { await history.selectCommit(id: parent) } }
                    .buttonStyle(.accentLink)
                    .font(.scaled(size: 11, design: .monospaced))
                    .help("Select parent \(parent.prefix(7))")
                }
              }
            }
          }
          if !refs.isEmpty {
            GridRow {
              label("Refs")
              HStack(spacing: 4) {
                ForEach(refs, id: \.self) { ref in
                  Text(ref).font(.scaled(size: 10, weight: .medium))
                    .padding(.horizontal, 5).padding(.vertical, 1)
                    .background(theme.accentSoft, in: .rect(cornerRadius: 4))
                }
              }
            }
          }
          GridRow {
            label("Signature")
            signature
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(12)
    }
    .frame(maxHeight: 220)
    .fixedSize(horizontal: false, vertical: true)
  }

  private var refs: [String] {
    history.branches(at: commit).map(\.name) + history.tags(at: commit).map(\.name)
  }

  @ViewBuilder
  private var signature: some View {
    switch history.selectedSignature {
    case .verified: Label("Verified", systemImage: "checkmark.seal.fill").foregroundStyle(theme.success)
    case .unverified: Label("Unverified", systemImage: "exclamationmark.triangle").foregroundStyle(theme.warning)
    case .unsigned: Text("Not signed").foregroundStyle(.secondary)
    case nil: Text(commit.isSigned ? "Signed, checking…" : "Checking…").foregroundStyle(.secondary)
    }
  }

  private func row(_ title: String, _ value: String) -> some View {
    GridRow {
      label(title)
      Text(value).textSelection(.enabled)
    }
    .font(.scaled(size: 12))
  }

  private func label(_ title: String) -> some View {
    Text(title).font(.scaled(size: 11)).foregroundStyle(.secondary).gridColumnAlignment(.trailing)
  }
}

/// Every file in the commit's tree; changed ones open in the changeset.
private struct CommitTreeList<Menu: View>: View {
  let history: HistoryViewModel
  @ViewBuilder let menu: (String) -> Menu

  var body: some View {
    List(history.treeFiles, id: \.self) { path in
      let changed = history.fileDiff(for: path) != nil
      Button {
        if changed { history.revealInChangeset(path) }
      } label: {
        HStack(spacing: 6) {
          FileTypeIcon(path: path)
          Text(path).font(.scaled(size: 12)).foregroundStyle(changed ? .primary : .secondary)
          Spacer()
          if changed { Image(systemName: "circle.fill").font(.scaled(size: 5)).foregroundStyle(.tint) }
        }
      }
      .buttonStyle(.plain)
      .contextMenu { menu(path) }
    }
    .overlay { if history.isLoadingTree { ProgressView().controlSize(.small) } }
  }
}

/// Several commits selected: what they add up to and what can be done to all of them.
private struct CommitSelectionSummary: View {
  let actions: HistoryActions
  let commits: [CommitInfo]

  var body: some View {
    let history = actions.history
    VStack(alignment: .leading, spacing: 12) {
      Text("\(commits.count) commits selected").font(.scaled(.headline))
      Text(people).font(.scaled(size: 12)).foregroundStyle(.secondary)
      if let first = commits.last?.authorDate, let last = commits.first?.authorDate {
        Text("\(CommitDates.full.string(from: first)) – \(CommitDates.full.string(from: last))")
          .font(.scaled(size: 12)).foregroundStyle(.secondary)
      }
      HStack {
        Button("Squash \(commits.count) Commits…") { history.request(.squashCommits(commits)) }
          .disabled(!history.canSquash(commits))
        Button("Save as Patch…") { Task { await actions.savePatch(commits) } }
          .disabled(!history.canSavePatch(commits))
      }
      ScrollView {
        VStack(spacing: 4) { ForEach(commits) { CommitSummaryTile(commit: $0) } }
      }
    }
    .padding(16)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  private var people: String {
    let authors = Array(Set(commits.map(\.authorName))).sorted()
    return "By " + (authors.count > 3 ? "\(authors.prefix(3).joined(separator: ", ")) and \(authors.count - 3) more"
      : authors.joined(separator: ", "))
  }
}
