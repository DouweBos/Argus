import ArgusUI
import GroveKit
import GroveUIKit
import SwiftUI

/// The sheet for whatever `HistoryAction` the view model has pending.
struct HistoryActionSheet: View {
  let actions: HistoryActions
  let action: HistoryAction
  private var history: HistoryViewModel { actions.history }

  var body: some View {
    switch action {
    case .createBranch(let commit):
      GitDialogView(.createBranch(from: commit.id), context: actions.dialogContext).argusGitUI()
    case .createTag(let commit):
      GitDialogView(.createTag(at: commit.id), context: actions.dialogContext).argusGitUI()
    case .revert(let commit):
      CommitActionSheet(
        history: history, commits: [commit], symbol: "arrow.uturn.backward", title: "Revert Commit",
        message: "Creates a new commit that undoes the changes made in this commit.", primaryTitle: "Revert"
      ) { _ in await actions.perform { await history.revert(commit) } }
    case .reset(let commit):
      ResetCommitSheet(history: history, commit: commit) { mode in
        await actions.perform { await history.reset(to: commit, mode: mode) }
      }
    case .reword(let commit):
      CommitActionSheet(
        history: history, commits: [commit], symbol: "pencil", title: "Edit Commit Message",
        message: rewriteNote(from: commit), warning: pushedWarning(from: commit), initialText: commit.message,
        primaryTitle: "Save Message"
      ) { message in await actions.perform { await history.reword(commit, message: message) } }
    case .squash(let commit):
      let parent = commit.parentIDs.first.flatMap { history.commit(withID: $0) } ?? commit
      CommitActionSheet(
        history: history, commits: [commit], symbol: "arrow.triangle.merge", title: "Squash with Parent",
        message: "Combines this commit with its parent. " + rewriteNote(from: parent),
        warning: pushedWarning(from: parent), initialText: history.squashMessage(for: commit), primaryTitle: "Squash"
      ) { message in await actions.perform { await history.squashWithParent(commit, message: message) } }
    case .squashCommits(let commits):
      let oldest = commits.last ?? commits[0]
      CommitActionSheet(
        history: history, commits: commits, symbol: "arrow.triangle.merge", title: "Squash \(commits.count) Commits",
        message: "Combines these commits into one. " + rewriteNote(from: oldest),
        warning: pushedWarning(from: oldest), initialText: history.squashMessage(for: commits), primaryTitle: "Squash"
      ) { message in await actions.perform { await history.squash(commits, message: message) } }
    case .drop(let commit):
      CommitActionSheet(
        history: history, commits: [commit], symbol: "trash", title: "Drop Commit",
        message: "Removes this commit and its changes from the branch. " + rewriteNote(from: commit),
        warning: pushedWarning(from: commit), primaryTitle: "Drop Commit", isDestructive: true
      ) { _ in await actions.perform { await history.drop(commit) } }
    case .fileHistory(let path):
      FileHistorySheet(workspace: actions.workspace, path: path) { history.dismissAction() }
    case .interactiveRebase, .compare:
      EmptyView()
    }
  }

  private func rewriteNote(from oldest: CommitInfo) -> String {
    let total = history.rewrittenCount(from: oldest)
    return "Rewrites \(total) commit\(total == 1 ? "" : "s")."
  }

  private func pushedWarning(from oldest: CommitInfo) -> String? {
    history.pushedWarning(for: history.firstParentLine(reaching: [oldest.id]).compactMap { history.commit(withID: $0) })
  }
}

/// Header, the commits it acts on, an optional message editor, and buttons.
struct CommitActionSheet: View {
  @Environment(\.theme) private var theme
  @Environment(\.dismiss) private var dismiss
  let history: HistoryViewModel
  let commits: [CommitInfo]
  let symbol: String
  let title: String
  let message: String
  var warning: String?
  var initialText: String?
  let primaryTitle: String
  var isDestructive = false
  let perform: (String) async -> Void
  @State private var text = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      SheetHeader(symbol: symbol, title: title, message: message, isDestructive: isDestructive)
      VStack(alignment: .leading, spacing: 4) {
        ForEach(commits.prefix(4)) { CommitSummaryTile(commit: $0) }
        if commits.count > 4 {
          Text("and \(commits.count - 4) more").font(.scaled(.caption)).foregroundStyle(.secondary)
        }
      }
      if let warning { SheetBanner(message: warning, tone: .warning) }
      if initialText != nil {
        TextEditor(text: $text)
          .font(.scaled(size: 13))
          .frame(height: 120)
          .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(theme.border))
          .accessibilityLabel("Commit message")
      }
      if let error = history.errorMessage { SheetBanner(message: error, tone: .danger) }
      SheetFooter(
        primaryTitle: primaryTitle, isDestructive: isDestructive, isBusy: history.isPerformingAction,
        isDisabled: initialText != nil && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
        cancel: { history.dismissAction() }
      ) { await perform(text) }
    }
    .padding(20)
    .frame(width: 480)
    .onAppear { text = initialText ?? "" }
  }
}

/// Soft, mixed or hard; hard asks once more because it discards work.
struct ResetCommitSheet: View {
  let history: HistoryViewModel
  let commit: CommitInfo
  let perform: (ResetMode) async -> Void
  @State private var mode: ResetMode = .mixed
  @State private var confirmingHard = false

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      SheetHeader(
        symbol: "arrow.counterclockwise", title: "Reset \(history.headBranchName ?? "HEAD")",
        message: "Moves \(history.headBranchName ?? "HEAD") to this commit.", isDestructive: mode == .hard)
      CommitSummaryTile(commit: commit)
      Picker("Mode", selection: $mode) {
        option(.soft, "Soft", "Keep all changes staged.")
        option(.mixed, "Mixed", "Keep changes in the working copy, unstaged.")
        option(.hard, "Hard", "Discard all changes after this commit.")
      }
      .pickerStyle(.radioGroup)
      .labelsHidden()
      if mode == .hard { SheetBanner(message: "Uncommitted changes and later commits will be lost.", tone: .danger) }
      if let error = history.errorMessage { SheetBanner(message: error, tone: .danger) }
      SheetFooter(
        primaryTitle: mode == .hard ? "Reset and Discard" : "Reset", isDestructive: mode == .hard,
        isBusy: history.isPerformingAction, cancel: { history.dismissAction() }
      ) {
        if mode == .hard { confirmingHard = true } else { await perform(mode) }
      }
    }
    .padding(20)
    .frame(width: 480)
    .confirmationDialog("Discard all changes after \(commit.shortSHA)?", isPresented: $confirmingHard) {
      Button("Reset and Discard", role: .destructive) { Task { await perform(.hard) } }
    } message: {
      Text("Uncommitted work can't be recovered.")
    }
  }

  private func option(_ mode: ResetMode, _ title: String, _ detail: String) -> some View {
    VStack(alignment: .leading, spacing: 1) {
      Text(title)
      Text(detail).font(.scaled(size: 11)).foregroundStyle(.secondary)
    }
    .padding(.vertical, 2)
    .tag(mode)
  }
}
