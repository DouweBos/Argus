import ArgusUI
import SwiftUI

/// The desktop's New Session dialog: what it's for, what it branches from,
/// and optionally a first prompt the host hands an agent once setup is done.
struct NewSessionSheet: View {
  @Environment(HostStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  let project: RemoteProject
  let onCreated: (RemoteSession) -> Void

  @State private var description = ""
  @State private var useExisting = false
  @State private var branches: [RemoteGitBranch] = []
  @State private var baseBranch = ""
  @State private var existingBranch = ""
  @State private var prompt = ""
  @State private var creating = false

  /// `sessions.branches` is addressed by session; the project root always exists.
  private var rootSessionId: String? {
    store.sessionsByRepo[project.repoRoot]?.first { $0.kind == .projectRoot }?.id
  }

  private var localBranches: [String] {
    branches.filter { $0.scope == .local }.map(\.name)
  }

  private var canCreate: Bool {
    !creating
      && (useExisting
        ? !existingBranch.isEmpty
        : !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
  }

  var body: some View {
    Form {
      Section {
        TextField("What should it do?", text: $description, axis: .vertical)
          .lineLimit(2...6)
      } footer: {
        Text("The branch is named from this.").foregroundStyle(.secondary)
      }
      Section {
        Toggle("Use an existing branch", isOn: $useExisting)
        if useExisting {
          Picker("Branch", selection: $existingBranch) {
            Text("Pick a branch").tag("")
            ForEach(localBranches, id: \.self) { Text($0).tag($0) }
          }
        } else {
          Picker("Base", selection: $baseBranch) {
            Text("Project default").tag("")
            ForEach(localBranches, id: \.self) { Text($0).tag($0) }
          }
        }
      }
      Section {
        TextField("First prompt (optional)", text: $prompt, axis: .vertical)
          .lineLimit(3...10)
      } footer: {
        Text("An agent starts with this once the worktree is ready.")
          .foregroundStyle(.secondary)
      }
    }
    .formStyle(.grouped)
    .toggleStyle(.argusSwitch)
    .safeAreaInset(edge: .top) {
      // A sheet shows no navigation title; say where the session goes.
      Text("New Session in \(project.name)")
        .font(.scaled(.headline))
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding([.top, .horizontal], 20)
    }
    .frame(width: 480)
    .toolbar {
      ToolbarItem(placement: .cancellationAction) {
        Button("Cancel") { dismiss() }
      }
      ToolbarItem(placement: .confirmationAction) {
        Button("Create") { create() }.disabled(!canCreate)
      }
    }
    .task {
      if let rootSessionId { branches = await store.listBranches(sessionId: rootSessionId) }
    }
  }

  private func create() {
    creating = true
    let trimmedPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
    Task {
      let session = await store.createSession(
        repoRoot: project.repoRoot,
        branch: useExisting ? existingBranch : "",
        description: description.trimmingCharacters(in: .whitespacesAndNewlines),
        useExistingBranch: useExisting ? true : nil,
        baseBranch: useExisting || baseBranch.isEmpty ? nil : baseBranch,
        prompt: trimmedPrompt.isEmpty ? nil : trimmedPrompt)
      creating = false
      guard let session else { return }
      await store.loadSessions(repoRoot: project.repoRoot)
      onCreated(session)
      dismiss()
    }
  }
}

/// Deleting removes the worktree; the branch only goes when asked.
struct DeleteSessionSheet: View {
  @Environment(HostStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  let session: RemoteSession
  let onDeleted: () -> Void

  @State private var deleteBranch = false

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Delete “\(session.displayName ?? session.branch)”?").font(.scaled(.headline))
      Text("Its worktree is removed and any agents in it are stopped.")
        .foregroundStyle(.secondary)
      Toggle("Also delete the branch \(session.branch)", isOn: $deleteBranch)
      HStack {
        Spacer()
        Button("Cancel", role: .cancel) { dismiss() }
          .keyboardShortcut(.cancelAction)
        Button("Delete", role: .destructive) {
          let session = session
          let deleteBranch = deleteBranch
          Task {
            await store.deleteSession(
              id: session.id, repoRoot: session.repoRoot, deleteBranch: deleteBranch)
          }
          onDeleted()
          dismiss()
        }
        .keyboardShortcut(.defaultAction)
      }
    }
    .padding(20)
    .frame(width: 420)
  }
}
