import ArgusUI
import GroveKit
import SwiftUI

/// Where HEAD has been: each move with its commit and changes; reset back to
/// one, or branch from it.
struct ReflogView: View {
  @Environment(\.theme) private var theme
  let workspace: GitWorkspace
  @State private var diffs: [FileDiff] = []
  @State private var loadingDiffs = false

  private var reflog: ReflogViewModel { workspace.reflog }

  var body: some View {
    VStack(spacing: 0) {
      if let error = reflog.errorMessage {
        GitErrorBanner(message: error) { reflog.dismissError() }
      }
      ResizableHSplit(key: "git.reflog", leadingMin: 220, leadingIdeal: 360, leadingMax: 520, trailingMin: 320) {
        list.frame(maxHeight: .infinity)
      } trailing: {
        detail.frame(maxHeight: .infinity)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .alert(
      reflog.pendingReset.map { "Reset (\($0.mode.rawValue)) to \($0.entry.newSHA.prefix(7))?" } ?? "",
      isPresented: Binding(get: { reflog.pendingReset != nil }, set: { if !$0 { reflog.cancelReset() } }),
      presenting: reflog.pendingReset
    ) { pending in
      Button("Reset", role: pending.mode == .hard ? .destructive : nil) {
        Task {
          reflog.dismissError()
          await reflog.confirmReset(pending)
          workspace.track(.reset, success: reflog.errorMessage == nil)
        }
      }
      Button("Cancel", role: .cancel) { reflog.cancelReset() }
    } message: { pending in
      Text(resetExplanation(pending.mode))
    }
    .task(id: reflog.selectedEntry?.newSHA) { await loadDiffs() }
  }

  private var list: some View {
    List(
      reflog.entries,
      selection: Binding(
        get: { reflog.selectedEntry?.id },
        set: { id in
          guard let entry = reflog.entries.first(where: { $0.id == id }) else { return }
          Task { await reflog.select(entry) }
        })
    ) { entry in
      let type = reflog.actionType(for: entry)
      HStack(spacing: 8) {
        Image(systemName: type.systemImage)
          .foregroundStyle(theme.textSecondary)
          .frame(width: 16)
          .help(type.displayName)
        VStack(alignment: .leading, spacing: 2) {
          Text(entry.message).lineLimit(1).truncationMode(.tail)
          HStack(spacing: 6) {
            Text(entry.newSHA.prefix(7)).font(.system(size: 10, design: .monospaced))
            Spacer(minLength: 4)
            Text(entry.date, format: .relative(presentation: .named))
          }
          .font(.system(size: 11))
          .foregroundStyle(theme.textSecondary)
        }
      }
      .tag(entry.id)
      .contextMenu { menu(entry) }
    }
    .overlay {
      if reflog.entries.isEmpty && reflog.isLoading { ProgressView().controlSize(.small) }
    }
  }

  @ViewBuilder
  private var detail: some View {
    if let entry = reflog.selectedEntry {
      VStack(spacing: 0) {
        ReflogEntryDetail(entry: entry, commit: reflog.selectedCommit, isLoading: reflog.isLoadingDetail) {
          menu(entry)
        }
        Divider()
        FileDiffsView(files: diffs, isLoading: loadingDiffs)
      }
    } else {
      ContentUnavailableView("Select an Entry", systemImage: "clock.arrow.circlepath")
    }
  }

  @ViewBuilder
  private func menu(_ entry: ReflogEntry) -> some View {
    Button("Soft Reset to Here…") { reflog.requestReset(to: entry, mode: .soft) }
    Button("Mixed Reset to Here…") { reflog.requestReset(to: entry, mode: .mixed) }
    Button("Hard Reset to Here…", role: .destructive) { reflog.requestReset(to: entry, mode: .hard) }
    Divider()
    Button("New Branch Here…") { createBranch(from: entry) }
    Button("Copy SHA") { Clipboard.copy(entry.newSHA) }
  }

  private func createBranch(from entry: ReflogEntry) {
    let workspace = workspace
    GitDialogs.sheet(theme: theme) { dismiss in
      GitNameSheet(
        title: "New Branch at \(entry.newSHA.prefix(7))", label: "Branch name", primary: "Create",
        toggle: "Check out the new branch", validate: GitNameSheet.isValidRef, dismiss: dismiss
      ) { name, checkout in
        Task {
          workspace.reflog.beginCreateBranch(from: entry)
          workspace.reflog.dismissError()
          await workspace.reflog.createBranch(named: name, checkout: checkout)
          workspace.track(.branchCreate, success: workspace.reflog.errorMessage == nil)
        }
      }
    }
  }

  private func loadDiffs() async {
    guard let sha = reflog.selectedEntry?.newSHA else { return diffs = [] }
    loadingDiffs = true
    defer { loadingDiffs = false }
    // A commit gone after gc has no diff; the entry still shows.
    diffs = (try? await workspace.repository.diffForCommit(sha)) ?? []
  }
}

/// The selected entry's move and commit.
private struct ReflogEntryDetail<Actions: View>: View {
  @Environment(\.theme) private var theme
  let entry: ReflogEntry
  let commit: CommitInfo?
  let isLoading: Bool
  @ViewBuilder let actions: Actions

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .firstTextBaseline) {
        Text(commit?.summary ?? entry.message).font(.headline).lineLimit(2).textSelection(.enabled)
        Spacer()
        Menu { actions } label: { Image(systemName: "ellipsis.circle") }
          .menuIndicator(.hidden)
          .fixedSize()
          .accessibilityLabel("Entry Actions")
      }
      Text(entry.message).foregroundStyle(theme.textSecondary).lineLimit(2)
      HStack(spacing: 10) {
        Text("\(entry.oldSHA.prefix(7)) → \(entry.newSHA.prefix(7))").font(.system(size: 11, design: .monospaced))
        if let commit {
          Text(commit.authorName)
          Text(commit.authorDate, format: .dateTime)
        } else if isLoading {
          ProgressView().controlSize(.mini)
        } else {
          Text("Commit no longer exists")
        }
      }
      .font(.system(size: 11))
      .foregroundStyle(theme.textSecondary)
      if let body = commit?.body, !body.isEmpty {
        Text(body).font(.system(size: 12)).lineLimit(6).textSelection(.enabled)
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

private func resetExplanation(_ mode: ResetMode) -> String {
  switch mode {
  case .soft: "HEAD moves; your index and working copy are kept."
  case .mixed: "HEAD moves and the index resets; working copy changes are kept."
  case .hard: "HEAD, the index and the working copy all reset. Uncommitted changes are lost and this can't be undone."
  }
}
