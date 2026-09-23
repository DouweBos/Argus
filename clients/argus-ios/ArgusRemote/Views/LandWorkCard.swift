import ArgusKit
import SwiftUI

/// Commit, push and merge a session's branch — the end of the loop that used
/// to need the computer.
///
/// Every button needs the `control` grant, and the computer still refuses a
/// protected base branch or a conflicting merge; this only asks.
struct LandWorkCard: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app

  let sessionId: String
  /// Called after anything that changes the tree, so the diff can reload.
  let onChanged: () async -> Void

  @State private var message = ""
  @State private var busy: String?
  @State private var blockers: [String] = []
  @State private var confirmingMerge = false
  @State private var openingPullRequest = false
  @State private var note: String?

  private var status: RemoteGitStatus? { app.gitStatusBySession[sessionId] }
  private var hasUncommitted: Bool { (status?.dirtyCount ?? 0) > 0 }
  private var canCommit: Bool {
    hasUncommitted && !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && busy == nil
  }

  var body: some View {
    Card {
      SectionHeader(title: "Land this work")

      if let note {
        MutedText(note, lineLimit: 3)
      }

      if hasUncommitted {
        ThemedTextField(placeholder: "Commit message", text: $message, multiline: true)
        Btn(label: busy == "commit" ? "Committing…" : "Commit all changes", small: true) {
          commit()
        }
        .disabled(!canCommit)
      } else {
        MutedText("Nothing uncommitted — the working tree is clean.")
      }

      Btn(
        label: busy == "push" ? "Pushing…" : pushLabel, tone: .secondary, small: true,
        icon: Icon.branch
      ) { push() }
        .disabled(busy != nil)

      Btn(label: "Open pull request", tone: .secondary, small: true, icon: Icon.repo) {
        openingPullRequest = true
      }
      .disabled(busy != nil)

      if !blockers.isEmpty {
        // The computer would refuse anyway; saying why beats a failed tap.
        ForEach(blockers, id: \.self) { blocker in
          Banner(text: blocker, tone: .warning)
        }
      }
      Btn(
        label: busy == "merge" ? "Merging…" : "Merge into base branch",
        tone: .secondary, small: true
      ) { confirmingMerge = true }
        .disabled(busy != nil || !blockers.isEmpty)
    }
    .alert("Merge into the base branch?", isPresented: $confirmingMerge) {
      Button("Cancel", role: .cancel) {}
      Button("Merge") { merge() }
    } message: {
      Text("Uncommitted changes are committed first. A conflict stops the merge.")
    }
    .sheet(isPresented: $openingPullRequest) {
      OpenPullRequestSheet(sessionId: sessionId, defaultTitle: status?.branch ?? "") { url in
        note = "Opened \(url)"
      }
    }
    .task(id: status?.dirtyCount) { blockers = await app.mergeBlockers(sessionId: sessionId) }
  }

  private var pushLabel: String {
    guard let ahead = status?.ahead, ahead > 0 else { return "Push branch" }

    return "Push branch (\(ahead) ahead)"
  }

  private func commit() {
    busy = "commit"
    Task {
      let output = await app.commit(
        sessionId: sessionId,
        message: message.trimmingCharacters(in: .whitespacesAndNewlines))
      busy = nil
      guard output != nil else { return }
      message = ""
      note = "Committed."
      await finish()
    }
  }

  private func push() {
    busy = "push"
    Task {
      let result = await app.push(sessionId: sessionId)
      busy = nil
      guard let result else { return }
      note = "Pushed \(result.branch) to \(result.remote)."
      await finish()
    }
  }

  private func merge() {
    busy = "merge"
    Task {
      let merged = await app.mergeIntoBase(sessionId: sessionId)
      busy = nil
      guard merged else { return }
      note = "Merged into the base branch."
      await finish()
    }
  }

  private func finish() async {
    blockers = await app.mergeBlockers(sessionId: sessionId)
    await onChanged()
  }
}

/// Open a pull request for this session's branch. The computer works out the
/// base and head from the session, so this only asks what to call it.
struct OpenPullRequestSheet: View {
  @Environment(PullRequestsStore.self) private var store
  @Environment(\.dismiss) private var dismiss

  let sessionId: String
  let defaultTitle: String
  let onOpened: (String) -> Void

  @State private var title = ""
  @State private var summary = ""
  @State private var draft = true
  @State private var opening = false

  var body: some View {
    NavigationStack {
      Screen {
        Field(label: "PULL REQUEST", caption: "Push the branch first — GitHub needs it.") {
          ThemedTextField(placeholder: "Title", text: $title)
          ThemedTextField(
            placeholder: "Description", text: $summary, multiline: true, lines: 4...12)
          Toggle("Open as a draft", isOn: $draft)
            .font(.system(size: 14))
        }
        Btn(label: opening ? "Opening…" : "Open pull request") { open() }
          .disabled(opening || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
      .navigationTitle("New pull request")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
      }
      .task { if title.isEmpty { title = defaultTitle } }
    }
  }

  private func open() {
    opening = true
    Task {
      let url = await store.create(
        sessionId: sessionId,
        title: title.trimmingCharacters(in: .whitespacesAndNewlines),
        body: summary, draft: draft)
      opening = false
      guard let url else { return }
      onOpened(url)
      dismiss()
    }
  }
}
