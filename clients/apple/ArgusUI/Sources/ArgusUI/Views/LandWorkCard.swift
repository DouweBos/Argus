import ArgusCore
import SwiftUI

/// Commit, push and merge a session's branch — the end of the loop that used
/// to need the computer.
///
/// Every button needs the `control` grant, and the computer still refuses a
/// protected base branch or a conflicting merge; this only asks.
public struct LandWorkCard: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host

  let sessionId: String
  /// Offers folding the changes into the last commit.
  let allowsAmend: Bool
  /// Called after anything that changes the tree, so the diff can reload.
  let onChanged: () async -> Void

  @State private var message = ""
  @State private var busy: String?
  @State private var blockers: [String] = []
  @State private var confirmingMerge = false
  @State private var openingPullRequest = false
  @State private var changingBase = false
  @State private var note: String?
  @State private var amend = false

  private var status: RemoteGitStatus? { host.gitStatusBySession[sessionId] }
  private var hasUncommitted: Bool { (status?.dirtyCount ?? 0) > 0 }
  private var canCommit: Bool {
    hasUncommitted && !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && busy == nil
  }

  public init(
    sessionId: String, allowsAmend: Bool = false, onChanged: @escaping () async -> Void
  ) {
    self.sessionId = sessionId
    self.allowsAmend = allowsAmend
    self.onChanged = onChanged
  }

  public var body: some View {
    Card {
      header

      if let note {
        MutedText(note, lineLimit: 3)
      }

      if hasUncommitted {
        ThemedTextField(placeholder: "Commit message", text: $message, multiline: true)
        // A phone can't fit the summary, the toggle and the button on one line;
        // squeezed together the button wrapped a letter per line.
        ViewThatFits(in: .horizontal) {
          HStack(spacing: 12) {
            commitDetails
            Spacer(minLength: 0)
            commitButton(hugs: true)
          }
          VStack(alignment: .leading, spacing: 8) {
            ViewThatFits(in: .horizontal) {
              commitDetails
              VStack(alignment: .leading, spacing: 8) {
                MutedText(changeSummary)
                amendToggle
              }
            }
            commitButton(hugs: false)
          }
        }
      } else {
        HStack(spacing: 6) {
          Image(systemName: Icon.check)
            .font(.scaled(size: 11, weight: .semibold))
            .foregroundStyle(theme.success)
          MutedText("Working tree clean")
        }
      }

      // The computer would refuse anyway; saying why beats a failed tap.
      ForEach(blockers, id: \.self) { blocker in
        Banner(text: blocker, tone: .warning)
      }

      Divider().overlay(theme.border).padding(.vertical, 2)

      ViewThatFits(in: .horizontal) {
        HStack(spacing: 8) {
          pushButton(hugs: true)
          pullRequestButton(hugs: true)
          Spacer(minLength: 0)
          mergeButton(hugs: true)
        }
        VStack(spacing: 8) {
          pushButton(hugs: false)
          pullRequestButton(hugs: false)
          mergeButton(hugs: false)
        }
      }
    }
    // Two buttons, no default: a squash rewrites the commits the agent
    // wrote, which is not something to do on someone's behalf.
    .confirmationDialog(
      "Merge into \(baseLabel)?", isPresented: $confirmingMerge, titleVisibility: .visible
    ) {
      Button(HostStore.MergeStrategy.keep.label) { merge(.keep) }
      Button(HostStore.MergeStrategy.squash.label) { merge(.squash) }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("Uncommitted changes are committed first. A conflict stops the merge.")
    }
    .sheet(isPresented: $changingBase) {
      BaseBranchSheet(sessionId: sessionId, current: session?.baseBranch) { branch in
        Task {
          await host.setBaseBranch(id: sessionId, baseBranch: branch)
          note = "Base branch is now \(branch)."
          await finish()
        }
      }
    }
    .sheet(isPresented: $openingPullRequest) {
      OpenPullRequestSheet(sessionId: sessionId, defaultTitle: status?.branch ?? "") { url in
        note = "Opened \(url)"
      }
    }
    .task(id: status?.dirtyCount) { blockers = await host.mergeBlockers(sessionId: sessionId) }
  }

  /// The branch and where it lands; the base is what a merge targets, and a
  /// session created against a remote ref can't merge until it points somewhere local.
  private var header: some View {
    HStack(spacing: 8) {
      SectionHeader(title: "Land this work")
      Spacer(minLength: 8)
      Chip(
        label: "\(status?.branch ?? "branch") → \(baseLabel)", icon: Icon.branch
      ) { changingBase = true }
      .help("Change the base branch")
      .disabled(busy != nil)
    }
  }

  private var changeSummary: String {
    let count = status?.dirtyCount ?? 0
    var text = count == 1 ? "1 changed file" : "\(count) changed files"
    if let added = status?.diffAdditions, let removed = status?.diffDeletions,
      let counts = ChangeCounts.summary(additions: Int(added), deletions: Int(removed))
    {
      text += " · \(counts)"
    }
    return text
  }

  private var commitDetails: some View {
    HStack(spacing: 12) {
      MutedText(changeSummary).fixedSize()
      amendToggle
    }
  }

  @ViewBuilder private var amendToggle: some View {
    if allowsAmend {
      Toggle(isOn: $amend) { MutedText("Amend last commit") }
        .toggleStyle(.argusSwitch)
        .fixedSize()
    }
  }

  private func commitButton(hugs: Bool) -> some View {
    Btn(
      label: busy == "commit" ? "Committing…" : amend ? "Amend" : "Commit all",
      small: true, icon: Icon.check, hugs: hugs
    ) { commit() }
    .fixedSize(horizontal: hugs, vertical: false)
    .disabled(!canCommit)
  }

  private func pushButton(hugs: Bool) -> some View {
    Btn(
      label: busy == "push" ? "Pushing…" : pushLabel, tone: .secondary, small: true,
      icon: Icon.push, hugs: hugs
    ) { push() }
    .disabled(busy != nil)
  }

  private func pullRequestButton(hugs: Bool) -> some View {
    Btn(
      label: "Open pull request", tone: .secondary, small: true, icon: Icon.pullRequest,
      hugs: hugs
    ) { openingPullRequest = true }
    .disabled(busy != nil)
  }

  /// The way out once everything is committed, so it leads then.
  private func mergeButton(hugs: Bool) -> some View {
    Btn(
      label: busy == "merge" ? "Merging…" : "Merge into \(session?.baseBranch ?? "base")",
      tone: hasUncommitted || !blockers.isEmpty ? .secondary : .primary, small: true,
      icon: Icon.merge, hugs: hugs
    ) { confirmingMerge = true }
    .disabled(busy != nil || !blockers.isEmpty)
  }

  private var pushLabel: String {
    guard let ahead = status?.ahead, ahead > 0 else { return "Push" }

    return "Push \(ahead) commit\(ahead == 1 ? "" : "s")"
  }

  private func commit() {
    busy = "commit"
    Task {
      let output = await host.commit(
        sessionId: sessionId,
        message: message.trimmingCharacters(in: .whitespacesAndNewlines), amend: amend)
      busy = nil
      guard output != nil else { return }
      message = ""
      note = amend ? "Amended the last commit." : "Committed."
      amend = false
      await finish()
    }
  }

  private func push() {
    busy = "push"
    Task {
      let result = await host.push(sessionId: sessionId)
      busy = nil
      guard let result else { return }
      note = "Pushed \(result.branch) to \(result.remote)."
      await finish()
    }
  }

  private func merge(_ strategy: HostStore.MergeStrategy) {
    busy = "merge"
    Task {
      let merged = await host.mergeIntoBase(sessionId: sessionId, strategy: strategy)
      busy = nil
      guard merged else { return }
      note = strategy == .squash
        ? "Squashed and merged into \(baseLabel)."
        : "Merged into \(baseLabel)."
      await finish()
    }
  }

  private var session: RemoteSession? {
    host.sessionsByRepo.values.flatMap { $0 }.first { $0.id == sessionId }
  }

  /// The session's base branch, or a neutral word when the computer hasn't
  /// said which it is yet.
  private var baseLabel: String { session?.baseBranch ?? "the base branch" }

  private func finish() async {
    blockers = await host.mergeBlockers(sessionId: sessionId)
    await onChanged()
  }
}

/// Pick the branch a merge lands on. Only local branches: the computer can't
/// fast-forward a remote-tracking ref like `origin/main`, which is exactly the
/// state that used to make a merge fail halfway.
private struct BaseBranchSheet: View {
  @Environment(HostStore.self) private var host
  @Environment(\.dismiss) private var dismiss

  let sessionId: String
  let current: String?
  let onPick: (String) -> Void

  @State private var branches: [RemoteGitBranch] = []
  @State private var loaded = false

  var body: some View {
    NavigationStack {
      // Unscrolled until there's a list, so the placeholders can centre.
      Screen(scroll: loaded && !branches.isEmpty) {
        if !loaded {
          Loading(label: "Reading branches…").frame(maxHeight: .infinity)
        } else if branches.isEmpty {
          EmptyState(
            icon: Icon.branch, title: "No local branches",
            body: "Check one out on the computer first.")
        } else {
          ForEach(branches, id: \.name) { branch in
            Card(onTap: {
              onPick(branch.name)
              dismiss()
            }) {
              HStack {
                BodyText(branch.name)
                Spacer()
                if branch.name == current { Image(systemName: Icon.check) }
              }
            }
          }
        }
      }
      .sheetTitle("Base branch")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
      }
    }
    .task {
      branches = await host.listBranches(sessionId: sessionId).filter { $0.scope == .local }
      loaded = true
    }
  }
}
