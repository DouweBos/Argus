import ArgusCore
import SwiftUI

/// The fields an automation and a quick run share: what it does, what it may
/// read, how far it may go, and the playbook itself.
///
/// A quick run is a playbook run once, so it hides the trigger and the enabled
/// switch — everything else is the same form, because it is the same spec.
public struct AutomationFields: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host

  @Binding var draft: RemoteAutomationDetail
  var showsSchedule = true
  let sources: [RemoteSignalSource]
  /// Empty on a host too old to answer `automations.runners`.
  var runners: [RemoteRunner] = []

  @State private var revising = false

  public init(
    draft: Binding<RemoteAutomationDetail>,
    showsSchedule: Bool = true,
    sources: [RemoteSignalSource],
    runners: [RemoteRunner] = []
  ) {
    self._draft = draft
    self.showsSchedule = showsSchedule
    self.sources = sources
    self.runners = runners
  }

  public var body: some View {
    basics
    if showsSchedule { trigger }
    scope
    behaviour
    playbook
    // Nil means the computer is too old to keep them, so don't offer the field.
    if showsSchedule, draft.extraInstructions != nil { extraInstructions }
  }

  private var basics: some View {
    Field(label: "Basics") {
      ThemedTextField(placeholder: "Name", text: $draft.name, input: .name)
      if showsSchedule {
        ThemedTextField(placeholder: "What it does", text: $draft.description, multiline: true)
        Toggle("Enabled", isOn: $draft.enabled)
          .font(.scaled(size: 15))
          .toggleStyle(.argusSwitch)
      }
    }
  }

  private var triggerCaption: String {
    switch draft.triggerKind {
    case .schedule: "5 fields: minute hour day-of-month month day-of-week."
    case .once: "Runs once at this time, then pauses itself."
    case .manual: "Only runs when someone presses Run now."
    }
  }

  private var trigger: some View {
    Field(label: "Trigger", caption: triggerCaption) {
      SegmentedControl(
        value: Binding(
          get: { draft.triggerKind },
          set: { kind in
            draft.triggerKind = kind
            if kind == .once, draft.runAt == nil {
              draft.runAt = OnceTime.nextWholeHour(timezone: draft.timezone)
            }
          }),
        options: [(.schedule, "Schedule"), (.once, "Once"), (.manual, "Manual")])

      if draft.triggerKind == .schedule {
        ThemedTextField(
          placeholder: "0 9 * * 1-5",
          text: Binding(get: { draft.cron ?? "" }, set: { draft.cron = $0 }),
          mono: true, input: .code)
      }
      if draft.triggerKind == .once {
        DatePicker("Run at", selection: onceDate, displayedComponents: [.date, .hourAndMinute])
          .font(.scaled(size: 15))
          .environment(\.timeZone, onceZone)
        if let error = draft.onceError {
          Text(error).font(.scaled(size: 13)).foregroundStyle(theme.error)
        }
      }
      if draft.triggerKind != .manual {
        ThemedTextField(
          placeholder: TimeZone.current.identifier,
          text: Binding(get: { draft.timezone ?? "" }, set: { draft.timezone = $0 }),
          input: .code)
        if let preview = draft.schedulePreviewText() { schedulePreview(preview) }
        Toggle(
          draft.triggerKind == .once
            ? "Still run if the computer was asleep at that time"
            : "Catch up after the computer was asleep",
          isOn: $draft.catchUp
        )
        .font(.scaled(size: 14))
        .toggleStyle(.argusSwitch)
      }
    }
  }

  private var onceZone: TimeZone {
    draft.timezone.flatMap(TimeZone.init(identifier:)) ?? .current
  }

  /// The picker edits an instant; the wire keeps the wall clock in the trigger's zone.
  private var onceDate: Binding<Date> {
    Binding(
      get: { draft.runAt.flatMap { OnceTime.date($0, timezone: draft.timezone) } ?? Date() },
      set: { draft.runAt = OnceTime.string($0, timezone: draft.timezone) })
  }

  private func schedulePreview(_ preview: SchedulePreviewText) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      if let error = preview.error {
        Text(error).font(.scaled(size: 13)).foregroundStyle(theme.error)
      } else {
        if let headline = preview.headline { BodyText(headline) }
        ForEach(preview.runs, id: \.self) { MutedText($0).monospacedDigit() }
      }
    }
  }

  private var scope: some View {
    Field(label: "Scope", caption: "Repos the run may read, and what feeds it work.") {
      ToggleList(
        title: "Projects",
        options: Self.projectOptions(host.projects, picked: draft.repoRoots),
        selection: $draft.repoRoots,
        emptyMessage: "This computer has no projects registered.")
      ToggleList(
        title: "Signal sources",
        options: sources.map {
          .init(id: $0.id, label: $0.label, hint: $0.available ? nil : "not configured")
        },
        selection: $draft.sourceIds,
        emptyMessage: "This computer reported no signal sources.")
    }
  }

  private var behaviour: some View {
    Field(
      label: "Behaviour",
      caption: draft.autonomy?.caption
        ?? "Autonomy is a ceiling request — the computer takes the lowest of this, "
        + "its own default and the project's cap."
    ) {
      ChipFlowLayout(spacing: 6, lineSpacing: 6) {
        MenuChip(
          "Autonomy", selection: autonomyBinding,
          options: [.init(value: "", label: "Inherit", hint: "Use the computer's default")]
            + RemoteAutonomy.allRungs.map { .init(value: $0.rawValue, label: $0.label, hint: $0.caption) },
          showsTitle: true)
        if !runners.isEmpty {
          MenuChip(
            "Runner", selection: runnerBinding,
            options: [.init(value: "", label: "Default", hint: "Use the computer's default")]
              + runners.map {
                .init(value: $0.id, label: $0.displayName, hint: $0.pickerHint, disabled: !$0.isAvailable)
              },
            icon: Icon.terminal, showsTitle: true)
        }
        if offersAccount {
          MenuChip(
            "Account", selection: accountBinding,
            options: AutomationAccountPin.options(
              accounts: host.claudeAccounts ?? [], activeId: host.activeClaudeAccountId,
              pinned: draft.claudeAccountId
            ).map { .init(value: $0.value, label: $0.name, hint: $0.hint) },
            icon: Icon.person, showsTitle: true)
        }
        if !declaredModels.isEmpty {
          MenuChip(
            "Model", selection: modelBinding,
            options: [.init(value: "", label: "Default", hint: "Use the runner's default")]
              + declaredModels.map { .init(value: $0.value, label: $0.displayName, hint: $0.description) },
            showsTitle: true)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .task { if showsSchedule, host.claudeAccounts == nil { await host.refreshClaudeAccounts() } }
      if offersAccount, draft.claudeAccountId != nil {
        MutedText(AutomationAccountPin.pinnedCaption)
      }
      // A runner that declares its models gets a menu; Claude Code only
      // learns its list from a live handshake, so there it stays free text.
      if declaredModels.isEmpty {
        ThemedTextField(
          placeholder: "Model — blank uses the default",
          text: modelBinding, mono: true, input: .code)
      }
      GuardrailFields(guardrails: $draft.guardrails)
    }
  }

  private var playbook: some View {
    Field(label: "Playbook", caption: "Markdown instructions handed to the run's agent.") {
      ThemedTextField(
        placeholder: "What should this run do?", text: $draft.playbook,
        multiline: true, lines: 6...24, mono: true)
      if host.hasControl {
        Btn(label: "Rewrite with Claude", tone: .secondary, small: true) { revising = true }
          .disabled(draft.playbook.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
    }
    .sheet(isPresented: $revising) {
      RevisePlaybookSheet(playbook: draft.playbook, name: draft.name) { rewritten in
        draft.playbook = rewritten
      }
    }
  }

  private var extraInstructions: some View {
    Field(
      label: "Extra instructions",
      caption: "Added after the playbook on every run; they win where the two disagree."
    ) {
      ThemedTextField(
        placeholder: "Skip anything labelled needs-design.",
        text: Binding(
          get: { draft.extraInstructions ?? "" }, set: { draft.extraInstructions = $0 }),
        multiline: true, lines: 3...12, mono: true)
    }
  }

  /// The computer's projects, plus any the draft still names that it no longer
  /// lists — so one can be switched off rather than silently kept.
  public static func projectOptions(_ projects: [RemoteProject], picked: [String]) -> [ToggleList.Option] {
    let known = Set(projects.map(\.repoRoot))
    return projects.map { .init(id: $0.repoRoot, label: $0.name, icon: "folder") }
      + picked.filter { !known.contains($0) }.map {
        .init(
          id: $0, label: ($0 as NSString).lastPathComponent, hint: "not open on this computer", icon: "folder")
      }
  }

  private var selectedRunner: RemoteRunner? {
    draft.runner.flatMap { id in runners.first { $0.id == id } }
  }

  private var declaredModels: [RemoteRunner.Model] { selectedRunner?.models ?? [] }

  private var autonomyBinding: Binding<String> {
    Binding(get: { draft.autonomy?.rawValue ?? "" }, set: { draft.autonomy = RemoteAutonomy(rawValue: $0) })
  }

  /// Model ids don't carry across runners, so a switch drops the model, and a
  /// custom runner's own credentials drop the account.
  private var runnerBinding: Binding<String> {
    Binding(
      get: { draft.runner ?? "" },
      set: { id in
        guard id != (draft.runner ?? "") else { return }
        draft.runner = id.isEmpty ? nil : id
        draft.model = nil
        if !AutomationAccountPin.applies(toRunner: draft.runner) { draft.claudeAccountId = nil }
      })
  }

  /// A quick run is never pinned; it follows the active account.
  private var offersAccount: Bool {
    showsSchedule && AutomationAccountPin.applies(toRunner: draft.runner)
      && AutomationAccountPin.offered(accounts: host.claudeAccounts ?? [], pinned: draft.claudeAccountId)
  }

  private var accountBinding: Binding<String> {
    Binding(
      get: { draft.claudeAccountId ?? "" },
      set: { draft.claudeAccountId = $0.isEmpty ? nil : $0 })
  }

  private var modelBinding: Binding<String> {
    Binding(get: { draft.model ?? "" }, set: { draft.model = $0.isEmpty ? nil : $0 })
  }
}
