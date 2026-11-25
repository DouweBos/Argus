import ArgusCore
import ArgusUI
import SwiftUI

/// The automation's configuration as grouped form sections — the desktop
/// editor's fields, in its order. Saving is the screen's job.
struct AutomationEditorForm: View {
  @Environment(HostStore.self) private var host
  @Environment(AutomationsStore.self) private var store
  @Binding var draft: RemoteAutomationDetail
  /// Makes a new webhook secret for the saved automation.
  var rotateWebhook: () async -> RemoteWebhookSecret? = { nil }
  @State private var revising = false

  var body: some View {
    Section("Configuration") {
      TextField("Name", text: $draft.name)
      TextField("Description", text: $draft.description, prompt: Text("Shown in the automations list."))
    }
    trigger
    SlackReportSection(channel: $draft.reportSlackChannel)
    scope
    Section {
      RunnerModelRows(runner: $draft.runner, model: $draft.model, runners: store.runners) {
        // A custom runner's own credentials drop the account.
        if !AutomationAccountPin.applies(toRunner: draft.runner) { draft.claudeAccountId = nil }
      }
      account
    } header: {
      Text("Runner and model")
    } footer: {
      if offersAccount, draft.claudeAccountId != nil { Text(AutomationAccountPin.pinnedCaption) }
    }
    .task { if host.claudeAccounts == nil { await host.refreshClaudeAccounts() } }
    AutonomySection(autonomy: $draft.autonomy, guardrails: $draft.guardrails)
    // Hidden on a computer too old to have either part.
    if draft.precheckCommand != nil || draft.continueConversation != nil { RunStartSection(draft: $draft) }
    playbook
    if draft.extraInstructions != nil { extraInstructions }
  }

  @ViewBuilder
  private var trigger: some View {
    Section {
      Picker("Trigger", selection: Binding(get: { draft.triggerKind }, set: { draft.setTriggerKind($0) })) {
        ForEach(RemoteAutomationDetail.triggerOptions, id: \.0) { Text($0.1).tag($0.0) }
        if host.slackConfigured || draft.triggerKind == .slack {
          Text("Slack").tag(RemoteAutomation.TriggerKind.slack)
        }
      }
      .pickerStyle(.segmented)
      .task { if host.slackOverview == nil { await host.loadSlackStatus() } }
      if draft.triggerKind == .slack {
        SlackTriggerRows(channel: $draft.slackChannel, match: $draft.slackMatch, text: optional(\.slackText))
      }
      if draft.triggerKind == .schedule {
        TextField("Cron", text: optional(\.cron), prompt: Text("0 9 * * 1-5"))
          .font(.system(.body, design: .monospaced))
      }
      if draft.triggerKind == .once {
        DatePicker("Run at", selection: onceDate, displayedComponents: [.date, .hourAndMinute])
          .environment(\.timeZone, draft.timezone.flatMap(TimeZone.init(identifier:)) ?? .current)
        if let error = draft.onceError { Text(error).foregroundStyle(.red) }
      }
      if draft.triggerKind == .schedule || draft.triggerKind == .once {
        TextField("Timezone", text: optional(\.timezone), prompt: Text(TimeZone.current.identifier))
        if let preview = draft.schedulePreviewText() { SchedulePreviewRow(preview: preview) }
        Toggle(
          draft.triggerKind == .once
            ? "Still run if the computer was asleep at that time" : "Catch up after the computer was asleep",
          isOn: $draft.catchUp)
      }
      if draft.triggerKind == .signal {
        SignalLabelsRow(labels: signal.labels)
        FireRows(fire: signal.fire, maxRunsPerHour: signal.maxRunsPerHour)
      }
      if draft.triggerKind == .webhook {
        WebhookRows(webhook: webhook, rotate: rotateWebhook)
        FireRows(fire: webhook.fire, maxRunsPerHour: webhook.maxRunsPerHour)
      }
    } header: {
      Text("Trigger")
    } footer: {
      if draft.triggerKind != .signal { Text(draft.triggerCaption) }
    }
    if draft.triggerKind == .signal {
      SignalEventsSection(signal: signal, error: draft.signalError)
    }
  }

  private var signal: Binding<RemoteAutomationSignal> {
    Binding(get: { draft.signal ?? .init() }, set: { draft.signal = $0 })
  }

  private var webhook: Binding<RemoteAutomationWebhook> {
    Binding(get: { draft.webhook ?? .init() }, set: { draft.webhook = $0 })
  }

  /// The picker edits an instant; the wire keeps the wall clock in the trigger's zone.
  private var onceDate: Binding<Date> {
    Binding(
      get: { draft.runAt.flatMap { OnceTime.date($0, timezone: draft.timezone) } ?? Date() },
      set: { draft.runAt = OnceTime.string($0, timezone: draft.timezone) })
  }

  @ViewBuilder
  private var scope: some View {
    ProjectScopeSection(selection: $draft.repoRoots)
    SourceScopeSection(selection: $draft.sourceIds)
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

  private var playbook: some View {
    Section {
      PlaybookEditor(text: $draft.playbook)
      HStack {
        Spacer()
        Button("Rewrite with Claude") { revising = true }
          .disabled(draft.playbook.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
    } header: {
      Text("Playbook")
    } footer: {
      Text("Markdown instructions handed to the run's agent.")
    }
    .argusSheet(isPresented: $revising) {
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

  private func optional(_ path: WritableKeyPath<RemoteAutomationDetail, String?>) -> Binding<String> {
    Binding(get: { draft[keyPath: path] ?? "" }, set: { draft[keyPath: path] = $0 })
  }
}

/// What happens before a run's agent starts: the precheck that must exit 0,
/// and whether it picks up the previous run's conversation.
struct RunStartSection: View {
  @Binding var draft: RemoteAutomationDetail

  var body: some View {
    Section {
      if draft.precheckCommand != nil {
        // A command outgrows a label-and-value row, so it gets the full width.
        TextField(
          "Precheck command",
          text: Binding(get: { draft.precheckCommand ?? "" }, set: { draft.precheckCommand = $0 }),
          prompt: Text("Precheck command, e.g. ./scripts/has-new-work.sh"), axis: .vertical
        )
        .labelsHidden()
        .font(.system(.body, design: .monospaced))
        TextField(
          "Timeout (seconds)",
          value: Binding(
            get: { draft.precheckTimeoutSeconds ?? AutomationText.defaultPrecheckTimeout },
            set: { draft.precheckTimeoutSeconds = max(1, $0.rounded()) }),
          format: .number
        )
        .monospacedDigit()
      }
      if draft.continueConversation != nil {
        Toggle(
          "Continue the previous run's conversation",
          isOn: Binding(get: { draft.continueConversation ?? false }, set: { draft.continueConversation = $0 }))
      }
    } header: {
      Text("Before each run")
    } footer: {
      Text(
        [
          draft.precheckCommand != nil ? AutomationText.precheckCaption : nil,
          draft.continueConversation == true ? AutomationText.continueCaption : nil,
        ].compactMap(\.self).joined(separator: " "))
    }
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
