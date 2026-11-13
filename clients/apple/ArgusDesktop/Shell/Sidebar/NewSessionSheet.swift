import ArgusUI
import SwiftUI

/// The desktop's New Session dialog: what it's for, what it branches from,
/// and optionally a first prompt the host hands an agent once setup is done.
struct NewSessionSheet: View {
  @Environment(HostStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  /// More than one shows a project picker; the session goes in the picked one.
  let projects: [RemoteProject]
  /// Stacks the new session on this one: it branches from its branch.
  let parent: RemoteSession?
  let onCreated: (RemoteSession) -> Void

  @State private var projectRoot: String

  @State private var description = ""
  @State private var useExisting = false
  @State private var branches: [RemoteGitBranch] = []
  @State private var baseBranch = ""
  @State private var existingBranch = ""
  @State private var prompt = ""
  @State private var creating = false
  /// Each gets its own session on Linear's branch name.
  @State private var issues: [HostStore.LinearIssue] = []
  @State private var pickingIssues = false

  init(
    project: RemoteProject, choices: [RemoteProject] = [], issues: [HostStore.LinearIssue] = [],
    parent: RemoteSession? = nil, onCreated: @escaping (RemoteSession) -> Void
  ) {
    self.projects = choices.isEmpty ? [project] : choices
    self.parent = parent
    self.onCreated = onCreated
    _projectRoot = State(initialValue: project.repoRoot)
    _issues = State(initialValue: issues)
  }

  private var project: RemoteProject {
    projects.first { $0.repoRoot == projectRoot } ?? projects[0]
  }

  /// `sessions.branches` is addressed by session; the project root always exists.
  private var rootSessionId: String? {
    store.sessionsByRepo[project.repoRoot]?.first { $0.kind == .projectRoot }?.id
  }

  private var localBranches: [String] {
    branches.filter { $0.scope == .local }.map(\.name)
  }

  private var canCreate: Bool {
    !creating
      && (!issues.isEmpty
        || useExisting
        ? !existingBranch.isEmpty
        : !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
  }

  var body: some View {
    Form {
      if projects.count > 1, parent == nil {
        Section {
          Picker("Project", selection: $projectRoot) {
            ForEach(projects) { Text($0.name).tag($0.repoRoot) }
          }
        }
      }
      if store.linearConnected, parent == nil {
        Section {
          if !issues.isEmpty { PickedIssueChips(issues: $issues) }
          Button("Add Linear Issue…", systemImage: Icon.issue) { pickingIssues = true }
        } footer: {
          if !issues.isEmpty {
            Text("Each issue gets its own session on Linear's branch name, and an agent that starts from it.")
              .foregroundStyle(.secondary)
          }
        }
      }
      if issues.isEmpty {
        Section {
          TextField("What should it do?", text: $description, axis: .vertical)
            .lineLimit(2...6)
        } footer: {
          Text("The branch is named from this.").foregroundStyle(.secondary)
        }
      }
      if let parent {
        Section {
          LabeledContent("Branches from", value: parent.branch)
        } footer: {
          Text("Stacked on \(parent.displayName ?? parent.branch). Restack moves it along when that session changes, and its pull request targets that branch.")
            .foregroundStyle(.secondary)
        }
      } else {
        Section {
          if issues.isEmpty { Toggle("Use an existing branch", isOn: $useExisting) }
          if useExisting && issues.isEmpty {
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
      }
      Section {
        TextField(issues.isEmpty ? "First prompt (optional)" : "Anything to add (optional)", text: $prompt, axis: .vertical)
          .lineLimit(3...10)
      } footer: {
        Text(
          issues.isEmpty
            ? "An agent starts with this once the worktree is ready."
            : "Goes after the issue in each agent's first message."
        )
        .foregroundStyle(.secondary)
      }
    }
    .formStyle(.grouped)
    .toggleStyle(.argusSwitch)
    .safeAreaInset(edge: .top) {
      // A sheet shows no navigation title; say where the session goes.
      Text(parent.map { "New Session on Top of \($0.displayName ?? $0.branch)" } ?? "New Session in \(project.name)")
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
        Button(issues.count > 1 ? "Start \(issues.count) Agents" : issues.isEmpty ? "Create" : "Start Agent") {
          issues.isEmpty ? create() : startFromIssues()
        }
        .disabled(!canCreate)
      }
    }
    .sheet(isPresented: $pickingIssues) { IssuePickerSheet(selection: $issues) }
    .task { await store.loadIntegrations() }
    // Branches are the picked project's; a base from the last one means nothing here.
    .task(id: projectRoot) {
      baseBranch = ""
      existingBranch = ""
      branches = []
      if let rootSessionId { branches = await store.listBranches(sessionId: rootSessionId) }
    }
  }

  private func startFromIssues() {
    creating = true
    Task {
      let sessions = await store.startFromIssues(
        issues, repoRoot: project.repoRoot, baseBranch: baseBranch.isEmpty ? nil : baseBranch,
        prompt: prompt.trimmingCharacters(in: .whitespacesAndNewlines),
        model: nil, permissionMode: nil, runnerId: nil)
      creating = false
      guard let first = sessions.first else { return }
      await store.loadSessions(repoRoot: project.repoRoot)
      onCreated(first)
      dismiss()
    }
  }

  private func create() {
    creating = true
    let trimmedPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
    Task {
      let session = await store.createSession(
        repoRoot: project.repoRoot,
        branch: useExisting && parent == nil ? existingBranch : "",
        description: description.trimmingCharacters(in: .whitespacesAndNewlines),
        useExistingBranch: useExisting && parent == nil ? true : nil,
        baseBranch: useExisting || baseBranch.isEmpty || parent != nil ? nil : baseBranch,
        parentSessionId: parent?.id,
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
        .buttonStyle(.borderedProminent)
        .keyboardShortcut(.defaultAction)
      }
    }
    .padding(20)
    .frame(width: 420)
  }
}
