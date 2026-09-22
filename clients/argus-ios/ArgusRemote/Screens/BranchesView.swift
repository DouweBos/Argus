import ArgusKit
import SwiftUI

/// Branch control for a project root: switch, create, delete.
///
/// Session worktrees are pinned to their branch, so the computer only accepts
/// these on a project root — which is the only place the project screen links
/// here from.
struct BranchesView: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app

  let sessionId: String
  let repoRoot: String
  let label: String

  @State private var branches: [RemoteGitBranch] = []
  @State private var loaded = false
  @State private var filter = ""
  @State private var busy: String?
  @State private var newBranchName = ""
  @State private var checkoutAfterCreate = true
  @State private var creating = false
  @State private var dirtyPrompt: String?
  @State private var unmergedPrompt: String?
  @State private var actionsFor: RemoteGitBranch?

  private var filtered: [RemoteGitBranch] {
    let needle = filter.trimmingCharacters(in: .whitespaces).lowercased()
    guard !needle.isEmpty else { return branches }
    return branches.filter { $0.name.lowercased().contains(needle) }
  }

  var body: some View {
    Screen {
      createForm

      ThemedTextField(placeholder: "Filter branches", text: $filter)

      if !loaded {
        Loading(label: "Reading branches…")
      } else if filtered.isEmpty {
        EmptyState(icon: Icon.branch, title: "No branches", body: "Nothing matches that filter.")
      } else {
        section("Local", filtered.filter { $0.scope == .local })
        section("Remote only", filtered.filter { $0.scope == .remote })
      }
    }
    .navigationTitle("Branches · \(label)")
    .navigationBarTitleDisplayMode(.inline)
    .task { await refresh() }
    .confirmationDialog(
      "Uncommitted changes", isPresented: .constant(dirtyPrompt != nil),
      presenting: dirtyPrompt
    ) { branch in
      Button("Stash & switch") { switchTo(branch, dirty: "stash") }
      Button("Discard & switch", role: .destructive) { switchTo(branch, dirty: "discard") }
      Button("Cancel", role: .cancel) { dirtyPrompt = nil }
    } message: { branch in
      Text("Switching to \(branch) would overwrite local changes.")
    }
    .confirmationDialog(
      "Unmerged commits", isPresented: .constant(unmergedPrompt != nil),
      presenting: unmergedPrompt
    ) { branch in
      Button("Delete anyway", role: .destructive) { delete(branch, force: true) }
      Button("Cancel", role: .cancel) { unmergedPrompt = nil }
    } message: { branch in
      Text("\(branch) has commits that aren't merged anywhere. Deleting it loses them.")
    }
    .confirmationDialog(
      actionsFor?.name ?? "", isPresented: .constant(actionsFor != nil), presenting: actionsFor
    ) { branch in
      if !branch.isCurrent {
        Button(branch.scope == .remote ? "Check out locally" : "Switch to \(branch.name)") {
          switchTo(branch.name, dirty: nil)
        }
      }
      Button("Delete branch", role: .destructive) { delete(branch.name, force: false) }
      Button("Cancel", role: .cancel) { actionsFor = nil }
    }
  }

  @ViewBuilder
  private var createForm: some View {
    Card {
      ThemedTextField(placeholder: "new-branch-name", text: $newBranchName)
      Toggle(isOn: $checkoutAfterCreate) {
        MutedText("Check out after creating")
      }
      .tint(theme.accent)
      Btn(label: creating ? "Creating…" : "Create branch", tone: .secondary, small: true) {
        create()
      }
      .disabled(creating || newBranchName.trimmingCharacters(in: .whitespaces).isEmpty)
      MutedText("Branches off whatever is checked out now.")
    }
  }

  @ViewBuilder
  private func section(_ title: String, _ items: [RemoteGitBranch]) -> some View {
    if !items.isEmpty {
      SectionHeader(title: title, count: items.count)
      ForEach(items) { branch in
        Card(onTap: { tap(branch) }) {
          HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
              HStack(spacing: 6) {
                BodyText(branch.name, lineLimit: 1)
                if branch.isCurrent { Badge(label: "current", tone: .accent) }
                if branch.scope == .remote { Badge(label: branch.remote ?? "remote") }
              }
              if let subject = branch.lastCommitSubject {
                MutedText(subject, lineLimit: 1)
              }
            }
            Spacer(minLength: 6)
            if branch.ahead > 0 { MutedText("↑\(branch.ahead)") }
            if branch.behind > 0 { MutedText("↓\(branch.behind)") }
          }
          .opacity(busy == branch.name ? 0.4 : 1)
        }
      }
    }
  }

  private func tap(_ branch: RemoteGitBranch) {
    if branch.isCurrent {
      actionsFor = branch
    } else {
      switchTo(branch.name, dirty: nil)
    }
  }

  private func switchTo(_ branch: String, dirty: String?) {
    dirtyPrompt = nil
    actionsFor = nil
    busy = branch
    Task {
      let outcome = await app.checkoutBranch(
        sessionId: sessionId, repoRoot: repoRoot, branch: branch, dirty: dirty)
      busy = nil
      switch outcome {
      case .dirty: dirtyPrompt = branch
      case .ok: await refresh()
      case .failed: break
      }
    }
  }

  private func delete(_ branch: String, force: Bool) {
    unmergedPrompt = nil
    actionsFor = nil
    busy = branch
    Task {
      let outcome = await app.deleteBranch(sessionId: sessionId, name: branch, force: force)
      busy = nil
      switch outcome {
      case .unmerged: unmergedPrompt = branch
      case .ok: await refresh()
      case .failed: break
      }
    }
  }

  private func create() {
    let name = newBranchName.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty else { return }
    creating = true
    Task {
      await app.createBranch(
        sessionId: sessionId, repoRoot: repoRoot, name: name, checkout: checkoutAfterCreate)
      newBranchName = ""
      creating = false
      await refresh()
    }
  }

  private func refresh() async {
    branches = await app.listBranches(sessionId: sessionId)
    loaded = true
  }
}
