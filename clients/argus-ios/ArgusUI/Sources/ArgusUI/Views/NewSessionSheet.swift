import ArgusKit
import SwiftUI

/// Start a session: describe it, and say what it branches from — or adopt a
/// branch that already exists.
///
/// The computer derives the branch name from the description, the same as the
/// desktop's New Session dialog with the branch field left blank.
struct NewSessionSheet: View {
  enum Mode: String, CaseIterable {
    case branchOff, existing
  }

  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(\.dismiss) private var dismiss

  let repoRoot: String
  /// Any session in this project — `sessions.branches` is addressed by session,
  /// and the project root is the one that always exists.
  let branchSessionId: String?
  let onCreated: (RemoteSession) -> Void

  @State private var description = ""
  @State private var mode: Mode = .branchOff
  @State private var branches: [RemoteGitBranch] = []
  @State private var baseBranch = ""
  @State private var existingBranch = ""
  @State private var picking: Mode?
  @State private var creating = false

  private var canCreate: Bool {
    guard !creating else { return false }

    return mode == .branchOff
      ? !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      : !existingBranch.isEmpty
  }

  var body: some View {
    NavigationStack {
      Screen {
        Field(
          label: "WHAT SHOULD IT DO?",
          caption: "The computer names the branch from this."
        ) {
          ThemedTextField(
            placeholder: "Fix the flaky login test", text: $description,
            multiline: true, lines: 3...8)
        }

        Field(label: "BRANCH") {
          SegmentedControl(
            value: $mode,
            options: [(.branchOff, "Branch off"), (.existing, "Existing branch")])

          switch mode {
          case .branchOff:
            Btn(
              label: baseBranch.isEmpty ? "Base: project default" : "Base: \(baseBranch)",
              tone: .secondary, small: true
            ) { picking = .branchOff }
          case .existing:
            Btn(
              label: existingBranch.isEmpty ? "Pick a branch" : existingBranch,
              tone: .secondary, small: true
            ) { picking = .existing }
          }
        }

        Btn(label: creating ? "Creating…" : "Create session") { create() }
          .disabled(!canCreate)
      }
      .navigationTitle("New session")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
      }
      .sheet(item: $picking) { which in branchPicker(which) }
      .task { await loadBranches() }
    }
  }

  private func branchPicker(_ which: Mode) -> some View {
    PickerSheet(
      title: which == .branchOff ? "Base branch" : "Existing branch",
      options: branches.map {
        .init(
          value: $0.name, label: $0.name,
          hint: $0.scope == .remote ? "remote" : $0.lastCommitSubject)
      },
      selected: [which == .branchOff ? baseBranch : existingBranch],
      emptyMessage: "This project reported no branches."
    ) { value in
      if which == .branchOff {
        baseBranch = value
      } else {
        existingBranch = value
      }
    }
  }

  private func loadBranches() async {
    guard let branchSessionId else { return }
    branches = await app.listBranches(sessionId: branchSessionId)
  }

  private func create() {
    creating = true
    Task {
      let session = await app.createSession(
        repoRoot: repoRoot,
        branch: mode == .existing ? existingBranch : "",
        description: description.trimmingCharacters(in: .whitespacesAndNewlines),
        useExistingBranch: mode == .existing ? true : nil,
        baseBranch: mode == .branchOff && !baseBranch.isEmpty ? baseBranch : nil)
      creating = false
      guard let session else { return }
      onCreated(session)
      dismiss()
    }
  }
}

extension NewSessionSheet.Mode: Identifiable {
  var id: String { rawValue }
}

/// Start an agent with the runner, model and permission mode it should begin
/// on, rather than the computer's defaults.
struct NewAgentSheet: View {
  private enum Picker: String, Identifiable {
    case runner, model, mode
    var id: String { rawValue }
  }

  @Environment(AppStore.self) private var app
  @Environment(\.dismiss) private var dismiss

  let sessionId: String
  /// Models are reported per agent, so this offers whatever a live agent in
  /// this project last reported — and nothing when none has.
  let models: [RemoteModelInfo]
  let onSpawned: (RemoteAgentStatus) -> Void

  @State private var runner: String?
  @State private var model: String?
  @State private var mode: RemotePermissionMode?
  @State private var picker: Picker?
  @State private var spawning = false

  var body: some View {
    NavigationStack {
      Screen {
        Field(label: "START IT ON", caption: "Blank uses the computer's default.") {
          if !app.runners.isEmpty {
            Btn(
              label: "Runner: \(runnerLabel)", tone: .secondary, small: true
            ) { picker = .runner }
          }
          if !modelOptions.isEmpty {
            Btn(
              label: "Model: \(modelLabel)", tone: .secondary, small: true
            ) { picker = .model }
          }
          Btn(
            label: "Permission mode: \(mode?.label ?? "default")", tone: .secondary, small: true
          ) { picker = .mode }
        }

        Btn(label: spawning ? "Starting…" : "Start agent", icon: Icon.plus) { spawn() }
          .disabled(spawning)
      }
      .navigationTitle("New agent")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
      }
      .sheet(item: $picker) { which in picked(which) }
      .task { await app.loadRunners() }
    }
  }

  private var selectedRunner: RemoteRunner? {
    runner.flatMap { id in app.runners.first { $0.id == id } }
  }

  private var runnerLabel: String {
    selectedRunner?.displayName ?? runner ?? "default"
  }

  /// A custom runner declares its own models; the gateway it points at would
  /// reject the ids a Claude Code handshake reported, so they never mix.
  private var modelOptions: [PickerSheet<String>.Option] {
    if let declared = selectedRunner?.models, !declared.isEmpty {
      return declared.map { .init(value: $0.value, label: $0.displayName, hint: $0.description) }
    }

    return models.map { .init(value: $0.value, label: $0.displayName, hint: $0.description) }
  }

  private var modelLabel: String {
    guard let model else { return "default" }

    return modelOptions.first { $0.value == model }?.label ?? model
  }

  @ViewBuilder
  private func picked(_ which: Picker) -> some View {
    switch which {
    case .runner:
      PickerSheet(
        title: "Runner",
        options: [.init(value: "", label: "Default", hint: "Use the computer's default")]
          + app.runners.map {
            .init(value: $0.id, label: $0.displayName, hint: $0.isCustom ? "custom" : nil)
          },
        selected: [runner ?? ""]
      ) { value in
        runner = value.isEmpty ? nil : value
        // Model ids don't carry across runners, so a switch drops the model.
        model = nil
      }
    case .model:
      PickerSheet(
        title: "Model", options: modelOptions,
        selected: Set([model].compactMap { $0 })
      ) { value in
        model = value
      }
    case .mode:
      PickerSheet(
        title: "Permission mode",
        options: RemotePermissionMode.allCases.map { .init(value: $0.rawValue, label: $0.label) },
        selected: Set([mode?.rawValue].compactMap { $0 })
      ) { value in
        mode = RemotePermissionMode(rawValue: value)
      }
    }
  }

  private func spawn() {
    spawning = true
    Task {
      let agent = await app.spawnAgent(
        sessionId: sessionId, model: model, permissionMode: mode, runnerId: runner)
      spawning = false
      guard let agent else { return }
      onSpawned(agent)
      dismiss()
    }
  }
}
