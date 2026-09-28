import ArgusKit
import SwiftUI

/// What the desktop's branch menu does, for one branch. Anything that rewrites
/// history or throws commits away asks first.
struct BranchActionsView: View {
  @Environment(AppStore.self) private var app
  @Environment(\.openURL) private var openURL

  let sessionId: String
  let repoRoot: String
  let branch: RemoteGitBranch
  /// The checked-out branch, once known.
  let current: String?
  let onChanged: () async -> Void
  let onRenamed: (String) async -> Void
  let onDeleted: () -> Void

  private enum Confirm: Identifiable {
    case merge(squash: Bool), rebase, forcePush, delete(unmerged: Bool), dirty

    var id: String {
      switch self {
      case .merge(let squash): "merge-\(squash)"
      case .rebase: "rebase"
      case .forcePush: "force-push"
      case .delete(let unmerged): "delete-\(unmerged)"
      case .dirty: "dirty"
      }
    }
  }

  private enum NameSheet: String, Identifiable {
    case create, rename
    var id: String { rawValue }
  }

  @State private var busy = false
  @State private var confirm: Confirm?
  @State private var nameSheet: NameSheet?
  @State private var pullStrategy: AppStore.PullStrategy = .ffOnly

  private var target: String { current ?? "the current branch" }
  private var isLocal: Bool { branch.scope == .local }

  var body: some View {
    Card {
      FlowRow(spacing: 8) {
        if !branch.isCurrent {
          Btn(label: isLocal ? "Switch to" : "Check out locally", small: true, icon: Icon.branch) {
            checkout(dirty: nil)
          }
        }
        Btn(label: "New branch from here", tone: .secondary, small: true, icon: Icon.plus) {
          nameSheet = .create
        }
        if !branch.isCurrent {
          Btn(label: "Merge into \(target)", tone: .secondary, small: true) {
            confirm = .merge(squash: false)
          }
          Btn(label: "Squash into \(target)", tone: .secondary, small: true) {
            confirm = .merge(squash: true)
          }
          Btn(label: "Rebase \(target) onto this", tone: .secondary, small: true) {
            confirm = .rebase
          }
        }
        if isLocal {
          Btn(label: branch.upstream == nil ? "Publish" : "Push", tone: .secondary, small: true) {
            push(forceWithLease: false)
          }
          if branch.upstream != nil {
            Btn(label: "Force push", tone: .ghost, small: true) { confirm = .forcePush }
          }
          Btn(label: "Rename", tone: .secondary, small: true, icon: Icon.pencil) {
            nameSheet = .rename
          }
          Btn(label: branch.pinned == true ? "Unpin" : "Pin", tone: .secondary, small: true) {
            run { await app.setBranchPinned(sessionId: sessionId, branch: branch.name, pinned: branch.pinned != true) }
          }
        }
        if branch.upstream != nil || branch.scope == .remote {
          Btn(label: "Open PR", tone: .secondary, small: true, icon: Icon.web) { openPR() }
        }
        if isLocal && !branch.isCurrent {
          Btn(label: "Delete", tone: .danger, small: true, icon: Icon.trash) {
            confirm = .delete(unmerged: false)
          }
        }
      }
      if branch.isCurrent && branch.upstream != nil {
        SegmentedControl(
          value: $pullStrategy,
          options: AppStore.PullStrategy.allCases.map { ($0, $0.label) })
        Btn(label: "Pull (\(pullStrategy.label.lowercased()))", tone: .secondary, small: true) {
          run { await app.pullCurrent(sessionId: sessionId, strategy: pullStrategy) }
        }
      }
    }
    .disabled(busy)
    .opacity(busy ? 0.5 : 1)
    .alert(item: $confirm) { confirm in alert(for: confirm) }
    .sheet(item: $nameSheet) { sheet in
      BranchNameSheet(
        title: sheet == .create ? "New branch from \(branch.name)" : "Rename \(branch.name)",
        initial: sheet == .rename ? branch.name : "",
        offerCheckout: sheet == .create
      ) { name, checkout in
        if sheet == .create {
          await app.createBranch(
            sessionId: sessionId, repoRoot: repoRoot, name: name, checkout: checkout,
            startPoint: branch.ref)
          await onChanged()
        } else if await app.renameLocalBranch(sessionId: sessionId, from: branch.name, to: name) {
          await onRenamed(name)
        }
      }
    }
  }

  private func alert(for confirm: Confirm) -> Alert {
    switch confirm {
    case .merge(let squash):
      return Alert(
        title: Text(squash ? "Squash \(branch.name) into \(target)?" : "Merge \(branch.name) into \(target)?"),
        message: Text("If it stops on conflicts, resolve them on the computer."),
        primaryButton: .default(Text(squash ? "Squash" : "Merge")) {
          run { await app.mergeIntoCurrent(sessionId: sessionId, from: branch.ref, squash: squash) }
        },
        secondaryButton: .cancel())
    case .rebase:
      return Alert(
        title: Text("Rebase \(target) onto \(branch.name)?"),
        message: Text("This rewrites \(target)'s commits. If it stops on conflicts, resolve them on the computer."),
        primaryButton: .destructive(Text("Rebase")) {
          run { await app.rebaseCurrent(sessionId: sessionId, onto: branch.ref) }
        },
        secondaryButton: .cancel())
    case .forcePush:
      return Alert(
        title: Text("Force push \(branch.name)?"),
        message: Text("Overwrites the remote branch, unless someone pushed since you last fetched."),
        primaryButton: .destructive(Text("Force push")) { push(forceWithLease: true) },
        secondaryButton: .cancel())
    case .delete(let unmerged):
      return Alert(
        title: Text(unmerged ? "\(branch.name) isn't fully merged" : "Delete \(branch.name)?"),
        message: Text(unmerged
          ? "It has commits that aren't on any other branch. Deleting it loses them."
          : "This deletes the local branch."),
        primaryButton: .destructive(Text(unmerged ? "Delete anyway" : "Delete")) {
          delete(force: unmerged)
        },
        secondaryButton: .cancel())
    case .dirty:
      return Alert(
        title: Text("Uncommitted changes"),
        message: Text("Switching to \(branch.name) would overwrite local changes."),
        primaryButton: .default(Text("Stash & switch")) { checkout(dirty: "stash") },
        secondaryButton: .cancel())
    }
  }

  private func run(_ action: @escaping () async -> Bool) {
    busy = true
    Task {
      if await action() { await onChanged() }
      busy = false
    }
  }

  private func checkout(dirty: String?) {
    busy = true
    Task {
      let outcome = await app.checkoutBranch(
        sessionId: sessionId, repoRoot: repoRoot, branch: branch.name, dirty: dirty)
      busy = false
      switch outcome {
      case .dirty: confirm = .dirty
      case .ok: await onChanged()
      case .failed: break
      }
    }
  }

  private func push(forceWithLease: Bool) {
    run {
      await app.pushBranch(
        sessionId: sessionId, branch: branch.name, remote: nil,
        setUpstream: branch.upstream == nil, forceWithLease: forceWithLease)
    }
  }

  private func delete(force: Bool) {
    busy = true
    Task {
      let outcome = await app.deleteBranch(sessionId: sessionId, name: branch.name, force: force)
      busy = false
      switch outcome {
      case .unmerged: confirm = .delete(unmerged: true)
      case .ok: onDeleted()
      case .failed: break
      }
    }
  }

  private func openPR() {
    Task {
      if let url = await app.branchPullRequestURL(sessionId: sessionId, branch: branch.name) {
        openURL(url)
      } else {
        app.lastError = "This repo has no GitHub remote."
      }
    }
  }
}

/// A branch name, for creating one or renaming one.
struct BranchNameSheet: View {
  @Environment(\.theme) private var theme
  @Environment(\.dismiss) private var dismiss

  let title: String
  let initial: String
  let offerCheckout: Bool
  let onSubmit: (String, Bool) async -> Void

  @State private var name = ""
  @State private var checkout = true
  @State private var saving = false

  private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    NavigationStack {
      Screen {
        Field(label: "BRANCH NAME") {
          ThemedTextField(placeholder: "new-branch-name", text: $name, mono: true, input: .code)
        }
        if offerCheckout {
          Toggle(isOn: $checkout) { MutedText("Check out after creating") }
            .tint(theme.accent)
        }
      }
      .navigationTitle(title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(saving ? "Saving…" : "Save") {
            saving = true
            Task {
              await onSubmit(trimmed, checkout)
              dismiss()
            }
          }
          .disabled(trimmed.isEmpty || trimmed == initial || saving)
        }
      }
      .onAppear { name = initial }
    }
    .presentationDetents([.medium])
  }
}
