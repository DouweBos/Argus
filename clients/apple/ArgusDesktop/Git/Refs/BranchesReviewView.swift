import ArgusUI
import GroveKit
import SwiftUI

/// Local branches sorted into merged, stale and active against the primary
/// branch, to clean up in bulk.
struct BranchesReviewView: View {
  @Environment(\.theme) private var theme
  let workspace: GitWorkspace

  private var review: BranchesReviewViewModel { workspace.branchesReview }

  var body: some View {
    VStack(spacing: 0) {
      if let error = review.errorMessage {
        GitErrorBanner(message: error) { review.dismissError() }
      }
      if let error = review.mergeStatusError {
        GitErrorBanner(message: "Couldn't tell which branches are merged, so deleting is off: \(error)") {}
      }
      header
      Rectangle().fill(theme.border).frame(height: 1)
      table
    }
    .alert(
      review.pendingDelete.map {
        $0.branches.count == 1 ? "Delete \($0.branches[0].name)?" : "Delete \($0.branches.count) branches?"
      } ?? "",
      isPresented: Binding(get: { review.pendingDelete != nil }, set: { if !$0 { review.cancelDelete() } }),
      presenting: review.pendingDelete
    ) { pending in
      Button(pending.needsForce ? "Force Delete" : "Delete", role: .destructive) {
        Task {
          review.dismissError()
          await review.confirmDelete(pending)
        }
      }
      Button("Cancel", role: .cancel) { review.cancelDelete() }
    } message: { pending in
      let one = pending.branches.count == 1
      let base = review.primaryBranch
      Text(
        pending.needsForce
          ? (one ? "It isn't merged into \(base); its" : "Some aren't merged into \(base); their")
            + " unmerged commits are lost. Undo restores them."
          : (one ? "It's merged into \(base)." : "They're all merged into \(base).") + " Undo restores them.")
    }
  }

  private var header: some View {
    HStack(spacing: 8) {
      ForEach(BranchCategory.allCases, id: \.self) { category in
        Button("\(category.rawValue) \(review.count(of: category))") { review.toggleFilter(category) }
          .buttonStyle(QuietTabButtonStyle(selected: review.categoryFilter == category))
          .accessibilityAddTraits(review.categoryFilter == category ? .isSelected : [])
          .help(Self.help(category, staleDays: review.staleDays, primary: review.primaryBranch))
      }
      Spacer()
      if review.isLoading { ProgressView().controlSize(.small) }
      Text("\(review.selectedIDs.count) selected").foregroundStyle(theme.textSecondary)
      Group {
        Button("Select All") { review.selectAllVisible() }
        Button("Clear") { review.clearSelection() }.disabled(review.selectedIDs.isEmpty)
      }
      .buttonStyle(QuietTabButtonStyle())
      Button("Delete Selected…", role: .destructive) { review.requestDelete(review.selectedBranches) }
        .disabled(review.selectedIDs.isEmpty || !review.canDelete)
    }
    .controlSize(.small)
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
  }

  private var table: some View {
    Table(review.visibleBranches) {
      TableColumn("") { branch in
        Toggle(
          "", isOn: Binding(get: { review.selectedIDs.contains(branch.id) }, set: { _ in review.toggleSelection(branch) })
        )
        .toggleStyle(.quietCheckbox)
        .labelsHidden()
        .disabled(!branch.isDeletable)
        .accessibilityLabel("Select \(branch.name)")
      }
      .width(24)
      TableColumn("Branch") { branch in
        HStack(spacing: 6) {
          Text(branch.name).fontWeight(branch.isCurrentBranch ? .semibold : .regular)
          if let path = branch.worktreePath {
            Image(systemName: "folder").foregroundStyle(theme.textMuted).help("Checked out at \(path)")
          }
        }
        .contextMenu {
          Button("Delete…", role: .destructive) { review.requestDelete([branch]) }
            .disabled(!branch.isDeletable || !review.canDelete)
          Button("Copy Name") { Clipboard.copy(branch.name) }
        }
      }
      .width(min: 140, ideal: 220)
      TableColumn("Status") { branch in
        Text(branch.category.rawValue).foregroundStyle(color(branch.category))
      }
      .width(60)
      TableColumn("vs \(review.primaryBranch)") { branch in
        Text("↑\(branch.ahead) ↓\(branch.behind)").monospacedDigit().foregroundStyle(theme.textSecondary)
      }
      .width(80)
      TableColumn("Last Commit") { branch in
        Text(branch.lastCommitSummary).lineLimit(1).help("\(branch.authorName): \(branch.lastCommitSummary)")
      }
      .width(min: 160, ideal: 280)
      TableColumn("Date") { branch in
        if let date = branch.lastCommitDate {
          Text(date, format: .relative(presentation: .named)).foregroundStyle(theme.textSecondary)
        }
      }
      .width(min: 80, ideal: 110)
    }
    .scrollContentBackground(.hidden)
    .overlay {
      if review.branches.isEmpty && !review.isLoading {
        QuietEmptyState(icon: "arrow.triangle.branch", title: "No branches")
      }
    }
  }

  private func color(_ category: BranchCategory) -> Color {
    switch category {
    case .merged: theme.success
    case .stale: theme.warning
    case .active: theme.textSecondary
    }
  }

  private static func help(_ category: BranchCategory, staleDays: Int, primary: String) -> String {
    switch category {
    case .merged: "Fully merged into \(primary)"
    case .stale: "No commits in \(staleDays) days"
    case .active: "Recent work, checked out, or the primary branch"
    }
  }
}
