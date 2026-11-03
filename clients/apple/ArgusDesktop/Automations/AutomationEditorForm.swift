import ArgusCore
import ArgusUI
import SwiftUI

/// The automation's configuration as grouped form sections — the desktop
/// editor's fields, in its order. Saving is the screen's job.
struct AutomationEditorForm: View {
  @Environment(HostStore.self) private var host
  @Environment(AutomationsStore.self) private var store
  @Binding var draft: RemoteAutomationDetail
  @State private var revising = false

  var body: some View {
    Section("Configuration") {
      TextField("Name", text: $draft.name)
      TextField("Description", text: $draft.description, prompt: Text("Shown in the automations list."))
    }
    trigger
    scope
    Section {
      runner
      model
      account
    } header: {
      Text("Runner and model")
    } footer: {
      if offersAccount, draft.claudeAccountId != nil { Text(AutomationAccountPin.pinnedCaption) }
    }
    .task { if host.claudeAccounts == nil { await host.refreshClaudeAccounts() } }
    AutonomySection(autonomy: $draft.autonomy, guardrails: $draft.guardrails)
    playbook
    if draft.extraInstructions != nil { extraInstructions }
  }

  private var trigger: some View {
    Section {
      Picker("Trigger", selection: $draft.triggerKind) {
        Text("Schedule").tag(RemoteAutomation.TriggerKind.schedule)
        Text("Manual").tag(RemoteAutomation.TriggerKind.manual)
      }
      .pickerStyle(.segmented)
      if draft.triggerKind == .schedule {
        TextField("Cron", text: optional(\.cron), prompt: Text("0 9 * * 1-5"))
          .font(.system(.body, design: .monospaced))
        TextField("Timezone", text: optional(\.timezone), prompt: Text(TimeZone.current.identifier))
        if let preview = draft.schedulePreviewText() { SchedulePreviewRow(preview: preview) }
        Toggle("Catch up after the computer was asleep", isOn: $draft.catchUp)
      }
    } header: {
      Text("Trigger")
    } footer: {
      Text(
        draft.triggerKind == .schedule
          ? "Five fields: min hour dom mon dow." : "Only runs when someone presses Run now.")
    }
  }

  private var scope: some View {
    Section {
      LabeledContent("Projects") {
        VStack(alignment: .trailing, spacing: 4) {
          if host.projects.isEmpty, host.projectsLoaded { Text("No projects are open.").foregroundStyle(.secondary) }
          ForEach(host.projects) { project in
            Toggle(project.name, isOn: member(project.repoRoot, of: \.repoRoots))
              .help(HostScopedPath.path(project.repoRoot))
          }
        }
      }
      LabeledContent("Signal sources") {
        VStack(alignment: .trailing, spacing: 4) {
          if store.sources.isEmpty { Text("None reported.").foregroundStyle(.secondary) }
          ForEach(store.sources) { source in
            Toggle(
              source.available ? source.label : "\(source.label) (not configured)",
              isOn: member(source.id, of: \.sourceIds))
          }
        }
      }
    } header: {
      Text("Scope")
    } footer: {
      Text("Repos the run may read, and what feeds it work.")
    }
  }

  @ViewBuilder
  private var runner: some View {
    if !store.runners.isEmpty {
      Picker("Runner", selection: runnerBinding) {
        Text("Default").tag("")
        ForEach(store.runners) { Text($0.displayName).tag($0.id) }
      }
    }
  }

  @ViewBuilder
  private var account: some View {
    if offersAccount {
      Picker("Claude account", selection: accountBinding) {
        ForEach(
          AutomationAccountPin.options(
            accounts: host.claudeAccounts ?? [], activeId: host.activeClaudeAccountId,
            pinned: draft.claudeAccountId),
          id: \.value
        ) { Text($0.name).tag($0.value) }
      }
    }
  }

  private var offersAccount: Bool {
    AutomationAccountPin.applies(toRunner: draft.runner)
      && AutomationAccountPin.offered(accounts: host.claudeAccounts ?? [], pinned: draft.claudeAccountId)
  }

  private var accountBinding: Binding<String> {
    Binding(
      get: { draft.claudeAccountId ?? "" },
      set: { draft.claudeAccountId = $0.isEmpty ? nil : $0 })
  }

  /// A runner that declares its models gets a picker; Claude Code only learns
  /// its list from a live handshake, so there it stays free text.
  @ViewBuilder
  private var model: some View {
    let declared = draft.runner.flatMap { id in store.runners.first { $0.id == id } }?.models ?? []
    if declared.isEmpty {
      TextField(
        "Model",
        text: Binding(get: { draft.model ?? "" }, set: { draft.model = $0.isEmpty ? nil : $0 }),
        prompt: Text("Blank uses the default")
      )
      .font(.system(.body, design: .monospaced))
    } else {
      Picker("Model", selection: Binding(get: { draft.model ?? "" }, set: { draft.model = $0.isEmpty ? nil : $0 })) {
        Text("Default").tag("")
        ForEach(declared, id: \.value) { Text($0.displayName).tag($0.value) }
      }
    }
  }

  private var playbook: some View {
    Section {
      TextEditor(text: $draft.playbook)
        .font(.system(.body, design: .monospaced))
        .frame(minHeight: 220)
      HStack {
        Spacer()
        Button("Rewrite with Claude…") { revising = true }
          .disabled(draft.playbook.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
    } header: {
      Text("Playbook")
    } footer: {
      Text("Markdown instructions handed to the run's agent.")
    }
    .sheet(isPresented: $revising) {
      RevisePlaybookSheet(playbook: draft.playbook, name: draft.name) { draft.playbook = $0 }
    }
  }

  private var extraInstructions: some View {
    Section {
      TextEditor(text: Binding(get: { draft.extraInstructions ?? "" }, set: { draft.extraInstructions = $0 }))
        .font(.system(.body, design: .monospaced))
        .frame(minHeight: 80)
    } header: {
      Text("Extra instructions")
    } footer: {
      Text("Added after the playbook on every run; they win where the two disagree.")
    }
  }

  /// Model ids don't carry across runners, so a switch drops the model, and a
  /// custom runner's own credentials drop the account.
  private var runnerBinding: Binding<String> {
    Binding(
      get: { draft.runner ?? "" },
      set: { id in
        draft.runner = id.isEmpty ? nil : id
        draft.model = nil
        if !AutomationAccountPin.applies(toRunner: draft.runner) { draft.claudeAccountId = nil }
      })
  }

  private func optional(_ path: WritableKeyPath<RemoteAutomationDetail, String?>) -> Binding<String> {
    Binding(get: { draft[keyPath: path] ?? "" }, set: { draft[keyPath: path] = $0 })
  }

  private func member(
    _ value: String, of path: WritableKeyPath<RemoteAutomationDetail, [String]>
  ) -> Binding<Bool> {
    Binding(
      get: { draft[keyPath: path].contains(value) },
      set: { on in
        draft[keyPath: path].removeAll { $0 == value }
        if on { draft[keyPath: path].append(value) }
      })
  }
}

/// What a schedule means before it's saved, or why the host would reject it.
private struct SchedulePreviewRow: View {
  let preview: SchedulePreviewText

  var body: some View {
    if let error = preview.error {
      Label(error, systemImage: "exclamationmark.triangle.fill")
        .foregroundStyle(.red)
    } else {
      LabeledContent("Next runs") {
        VStack(alignment: .trailing, spacing: 2) {
          if let headline = preview.headline { Text(headline).bold() }
          ForEach(preview.runs, id: \.self) { Text($0).monospacedDigit().foregroundStyle(.secondary) }
        }
      }
    }
  }
}

/// The ladder and its limits. A ceiling request, not a guarantee: the host
/// takes the lowest of this, the app default and the project's own ceiling.
struct AutonomySection: View {
  @Binding var autonomy: RemoteAutonomy?
  @Binding var guardrails: RemoteAutomationGuardrails

  var body: some View {
    Section {
      Picker("Autonomy", selection: $autonomy) {
        Text("Inherit").tag(RemoteAutonomy?.none)
        ForEach(RemoteAutonomy.allRungs, id: \.self) { Text($0.label).tag(RemoteAutonomy?.some($0)) }
      }
      .pickerStyle(.segmented)
      number("Confidence threshold", "Below this, a proposal waits for you.", \.confidenceThreshold)
      number("Sessions at once", "Auto-started, in flight.", \.maxConcurrentSessions)
      number("Files changed", "A bigger branch is never pushed.", \.maxFilesChanged)
      number("Time limit (minutes)", "A run past this is stopped and marked failed.", \.maxRunMinutes)
      number(
        "Spend ceiling (USD)",
        guardrails.maxCostUsdPerRun > 0
          ? "A run crossing this finishes its turn, then stops." : "Off — a run spends what the work costs.",
        \.maxCostUsdPerRun)
      TextField(
        "Path denylist",
        text: Binding(
          get: { guardrails.pathDenylist.joined(separator: ", ") },
          set: { text in
            guardrails.pathDenylist = text.split(separator: ",")
              .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
          }),
        prompt: Text("infra/**, **/*.lock")
      )
      .font(.system(.body, design: .monospaced))
      Toggle("Require green CI before an auto-merge", isOn: $guardrails.requireCleanCi)
      Toggle("Retry on another Claude account when a usage limit is hit", isOn: $guardrails.retryOtherAccounts)
    } header: {
      Text("Autonomy")
    } footer: {
      Text(
        autonomy?.caption
          ?? "Uses the app-wide default from Settings. A project can cap it lower, never higher.")
    }
  }

  private func number(
    _ label: String, _ caption: String, _ path: WritableKeyPath<RemoteAutomationGuardrails, Double>
  ) -> some View {
    TextField(
      value: Binding(get: { guardrails[keyPath: path] }, set: { guardrails[keyPath: path] = max(0, $0) }),
      format: .number
    ) {
      Text(label)
      Text(caption)
    }
    .monospacedDigit()
  }
}
